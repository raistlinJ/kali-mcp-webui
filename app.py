from flask import Flask, render_template, request, jsonify, abort
import requests
import subprocess
import os
import json
import shlex
import tempfile
from datetime import datetime

app = Flask(__name__)

# Path to runs/ directory (co-located with app.py)
RUNS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs")


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


@app.route('/api/connect', methods=['POST'])
def connect_ollmcp():
    data = request.json
    ollama_url = data.get('url', 'http://localhost:11434')
    model = data.get('model')
    server_command = data.get('server_command')
    tools_config = data.get('tools_config')
    pty_logging = data.get('pty_logging', False)  # disabled by default

    if not model:
        return jsonify({'success': False, 'error': 'No model selected'}), 400
    if not server_command:
        return jsonify({'success': False, 'error': 'No server command provided'}), 400
        
    try:
        if tools_config:
            with open(os.path.abspath('kali_tools.json'), 'w') as f:
                json.dump(tools_config, f, indent=2)

        is_apt = "/usr/share/mcp-kali-server/mcp_server.py" in server_command
        is_native = "mcp_kali.py" in server_command or "apt_logger_wrapper.py" in server_command

        # Generate unique run ID for this session
        server_type = "apt" if is_apt else "native"
        run_id = _make_run_id(server_type)

        # Build env var exports to inject into the shell command
        env_exports = (
            f"export MCP_RUN_ID={shlex.quote(run_id)} "
            f"MCP_MODEL={shlex.quote(model)} "
            f"MCP_OLLAMA_URL={shlex.quote(ollama_url)}"
        )

        command_parts = shlex.split(server_command)

        server_config = {
            "mcpServers": {
                "mcp-kali-server": {
                    "command": command_parts[0],
                    "args": command_parts[1:]
                }
            }
        }

        with open(os.path.abspath('server_config.json'), 'w') as f:
            json.dump(server_config, f, indent=2)

        # Build the copy-paste shell snippet
        cmd_string = f"# Note: Ensure your Python virtual environment is activated before running (e.g., 'source venv/bin/activate')\n"
        cmd_string += f"# Session run ID: {run_id}\n"
        cmd_string += f"{env_exports}\n\n"

        if is_apt:
            # kali_server.py is now started by start_docker.sh / start_local.sh.
            # If for some reason it's not up, restart it here; otherwise just wait.
            cmd_string += f"# Step 1: Ensure kali_server.py REST API is running (started automatically by start_docker/start_local)\n"
            cmd_string += (
                f"nc -z localhost 5000 2>/dev/null || {{\n"
                f"  echo 'kali_server.py not detected \u2014 starting now...'\n"
                f"  pkill -f 'kali_server.py' 2>/dev/null || true; sleep 1\n"
                f"  setsid uv run --with flask python3 /usr/share/mcp-kali-server/kali_server.py >/tmp/kali_server.log 2>&1 &\n"
                f"}}\n\n"
            )
            cmd_string += f"# Step 2: Wait for port 5000 to be ready (up to 90s)\n"
            cmd_string += (
                f"for i in $(seq 1 90); do\n"
                f"  nc -z localhost 5000 2>/dev/null && echo 'API ready!' && break\n"
                f"  sleep 1\n"
                f"done\n"
            )

        # Choose the MCP client launcher
        if pty_logging:
            launcher = f"python3 ollmcp_logger.py"
        else:
            launcher = f"ollmcp"

        cmd_string += f"{launcher} --model {shlex.quote(model)} --host {shlex.quote(ollama_url)} --servers-json ./server_config.json"
        
        return jsonify({
            'success': True,
            'run_id': run_id,
            'message': 'Command generated successfully',
            'status': 'connected',
            'command': cmd_string
        })
            
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# -----------------------------------------------------------------------
# Sessions API
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
