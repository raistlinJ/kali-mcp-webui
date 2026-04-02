#!/bin/bash
# install_prerequisites.sh
# Installs required system packages for Kali MCP WebUI keylogger support
# Supports Kali Linux 2025.x and 2026.x

set -e

echo "[prerequisites] Checking system prerequisites..."

# Detect distribution
if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO_ID="$ID"
    DISTRO_VERSION="$VERSION_ID"
else
    echo "[prerequisites] ERROR: Could not detect distribution"
    exit 1
fi

echo "[prerequisites] Detected: $DISTRO_ID $DISTRO_VERSION"

# Check if running as root (required for apt)
if [ "$EUID" -ne 0 ] && command -v sudo &> /dev/null; then
    echo "[prerequisites] Using sudo for package installation..."
    SUDO="sudo"
elif [ "$EUID" -ne 0 ]; then
    echo "[prerequisites] ERROR: Root privileges required. Please run with sudo."
    exit 1
else
    SUDO=""
fi

# Install Linux-specific keylogger dependencies
if [ "$DISTRO_ID" = "kali" ]; then
    echo "[prerequisites] Kali Linux detected - installing keylogger dependencies..."
    
    # Update package lists
    $SUDO apt-get update -qq
    
    # Install xdotool for active window detection (required for system keylogger)
    echo "[prerequisites] Installing xdotool..."
    $SUDO apt-get install -y -qq xdotool xprop
    
    # Install psutil dependencies (for process info)
    echo "[prerequisites] Installing python3-psutil..."
    $SUDO apt-get install -y -qq python3-psutil
    
    echo "[prerequisites] Kali Linux prerequisites installed successfully!"
    echo "[prerequisites] The system keylogger will now be able to detect active windows."
elif [ "$DISTRO_ID" = "debian" ]; then
    echo "[prerequisites] Debian detected - installing keylogger dependencies..."
    
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq xdotool xproc python3-psutil
    
    echo "[prerequisites] Debian prerequisites installed successfully!"
elif [ "$DISTRO_ID" = "ubuntu" ]; then
    echo "[prerequisites] Ubuntu detected - installing keylogger dependencies..."
    
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq xdotool xproc python3-psutil
    
    echo "[prerequisites] Ubuntu prerequisites installed successfully!"
else
    echo "[prerequisites] WARNING: Unknown distribution '$DISTRO_ID'"
    echo "[prerequisites] Please manually install the following packages:"
    echo "[prerequisites]   - xdotool (for active window detection)"
    echo "[prerequisites]   - xprop (for window class detection)"
    echo "[prerequisites]   - python3-psutil (for process information)"
fi

# Verify installation
echo "[prerequisites] Verifying installation..."
if command -v xdotool &> /dev/null; then
    echo "[prerequisites] ✓ xdotool is installed"
else
    echo "[prerequisites] ✗ xdotool is NOT installed - system keylogger window detection will be limited"
fi

if command -v xprop &> /dev/null; then
    echo "[prerequisites] ✓ xprop is installed"
else
    echo "[prerequisites] ✗ xprop is NOT installed - system keylogger window detection will be limited"
fi

echo ""
echo "[prerequisites] Installation complete!"
echo "[prerequisites] To enable the system keylogger in the WebUI:"
echo "[prerequisites]   1. Start the WebUI: ./start_local.sh"
echo "[prerequisites]   2. Go to Configuration tab"
echo "[prerequisites]   3. Enable 'Keylogging' toggle"
echo ""
echo "[prerequisites] Note: You may need to grant Accessibility permissions for the terminal/Python"
echo "[prerequisites]       to capture system-wide keystrokes on some systems."