#!/bin/bash
# script to safely initialize environments and run the Kali WebUI locally

# Exit on any error
set -e

# Ensure ~/.local/bin is in PATH
export PATH="$HOME/.local/bin:$PATH"

echo "[kali-mcp-webui] Checking for required tools..."

# 1. Check for npm (required to run the Kali server)
if ! command -v npm &> /dev/null; then
    echo "ERROR: 'npm' is not installed."
    echo "Please install it via 'sudo apt install npm' before running the local WebUI."
    exit 1
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
    pipx install mcp-client-for-ollama
fi

echo "[kali-mcp-webui] Setting up python virtual environment via uv..."

# Ensure uv is installed
if ! command -v uv &> /dev/null; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    if [ -f "$HOME/.local/bin/env" ]; then
        source "$HOME/.local/bin/env"
    elif [ -f "$HOME/.cargo/env" ]; then
        source "$HOME/.cargo/env"
    fi
fi

# Use uv to run the flask application automatically handling requirements
echo "[kali-mcp-webui] Starting Flask server..."
uv run --with Flask --with requests --with mcp-client-for-ollama app.py
