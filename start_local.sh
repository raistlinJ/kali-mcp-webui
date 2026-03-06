#!/bin/bash
# script to safely initialize environments and run the Kali WebUI locally

# Exit on any error
set -e

echo "[kali-mcp-webui] Checking for required tools..."

# 1. Install pipx globally if missing
if ! command -v pipx &> /dev/null; then
    echo "Installing pipx..."
    sudo apt update && sudo apt install -y pipx
fi

# 2. Install ollmcp globally into /usr/local/bin so sudo can see it
echo "[kali-mcp-webui] Checking for ollmcp..."
if [ ! -x /usr/local/bin/ollmcp ]; then
    echo "Installing ollmcp globally..."
    sudo env PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install mcp-client-for-ollama
fi

echo "[kali-mcp-webui] Setting up python virtual environment via uv..."

# 3. Ensure uv is installed
if ! command -v uv &> /dev/null; then
    echo "Installing uv locally..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

# 4. Pre-cache uv dependencies for offline support
if [[ "$*" == *"--build"* ]]; then
    echo "[kali-mcp-webui] Pre-caching Python dependencies for offline support..."
    uv run --with mcp --with requests --with flask python3 -c "print('Dependencies cached.')" 2>/dev/null || true
fi

# Start kali_server.py REST API in the background (required for APT package mode)
if [ -f /usr/share/mcp-kali-server/kali_server.py ]; then
    echo "[kali-mcp-webui] Starting kali_server.py REST API on port 5000..."
    pkill -f 'kali_server.py' 2>/dev/null; sleep 1
    setsid python3 /usr/share/mcp-kali-server/kali_server.py >/tmp/kali_server.log 2>&1 &
    # Wait up to 30s for it to be ready
    for i in $(seq 1 30); do
        nc -z localhost 5000 2>/dev/null && echo "[kali-mcp-webui] kali_server.py ready on port 5000" && break
        sleep 1
    done
else
    echo "[kali-mcp-webui] Skipping kali_server.py (not found — APT package mode unavailable)"
fi

# Use uv to run the flask application automatically handling requirements
echo "[kali-mcp-webui] Starting Flask server..."
if [[ "$*" == *"--build"* ]]; then
    echo "[kali-mcp-webui] --build flag detected, reinstalling dependencies..."
    uv sync --reinstall
fi
uv run --with Flask --with requests --with mcp-client-for-ollama app.py
