from flask import Flask, render_template, request, jsonify, abort, Response
import requests
import subprocess
import os
import json
import shlex
import threading
import asyncio
import queue
import time
from datetime import datetime

app = Flask(__name__)

# Path to runs/ directory (co-located with app.py)
RUNS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs")

# ---------------------------------------------------------------------------
# Active session tracking
# ---------------------------------------------------------------------------
# run_id → {"thread", "cancel_event", "queue", "status"}
_active_sessions: dict[str, dict] = {}
_sessions_lock = threading.Lock()


def _make_run_id(server_type: str) -> str:
    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    return f"{ts}_{server_type}"


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
# Agent Run API
# -----------------------------------------------------------------------

@app.route('/api/run', methods=['POST'])
def start_run():
    """Launch the MCP agent loop in a background thread."""
    data = request.json
    ollama_url = data.get('url', 'http://localhost:11434')
    model = data.get('model')
    server_command = data.get('server_command')
    tools_config = data.get('tools_config')
    prompt = data.get('prompt', '').strip()
    context_window = int(data.get('context_window', 8192))

    if not model:
        return jsonify({'success': False, 'error': 'No model selected'}), 400
    if not server_command:
        return jsonify({'success': False, 'error': 'No server command provided'}), 400
    if not prompt:
        return jsonify({'success': False, 'error': 'No prompt provided'}), 400

    try:
        # Write tools config if provided
        if tools_config:
            with open(os.path.abspath('kali_tools.json'), 'w') as f:
                json.dump(tools_config, f, indent=2)

        is_apt = "/usr/share/mcp-kali-server/mcp_server.py" in server_command
        server_type = "apt" if is_apt else "native"
        run_id = _make_run_id(server_type)

        # Thread-safe event queue for SSE
        event_queue = queue.Queue(maxsize=500)
        cancel_event_async = None  # Will be set inside the thread

        def event_callback(event: dict):
            event["timestamp"] = datetime.now().isoformat()
            try:
                event_queue.put_nowait(event)
            except queue.Full:
                pass  # drop if consumer is too slow

        def run_in_thread():
            import mcp_client
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            cancel_evt = asyncio.Event()

            with _sessions_lock:
                _active_sessions[run_id]["cancel_event_async"] = cancel_evt
                _active_sessions[run_id]["loop"] = loop

            try:
                loop.run_until_complete(mcp_client.run_agent(
                    ollama_url=ollama_url,
                    model=model,
                    server_command=server_command,
                    prompt=prompt,
                    run_id=run_id,
                    event_callback=event_callback,
                    cancel_event=cancel_evt,
                    context_window=context_window,
                ))
            except Exception as exc:
                event_callback({"type": "error", "message": str(exc)})
            finally:
                event_callback({"type": "done", "message": "Session ended."})
                with _sessions_lock:
                    if run_id in _active_sessions:
                        _active_sessions[run_id]["status"] = "finished"
                loop.close()

        thread = threading.Thread(target=run_in_thread, daemon=True)

        with _sessions_lock:
            _active_sessions[run_id] = {
                "thread": thread,
                "queue": event_queue,
                "status": "running",
                "cancel_event_async": None,
                "loop": None,
            }

        thread.start()

        return jsonify({
            'success': True,
            'run_id': run_id,
            'message': 'Agent session started.',
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/run/<run_id>/stop', methods=['POST'])
def stop_run(run_id):
    """Cancel a running agent session."""
    _validate_run_id(run_id)
    with _sessions_lock:
        session = _active_sessions.get(run_id)
    if not session:
        return jsonify({'success': False, 'error': 'Session not found'}), 404

    cancel_evt = session.get("cancel_event_async")
    loop = session.get("loop")
    if cancel_evt and loop:
        loop.call_soon_threadsafe(cancel_evt.set)
    return jsonify({'success': True, 'message': 'Stop signal sent.'})


@app.route('/api/logs/<run_id>/stream')
def stream_logs(run_id):
    """SSE endpoint — streams real-time events for a run."""
    _validate_run_id(run_id)
    with _sessions_lock:
        session = _active_sessions.get(run_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404

    event_queue = session["queue"]

    def generate():
        while True:
            try:
                event = event_queue.get(timeout=30)
            except queue.Empty:
                # Send keep-alive comment
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
# Sessions API (unchanged)
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
