from flask import Flask, render_template, request, jsonify
import requests
import subprocess
import os
import json
import shlex
import tempfile

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/models', methods=['POST'])
def get_models():
    data = request.json
    ollama_url = data.get('url', 'http://localhost:11434')
    
    try:
        # Fetch tags from Ollama API
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
    
    if not model:
        return jsonify({'success': False, 'error': 'No model selected'}), 400
    if not server_command:
        return jsonify({'success': False, 'error': 'No server command provided'}), 400
        
    try:
        if tools_config:
            with open(os.path.abspath('kali_tools.json'), 'w') as f:
                json.dump(tools_config, f, indent=2)
            
        command_parts = shlex.split(server_command)

        server_config = {
            "mcpServers": {
                "mcp-kali-server": {
                    "command": command_parts[0],
                    "args": command_parts[1:]
                }
            }
        }

        # Save JSON files to the local directory (which maps back to the host via Docker Volumes)
        with open(os.path.abspath('server_config.json'), 'w') as f:
            json.dump(server_config, f, indent=2)

        # We generate a self-contained shell script that physical builds the exact server_config.json on the user's Kali VM before running ollmcp.
        # This completely skips the need to rely on git or SCP to transfer the dynamically generated JSON to the VM.
        json_output = json.dumps(server_config, indent=2)
        
        cmd_string = f"# Note: Ensure your Python virtual environment is activated before running (e.g., 'source venv/bin/activate')\n"
        if "kali_server.py" in server_command:
            cmd_string += f"# (The background Kali REST API will be launched automatically by ollmcp via server_config.json)\n"
            
        cmd_string += f"cat << 'EOF' > ./server_config.json\n{json_output}\nEOF\n\n"
        cmd_string += f"ollmcp --model {shlex.quote(model)} --host {shlex.quote(ollama_url)} --servers-json ./server_config.json"
        
        return jsonify({
            'success': True, 
            'message': 'Command generated successfully',
            'status': 'connected',
            'command': cmd_string
        })
            
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5055, debug=True)
