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

echo "[kali-mcp-webui] WebUI is running on http://localhost:5055"
