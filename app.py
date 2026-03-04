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
    
    if not model:
        return jsonify({'success': False, 'error': 'No model selected'}), 400
    if not server_command:
        return jsonify({'success': False, 'error': 'No server command provided'}), 400
        
    try:
        # Create a temporary JSON configuration for the server
        command_parts = shlex.split(server_command)
        
        server_config = {
            "mcpServers": {
                "mcp-kali-server": {
                    "command": command_parts[0],
                    "args": command_parts[1:]
                }
            }
        }
        
        # Save JSON to a known temp location or just a file in current dir
        config_path = os.path.abspath('server_config.json')
        with open(config_path, 'w') as f:
            json.dump(server_config, f)
            
        venv_activate = os.path.abspath('venv/bin/activate')
        
        # AppleScript to launch a native terminal window running ollmcp
        script = f'''
        tell application "Terminal"
            activate
            do script "source {shlex.quote(venv_activate)} && ollmcp --model {shlex.quote(model)} --host {shlex.quote(ollama_url)} --servers-json {shlex.quote(config_path)}"
        end tell
        '''
        
        process = subprocess.run(
            ['osascript', '-e', script], 
            capture_output=True, 
            text=True, 
            timeout=10
        )
        
        if process.returncode == 0:
            return jsonify({
                'success': True, 
                'message': f'Launched ollmcp terminal with {model}',
                'status': 'connected'
            })
        else:
            return jsonify({
                'success': False, 
                'error': f'AppleScript failed: {process.stderr}'
            }), 500
            
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5055, debug=True)
