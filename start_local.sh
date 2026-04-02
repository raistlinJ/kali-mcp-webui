#!/bin/bash
# script to safely initialize environments and run the Kali WebUI locally

echo "[kali-mcp-webui] Checking for required tools..."

echo "[kali-mcp-webui] Setting up python virtual environment via uv..."

# 1. Ensure uv is installed
if ! command -v uv &> /dev/null; then
    if [ -x "$HOME/.local/bin/uv" ]; then
        export PATH="$HOME/.local/bin:$PATH"
    else
        echo "Installing uv locally..."
        curl -LsSf https://astral.sh/uv/install.sh | sh
        export PATH="$HOME/.local/bin:$PATH"
    fi
fi

UV_BIN=$(command -v uv || echo "$HOME/.local/bin/uv")

# 2. Pre-cache uv dependencies for offline support
if [[ "$*" == *"--build"* ]]; then
    echo "[kali-mcp-webui] Pre-caching Python dependencies for offline support..."
    "$UV_BIN" run --with mcp --with requests --with flask --with ollama --with pynput python3 -c "print('Dependencies cached.')" 2>/dev/null || true
fi

# Start kali_server.py REST API in the background (required for APT package mode)
if [ -f /usr/share/mcp-kali-server/kali_server.py ]; then
    echo "[kali-mcp-webui] Starting kali_server.py REST API on port 5000..."
    pkill -f 'kali_server.py' 2>/dev/null || true; sleep 1
    setsid "$UV_BIN" run --offline --with flask python3 /usr/share/mcp-kali-server/kali_server.py >/tmp/kali_server.log 2>&1 &
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
    "$UV_BIN" sync --reinstall
    "$UV_BIN" run --with Flask --with requests --with mcp --with ollama --with pynput app.py
else
    "$UV_BIN" run --with Flask --with requests --with mcp --with ollama --with pynput app.py
fi
