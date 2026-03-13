from flask import Flask, render_template, request, jsonify, abort, Response, send_file
import io
import zipfile
import requests
import os
import json
import threading
import asyncio
import queue
import time
from datetime import datetime

app = Flask(__name__)

# Path to runs/ directory (co-located with app.py)
RUNS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs")

# ---------------------------------------------------------------------------
# Active session tracking  (only one session at a time for now)
# ---------------------------------------------------------------------------
_session_state = {
    "session": None,        # MCPSession instance (lives in the async loop)
    "thread": None,         # Background thread running the event loop
    "loop": None,           # asyncio loop inside that thread
    "queue": None,          # thread-safe event queue for SSE
    "status": "idle",       # idle | starting | running | stopping | stopped
    "run_id": None,
    "cancel_event": None,   # asyncio.Event for cancelling a chat turn
}
_session_lock = threading.Lock()


def _make_run_id(server_type: str) -> str:
    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    return f"{ts}_{server_type}"


def _event_callback(event: dict):
    """Push an event onto the SSE queue."""
    event["timestamp"] = datetime.now().isoformat()
    q = _session_state.get("queue")
    if q:
        try:
            q.put_nowait(event)
        except queue.Full:
            pass


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/models', methods=['POST'])
def get_models():
    data = request.json
    ollama_url = data.get('url', 'http://localhost:11434')

    try:
        response = requests.get(f"{ollama_url}/api/tags", timeout=5)
        response.raise_for_status()
        models = [model['name'] for model in response.json().get('models', [])]
        return jsonify({'success': True, 'models': models})
    except requests.exceptions.RequestException as e:
        return jsonify({'success': False, 'error': str(e)}), 400


# -----------------------------------------------------------------------
# Session Lifecycle
# -----------------------------------------------------------------------

@app.route('/api/session/start', methods=['POST'])
def session_start():
    """Launch the MCP server, connect, and discover tools.  Keeps session alive."""
    with _session_lock:
        if _session_state["status"] in ("starting", "running"):
            return jsonify({
                'success': False,
                'error': 'A session is already running. Stop it first.',
            }), 409

    data = request.json
    ollama_url = data.get('url', 'http://localhost:11434')
    model = data.get('model')
    server_command = data.get('server_command')
    tools_config = data.get('tools_config')
    context_window = int(data.get('context_window', 8192))

    if not model:
        return jsonify({'success': False, 'error': 'No model selected'}), 400
    if not server_command:
        return jsonify({'success': False, 'error': 'No server command provided'}), 400

    # Write tools config if provided
    if tools_config:
        with open(os.path.abspath('kali_tools.json'), 'w') as f:
            json.dump(tools_config, f, indent=2)

    is_apt = "/usr/share/mcp-kali-server/mcp_server.py" in server_command
    server_type = "apt" if is_apt else "native"
    run_id = _make_run_id(server_type)

    event_queue = queue.Queue(maxsize=1000)

    # We'll wait for the start() to finish before returning to the caller
    start_result = {"success": False, "error": None, "tools": []}
    start_done = threading.Event()

    def run_session_loop():
        """Background thread: create event loop, start session, then idle."""
        import mcp_client

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        with _session_lock:
            _session_state["loop"] = loop
            _session_state["queue"] = event_queue
            _session_state["status"] = "starting"
            _session_state["run_id"] = run_id

        session = mcp_client.MCPSession(
            ollama_url=ollama_url,
            model=model,
            server_command=server_command,
            run_id=run_id,
            event_callback=_event_callback,
            context_window=context_window,
        )

        async def _start():
            try:
                tools = await session.start()
                with _session_lock:
                    _session_state["session"] = session
                    _session_state["status"] = "running"
                start_result["success"] = True
                start_result["tools"] = tools
            except Exception as exc:
                start_result["error"] = str(exc)
                with _session_lock:
                    _session_state["status"] = "idle"
            finally:
                start_done.set()

        loop.run_until_complete(_start())

        if not start_result["success"]:
            loop.close()
            return

        # Keep the loop running so we can schedule chat() coroutines on it
        try:
            loop.run_forever()
        finally:
            # Clean up when loop stops
            async def _cleanup():
                try:
                    await session.stop()
                except Exception:
                    pass

            # If loop is still running at this point, it was just stopped
            loop.run_until_complete(_cleanup())
            loop.close()

            with _session_lock:
                _session_state["status"] = "stopped"
                _session_state["session"] = None
                _session_state["loop"] = None

    thread = threading.Thread(target=run_session_loop, daemon=True)
    with _session_lock:
        _session_state["thread"] = thread
    thread.start()

    # Wait for start() to complete (with timeout)
    start_done.wait(timeout=30)

    if start_result["success"]:
        return jsonify({
            'success': True,
            'run_id': run_id,
            'tools': start_result["tools"],
            'message': f'Service started with {len(start_result["tools"])} tool(s).',
        })
    else:
        return jsonify({
            'success': False,
            'error': start_result["error"] or "Timed out starting session.",
        }), 500


