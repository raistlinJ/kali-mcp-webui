#!/bin/bash
# script to safely initialize host dependencies and run the Kali WebUI in Docker

# Exit on any error
set -e

echo "[kali-mcp-webui] Checking for required host tools..."

# 1. Install pipx globally if missing
if ! command -v pipx &> /dev/null; then
    echo "Installing pipx..."
    sudo apt update && sudo apt install -y pipx
fi

# 2. Install ollmcp globally into /usr/local/bin so sudo can see it
echo "[kali-mcp-webui] Checking for ollmcp..."
if ! command -v ollmcp &> /dev/null; then
    echo "Installing ollmcp globally..."
    sudo env PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install mcp-client-for-ollama
fi

# 3. Install uv globally into /usr/local/bin so sudo can see it dynamically
echo "[kali-mcp-webui] Checking for uv..."
if ! command -v uv &> /dev/null; then
    echo "Installing uv globally..."
    sudo env UV_UNMANAGED_INSTALL="/usr/local/bin" sh -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'
fi

echo "[kali-mcp-webui] Starting Docker Compose..."
if [[ "$*" == *"--build"* ]]; then
    echo "[kali-mcp-webui] --build flag detected, rebuilding image..."
    docker-compose up -d --build
else
    docker-compose up -d
fi

# Start kali_server.py REST API in the background (required for APT package mode)
if command -v uv &>/dev/null && [ -f /usr/share/mcp-kali-server/kali_server.py ]; then
    echo "[kali-mcp-webui] Starting kali_server.py REST API on port 5000..."
    pkill -f 'kali_server.py' 2>/dev/null; sleep 1
    setsid python3 /usr/share/mcp-kali-server/kali_server.py >/tmp/kali_server.log 2>&1 &
    # Wait up to 30s for it to be ready
    for i in $(seq 1 30); do
        nc -z localhost 5000 2>/dev/null && echo "[kali-mcp-webui] kali_server.py ready on port 5000" && break
        sleep 1
    done
else
    echo "[kali-mcp-webui] Skipping kali_server.py (not found or uv not installed — APT package mode unavailable)"
fi

echo "[kali-mcp-webui] WebUI is running on http://localhost:5055"
