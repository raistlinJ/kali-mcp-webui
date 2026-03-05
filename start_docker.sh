#!/bin/bash
# script to safely initialize host dependencies and run the Kali WebUI in Docker

# Exit on any error
set -e

echo "[kali-mcp-webui] Checking for required host tools..."


# 2. Check for pipx or uv to install ollmcp globally
echo "[kali-mcp-webui] Checking for ollmcp..."
if ! command -v ollmcp &> /dev/null; then
    echo "Installing ollmcp globally via pipx..."
    if ! command -v pipx &> /dev/null; then
        echo "Installing pipx..."
        sudo apt update && sudo apt install -y pipx
        pipx ensurepath
    fi
    export PATH="$PATH:$HOME/.local/bin"
    pipx install mcp-client-for-ollama
fi

# 3. Ensure uv is installed on the host to run the python server/dependencies dynamically
echo "[kali-mcp-webui] Checking for uv..."
if ! command -v uv &> /dev/null; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    if [ -f "$HOME/.local/bin/env" ]; then
        source "$HOME/.local/bin/env"
    elif [ -f "$HOME/.cargo/env" ]; then
        source "$HOME/.cargo/env"
    fi
fi

echo "[kali-mcp-webui] Starting Docker Compose..."
docker-compose up -d --build

echo "[kali-mcp-webui] WebUI is running on http://localhost:5055"