@app.route('/api/session/chat', methods=['POST'])
def session_chat():
    """Send a prompt to the running session."""
    with _session_lock:
        if _session_state["status"] != "running":
            return jsonify({
                'success': False,
                'error': 'No active session. Start the service first.',
            }), 409
        loop = _session_state["loop"]
        session = _session_state["session"]

    data = request.json
    prompt = (data.get('prompt') or '').strip()
    if not prompt:
        return jsonify({'success': False, 'error': 'Empty prompt.'}), 400

    # Create a cancel event for this chat turn
    cancel_event = asyncio.Event()
    with _session_lock:
        _session_state["cancel_event"] = cancel_event

    # Schedule the chat coroutine on the session's event loop
    future = asyncio.run_coroutine_threadsafe(
        session.chat(prompt, cancel_event=cancel_event),
        loop,
    )

    # Return immediately — the client follows progress via SSE
    return jsonify({
        'success': True,
        'message': 'Prompt submitted.',
    })

@app.route('/api/session/cancel_prompt', methods=['POST'])
def session_cancel_prompt():
    """Cancel the currently running prompt processing."""
    with _session_lock:
        if _session_state["status"] != "running":
            return jsonify({
                'success': False,
                'error': 'No active session to cancel.',
            }), 409
        loop = _session_state["loop"]
        cancel_event = _session_state.get("cancel_event")

    if cancel_event and loop:
        loop.call_soon_threadsafe(cancel_event.set)
        return jsonify({'success': True, 'message': 'Cancel signal sent.'})
    else:
        return jsonify({'success': False, 'error': 'No prompt currently running to cancel.'}), 400

@app.route('/api/sessions/<run_id>/annotate', methods=['POST'])
def session_annotate(run_id):
    """Add a human-in-the-loop annotation to the run log."""
    _validate_run_id(run_id)
    
    data = request.json or {}
    text = data.get('text', '').strip()
    span = data.get('span', 'Entire Session')
    
    if not text:
        return jsonify({'success': False, 'error': 'Annotation text is required.'}), 400
        
    # We must ensure we log to the correct run. 
    # If it's the active run, we use the active logger to emit events and stay in sync.
    with _session_lock:
        is_active = (_session_state["status"] == "running" and 
                     _session_state.get("run_id") == run_id and 
                     _session_state.get("logger"))
        active_logger = _session_state.get("logger") if is_active else None

    try:
        if active_logger:
            active_logger.log_annotation(text, span)
        else:
            # For past sessions, we instantiate a temporary logger to append the file
            from session_logger import SessionLogger
            # Try to load existing metadata to preserve fields
            meta_path = os.path.join(RUNS_DIR, run_id, "metadata.json")
            metadata = {}
            if os.path.exists(meta_path):
                with open(meta_path, 'r') as f:
                    metadata = json.load(f)
            # Create a temporary logger (don't overwrite end_time/status)
            temp_logger = SessionLogger(run_id, metadata)
            temp_logger.log_annotation(text, span)
            
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

