#!/bin/bash
# script to safely initialize environments and run the Kali WebUI locally

# Exit on any error
set -e

# Determine the real user and home directory in case the script is run with sudo
REAL_USER=${SUDO_USER:-$USER}
# Use getent or eval to find the real home directory safely
REAL_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)

# Ensure ~/.local/bin and ~/.cargo/bin are in PATH so we can find pipx and uv
export PATH="$REAL_HOME/.cargo/bin:$REAL_HOME/.local/bin:$PATH"

echo "[kali-mcp-webui] Checking for required tools..."


# 2. Check for pipx or uv to install ollmcp globally
echo "[kali-mcp-webui] Checking for ollmcp..."
if ! command -v ollmcp &> /dev/null; then
    echo "Installing ollmcp globally via pipx..."
    if ! command -v pipx &> /dev/null; then
        echo "Installing pipx..."
        sudo apt update && sudo apt install -y pipx
        if [ -n "$SUDO_USER" ]; then
            sudo -u "$REAL_USER" pipx ensurepath
        else
            pipx ensurepath
        fi
    fi
    if [ -n "$SUDO_USER" ]; then
        sudo -u "$REAL_USER" pipx install mcp-client-for-ollama
    else
        pipx install mcp-client-for-ollama
    fi
fi

echo "[kali-mcp-webui] Setting up python virtual environment via uv..."

# Ensure uv is installed
if ! command -v uv &> /dev/null; then
    echo "Installing uv..."
    if [ -n "$SUDO_USER" ]; then
        sudo -u "$REAL_USER" sh -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'
    else
        curl -LsSf https://astral.sh/uv/install.sh | sh
    fi
    if [ -f "$REAL_HOME/.local/bin/env" ]; then
        source "$REAL_HOME/.local/bin/env"
    elif [ -f "$REAL_HOME/.cargo/env" ]; then
        source "$REAL_HOME/.cargo/env"
    fi
fi

# Use uv to run the flask application automatically handling requirements
echo "[kali-mcp-webui] Starting Flask server..."
uv run --with Flask --with requests --with mcp-client-for-ollama app.py
