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
if ! command -v ollmcp &> /dev/null; then
    echo "Installing ollmcp globally..."
    sudo env PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install mcp-client-for-ollama
fi

echo "[kali-mcp-webui] Setting up python virtual environment via uv..."

# 3. Ensure uv is installed globally in /usr/local/bin
if ! command -v uv &> /dev/null; then
    echo "Installing uv globally..."
    sudo env UV_UNMANAGED_INSTALL="/usr/local/bin" sh -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'
fi

# Use uv to run the flask application automatically handling requirements
echo "[kali-mcp-webui] Starting Flask server..."
if [[ "$*" == *"--build"* ]]; then
    echo "[kali-mcp-webui] --build flag detected, reinstalling dependencies..."
    uv sync --reinstall
fi
uv run --with Flask --with requests --with mcp-client-for-ollama app.py