def session_stop():
    """Stop the running session."""
    with _session_lock:
        if _session_state["status"] not in ("running", "starting"):
            return jsonify({
                'success': False,
                'error': 'No active session to stop.',
            }), 409
        loop = _session_state["loop"]
        session = _session_state["session"]
        _session_state["status"] = "stopping"

    # Cancel any in-progress chat
    cancel = _session_state.get("cancel_event")
    if cancel and loop:
        loop.call_soon_threadsafe(cancel.set)

    # Schedule session.stop() and then stop the loop
    if session and loop:
        async def _stop_and_halt():
            try:
                await session.stop()
            except Exception:
                pass
            loop.stop()

        asyncio.run_coroutine_threadsafe(_stop_and_halt(), loop)

    return jsonify({'success': True, 'message': 'Stop signal sent.'})


@app.route('/api/session/status')
def session_status():
    """Return current session status."""
    with _session_lock:
        return jsonify({
            'status': _session_state["status"],
            'run_id': _session_state["run_id"],
        })


@app.route('/api/session/stream')
def session_stream():
    """SSE endpoint — streams real-time events for the active session."""
    with _session_lock:
        if _session_state["status"] not in ("starting", "running", "stopping"):
            return jsonify({'error': 'No active session'}), 404
        event_queue = _session_state["queue"]

    if not event_queue:
        return jsonify({'error': 'No event queue'}), 404

    def generate():
        while True:
            try:
                # Use a short timeout (e.g. 5s) to guarantee we yield keepalives
                # frequently enough to prevent Nginx or load balancers from dropping
                # the connection during long-running tool executions.
                event = event_queue.get(timeout=5)
            except queue.Empty:
                yield ": keepalive\n\n"
                continue

            yield f"data: {json.dumps(event)}\n\n"

            if event.get("type") == "done":
                break

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        }
    )


# -----------------------------------------------------------------------
# Sessions History API
# -----------------------------------------------------------------------

@app.route('/api/sessions', methods=['GET'])
def list_sessions():
    """Return a sorted list of past session metadata."""
    if not os.path.isdir(RUNS_DIR):
        return jsonify({'sessions': []})

    sessions = []
    for run_id in sorted(os.listdir(RUNS_DIR), reverse=True):
        meta_path = os.path.join(RUNS_DIR, run_id, "metadata.json")
        if os.path.isfile(meta_path):
            try:
                with open(meta_path) as f:
                    sessions.append(json.load(f))
            except Exception:
                pass
    return jsonify({'sessions': sessions})


@app.route('/api/sessions/<run_id>/transcript', methods=['GET'])
def get_transcript(run_id):
    """Return the transcript.md content for a run."""
    _validate_run_id(run_id)
    path = os.path.join(RUNS_DIR, run_id, "transcript.md")
    if not os.path.isfile(path):
        return jsonify({'content': ''}), 404
    with open(path) as f:
        return jsonify({'content': f.read()})


@app.route('/api/sessions/<run_id>/download', methods=['GET'])
def download_session_archive(run_id):
    """Download the entire session folder (transcript, tool calls, artifacts) as a .zip."""
    _validate_run_id(run_id)
    session_dir = os.path.join(RUNS_DIR, run_id)
    if not os.path.isdir(session_dir):
        abort(404, description="Session not found.")
    
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(session_dir):
            for file in files:
                file_path = os.path.join(root, file)
                # Compute the relative path so the zip structure is clean (e.g., transcript.md, artifacts/...)
                arcname = os.path.relpath(file_path, session_dir)
                zf.write(file_path, arcname)
                
    memory_file.seek(0)
    
    return send_file(
        memory_file,
        as_attachment=True,
        download_name=f"acosta_kali_mcp_run_{run_id}.zip",
        mimetype='application/zip'
    )


