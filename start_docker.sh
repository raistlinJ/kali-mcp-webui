#!/bin/bash
# script to safely initialize host dependencies and run the Kali WebUI in Docker

# Exit on any error
set -e

echo "[kali-mcp-webui] Checking for required host tools..."

# 1. Check for npm (required to run the Kali server via NPX on the host)
if ! command -v npm &> /dev/null; then
    echo "Installing npm on the host..."
    sudo apt update && sudo apt install -y npm
fi

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

echo "[kali-mcp-webui] Starting Docker Compose..."
docker-compose up -d --build

echo "[kali-mcp-webui] WebUI is running on http://localhost:5055"