@app.route('/api/sessions/<run_id>/analyze', methods=['POST'])
def analyze_session(run_id):
    """Run a one-shot LLM analysis on a past session to identify improvements."""
    _validate_run_id(run_id)
    session_dir = os.path.join(RUNS_DIR, run_id)
    if not os.path.isdir(session_dir):
        abort(404, description="Session not found.")
        
    # Read Transcript
    transcript_path = os.path.join(session_dir, "transcript.md")
    transcript = ""
    if os.path.isfile(transcript_path):
        with open(transcript_path, 'r') as f:
            transcript = f.read()
            
    # Read Annotations
    annotations_path = os.path.join(session_dir, "annotations.jsonl")
    annotations = ""
    if os.path.isfile(annotations_path):
        with open(annotations_path, 'r') as f:
            annotations = f.read()

    if not transcript:
        return jsonify({"success": False, "error": "No transcript available for analysis."}), 400

    try:
        import ollama
        
        # Build prompt
        system_prompt = (
            "You are a Senior Penetration Testing Analyst reviewing a recent engagement. "
            "Your job is to read the attached transcript and user annotations, and provide a Post-Mortem Analysis in Markdown. "
            "Focus specifically on areas of improvement:\n"
            "1. Did the agent miss opportunities to use an existing tool that would have resulted in more efficient success?\n"
            "2. Could a new MCP tool be built or scripted to automate a tedious manual process seen in the logs?\n"
            "3. How efficiently did the agent leverage the user's annotations?\n"
            "Keep the response professional, actionable, and formatted nicely in Markdown."
        )
        
        user_prompt = f"### Transcript ###\n{transcript}\n\n### Annotations (JSON Lines) ###\n{'No annotations.' if not annotations else annotations}"
        
        # Truncate slightly if it's too huge, but Ollama standard windows might handle it
        client = ollama.Client(host=app.config.get('OLLAMA_URL', 'http://localhost:11434'))
        model = app.config.get('MCP_MODEL', 'llama3')
        
        resp = client.chat(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
        )
        
        analysis = resp.get("message", {}).get("content", "No analysis returned.")
        return jsonify({"success": True, "analysis": analysis})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/sessions/<run_id>/tool_calls', methods=['GET'])
def get_tool_calls(run_id):
    """Return a list of tool call records for a run."""
    _validate_run_id(run_id)
    tc_dir = os.path.join(RUNS_DIR, run_id, "tool_calls")
    if not os.path.isdir(tc_dir):
        return jsonify({'tool_calls': []})

    records = []
    for fname in sorted(os.listdir(tc_dir)):
        if fname.endswith(".json"):
            try:
                with open(os.path.join(tc_dir, fname)) as f:
                    records.append(json.load(f))
            except Exception:
                pass
    return jsonify({'tool_calls': records})


@app.route('/api/sessions/<run_id>/artifacts', methods=['GET'])
def list_artifacts(run_id):
    """Return a list of artifact filenames for a run."""
    _validate_run_id(run_id)
    art_dir = os.path.join(RUNS_DIR, run_id, "artifacts")
    if not os.path.isdir(art_dir):
        return jsonify({'artifacts': []})
    return jsonify({'artifacts': sorted(os.listdir(art_dir))})


@app.route('/api/sessions/<run_id>/artifacts/<filename>', methods=['GET'])
def get_artifact(run_id, filename):
    """Return the raw content of a specific artifact file."""
    _validate_run_id(run_id)
    _validate_filename(filename)
    path = os.path.join(RUNS_DIR, run_id, "artifacts", filename)
    if not os.path.isfile(path):
        abort(404)
    with open(path) as f:
        return jsonify({'filename': filename, 'content': f.read()})


def _validate_run_id(run_id: str):
    """Prevent path traversal in run_id."""
    import re
    if not re.match(r'^[\w\-\.]+$', run_id):
        abort(400, "Invalid run_id")


def _validate_filename(filename: str):
    """Prevent path traversal in artifact filename."""
    import re
    if not re.match(r'^[\w\-\.]+$', filename) or '..' in filename:
        abort(400, "Invalid filename")


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5055, debug=True)
