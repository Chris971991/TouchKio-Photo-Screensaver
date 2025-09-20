#!/usr/bin/env bash
# Enhanced TouchKio installer v2.1

# Read arguments
ARG_UPDATE=false
for arg in "$@"; do
  if [ "$arg" = "update" ]; then
    ARG_UPDATE=true
  fi
done

# Determine system architecture
echo -e "Determining system architecture..."

BITS=$(getconf LONG_BIT)
case "$(uname -m)" in
    aarch64)
        ARCH="arm64"
        ;;
    x86_64)
        ARCH="x64"
        ;;
    *)
        { echo "Architecture $(uname -m) running $BITS-bit operating system is not supported."; exit 1; }
        ;;
esac

[ "$BITS" -eq 64 ] || { echo "Architecture $ARCH running $BITS-bit operating system is not supported."; exit 1; }
echo "Architecture $ARCH running $BITS-bit operating system is supported."

# Install dependencies for building from source
echo -e "\nInstalling build dependencies..."

command -v apt &> /dev/null || { echo "Package manager apt was not found."; exit 1; }

# Install Node.js 18+ (required for Electron 38)
if ! command -v node &> /dev/null || [[ "$(node -v | cut -d'.' -f1 | sed 's/v//')" -lt 18 ]]; then
    echo "Installing Node.js 18..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install additional build dependencies
sudo apt-get update
sudo apt-get install -y git build-essential libnss3-dev libatk-bridge2.0-dev libdrm2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libxss1 libasound2

# Download and build enhanced TouchKio from source
echo -e "\nDownloading enhanced TouchKio source..."

TMP_DIR=$(mktemp -d)
chmod 755 "$TMP_DIR"
cd "$TMP_DIR"

# Clone the enhanced repository
git clone https://github.com/Chris971991/TouchKio-Photo-Screensaver.git || { echo "Failed to clone repository."; exit 1; }
cd TouchKio-Photo-Screensaver/touchkio

# Install npm dependencies
echo -e "\nInstalling TouchKio dependencies..."
npm install || { echo "Failed to install dependencies."; exit 1; }

# Build the .deb package
echo -e "\nBuilding TouchKio package..."
npm run build || { echo "Failed to build TouchKio."; exit 1; }

# Find the generated .deb file with absolute path
DEB_FULL_PATH=$(find "$(pwd)/out/make" -name "*.deb" | head -n1)
[ -z "$DEB_FULL_PATH" ] && { echo "Built .deb file not found."; exit 1; }

echo "Found built package: $DEB_FULL_PATH"

# Install the built .deb package using dpkg (more reliable for local files)
echo -e "\nInstalling enhanced TouchKio..."
sudo dpkg -i "$DEB_FULL_PATH" || { echo "Installation of built .deb file failed."; exit 1; }

# Fix any missing dependencies
sudo apt-get install -f -y

# Create the systemd user service
echo -e "\nCreating systemd user service..."

SERVICE_NAME="touchkio.service"
SERVICE_FILE="$HOME/.config/systemd/user/$SERVICE_NAME"
mkdir -p "$(dirname "$SERVICE_FILE")" || { echo "Failed to create directory for $SERVICE_FILE."; exit 1; }

SERVICE_CONTENT="[Unit]
Description=TouchKio
After=graphical-session.target
Wants=network-online.target

[Service]
Type=simple
Environment="DISPLAY=:0"
Environment="XAUTHORITY=/home/%u/.Xauthority"
Environment="XDG_RUNTIME_DIR=/run/user/%U"
ExecStartPre=/bin/bash -c 'until pgrep -x Xorg || pgrep -x Xwayland; do sleep 2; done'
ExecStartPre=/bin/bash -c 'pkill -f touchkio || true'
ExecStart=/usr/bin/touchkio
Restart=always
RestartSec=10s
StartLimitInterval=60s
StartLimitBurst=3

[Install]
WantedBy=default.target"

if $ARG_UPDATE; then
  if systemctl --user --quiet is-active "${SERVICE_NAME}"; then
    systemctl --user restart "${SERVICE_NAME}"
    echo "Existing $SERVICE_NAME restarted."
  else
    echo "Existing $SERVICE_NAME not running, start touchkio manually."
  fi
  exit 0
fi

SERVICE_CREATE=true
if [ -f "$SERVICE_FILE" ]; then
    read -p "Service $SERVICE_FILE exists, overwrite? (y/N) " overwrite
    [[ ${overwrite:-n} == [Yy]* ]] || SERVICE_CREATE=false
fi

if $SERVICE_CREATE; then
    echo "$SERVICE_CONTENT" > "$SERVICE_FILE" || { echo "Failed to write to $SERVICE_FILE."; exit 1; }
    systemctl --user enable "$(basename "$SERVICE_FILE")" || { echo "Failed to enable service $SERVICE_FILE."; exit 1; }
    echo "Service $SERVICE_FILE enabled."
else
    echo "Service $SERVICE_FILE not created."
fi

# Export display variables
echo -e "\nExporting display variables..."

if [ -z "$DISPLAY" ]; then
    export DISPLAY=":0"
    echo "DISPLAY was not set, defaulting to \"$DISPLAY\"."
else
    echo "DISPLAY is set to \"$DISPLAY\"."
fi

if [ -z "$WAYLAND_DISPLAY" ]; then
    export WAYLAND_DISPLAY="wayland-0"
    echo "WAYLAND_DISPLAY was not set, defaulting to \"$WAYLAND_DISPLAY\"."
else
    echo "WAYLAND_DISPLAY is set to \"$WAYLAND_DISPLAY\"."
fi

# Enhanced TouchKio is already built with slideshow features!
echo -e "\nEnhanced TouchKio with slideshow features has been installed successfully."
echo "All slideshow files are already included in the built package."

# Cleanup build directory
rm -rf "$TMP_DIR"

# Create photos directory with sample images
echo ""
mkdir -p "$HOME/TouchKio-Photo-Screensaver/photos"
echo "Created photos directory at $HOME/TouchKio-Photo-Screensaver/photos"

# Download sample images
echo "Adding sample slideshow images..."
cd "$HOME/TouchKio-Photo-Screensaver/photos"

# Download some generic sample images (landscape/nature photos)
wget -q "https://picsum.photos/1920/1080?random=1" -O sample1.jpg
wget -q "https://picsum.photos/1920/1080?random=2" -O sample2.jpg
wget -q "https://picsum.photos/1920/1080?random=3" -O sample3.jpg
wget -q "https://picsum.photos/1920/1080?random=4" -O sample4.jpg
wget -q "https://picsum.photos/1920/1080?random=5" -O sample5.jpg

echo "Added 5 sample images for immediate slideshow functionality"
echo "Replace with your own photos or configure Google Photos albums via Home Assistant"

# Run TouchKio setup with slideshow files already installed
echo ""
echo "Starting TouchKio setup with slideshow features..."
echo "TouchKio will prompt you for configuration (MQTT, web URL, etc.)"
echo "For web URL, you can use: file:///usr/lib/touchkio/resources/app/html/slideshow.html"
echo "Or use your Home Assistant URL and switch to slideshow later via MQTT."
echo ""

# Stop any existing TouchKio processes before setup
echo "Stopping any existing TouchKio processes..."
pkill -f touchkio || true
systemctl --user stop touchkio.service || true
sleep 2

# Run TouchKio in interactive setup mode with proper TTY handling
export DISPLAY=":0"
export WAYLAND_DISPLAY="wayland-0"

echo "Running TouchKio setup..."
/usr/bin/touchkio --setup < /dev/tty

# Enable lingering for user to allow user services to run without being logged in
sudo loginctl enable-linger "$USER"

# Reload systemd and enable service (but don't start yet)
systemctl --user daemon-reload
systemctl --user enable touchkio.service

echo ""
echo "TouchKio setup completed!"

# Verify configuration was created
CONFIG_FILE="$HOME/.config/touchkio/Arguments.json"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "ERROR: TouchKio configuration not found at $CONFIG_FILE"
    echo "Setup may have failed. Please run setup manually:"
    echo "  /usr/bin/touchkio --setup"
    exit 1
fi

echo "Configuration created successfully at $CONFIG_FILE"

# Configuration enhancement completed, now fix and start the service
echo "Fixing TouchKio service configuration..."

# Fix the problematic pkill line that kills the service on startup
sed -i '/ExecStartPre.*pkill -f touchkio/d' ~/.config/systemd/user/touchkio.service

# Reload systemd configuration
systemctl --user daemon-reload

echo "Starting TouchKio service..."
systemctl --user start touchkio.service

# Wait a moment for service to start
sleep 3

echo "Service status:"
systemctl --user status touchkio.service --no-pager

# Post-setup configuration enhancement
echo ""
echo "Enhancing slideshow configuration..."

if [ -f "$CONFIG_FILE" ]; then
    # Check if slideshow UI settings need to be added
    if ! grep -q "slideshow_clock_enabled\\|slideshow_date_enabled" "$CONFIG_FILE"; then
        echo "Adding slideshow UI settings to configuration..."
        # Backup existing config
        cp "$CONFIG_FILE" "${CONFIG_FILE}.backup"

        # Add slideshow settings using jq, preserving user-configured values
        if command -v jq &> /dev/null; then
            # Read user's configured values and only add missing slideshow UI settings
            jq '. + {
                "slideshow_clock_enabled": (if .slideshow_show_clock then (.slideshow_show_clock | test("true|ON"; "i")) else true end),
                "slideshow_date_enabled": true,
                "slideshow_source_indicator_enabled": (if .slideshow_show_source then (.slideshow_show_source | test("true|ON"; "i")) else true end),
                "slideshow_photo_counter_enabled": (if .slideshow_show_counter then (.slideshow_show_counter | test("true|ON"; "i")) else true end)
            }' "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
        elif command -v python3 &> /dev/null; then
            # Fallback to python but preserve existing password encryption
            python3 -c "
import json
import sys
import os

try:
    # Read existing config as text first to preserve any special formatting
    with open('$CONFIG_FILE', 'r') as f:
        content = f.read()

    # Parse JSON
    config = json.loads(content)

    # Add only missing slideshow UI settings (preserve user's configured values)
    slideshow_ui_settings = {
        'slideshow_clock_enabled': config.get('slideshow_show_clock', 'true').lower() in ['true', 'on', '1'],
        'slideshow_date_enabled': True,
        'slideshow_source_indicator_enabled': config.get('slideshow_show_source', 'true').lower() in ['true', 'on', '1'],
        'slideshow_photo_counter_enabled': config.get('slideshow_show_counter', 'true').lower() in ['true', 'on', '1']
    }

    # Only add UI settings that don't exist (preserve ALL user setup choices)
    for key, value in slideshow_ui_settings.items():
        if key not in config:
            config[key] = value

    # Write back preserving original formatting as much as possible
    with open('$CONFIG_FILE', 'w') as f:
        json.dump(config, f, indent=2)

except Exception as e:
    print(f'Warning: Could not modify config safely: {e}')
    exit(1)
"
            echo "Slideshow configuration added."
        else
            echo "Python3 not available, slideshow config not applied"
        fi
    else
        echo "Slideshow settings already present in configuration."
    fi
else
    echo "TouchKio config not found - setup may not have completed properly."
fi

echo ""
echo "✓ TouchKio enhanced slideshow installer completed!"
echo ""
echo "TouchKio should now be running with slideshow capabilities:"
echo "1. If you set web URL to slideshow.html, you'll see the slideshow immediately"
echo "2. If you used Home Assistant URL, MQTT slideshow controls are available"
echo "3. Check Home Assistant for new MQTT slideshow entities"
echo "4. Configure slideshow settings, Google Photos albums, timing, etc. via HA"
echo "5. Sample images are ready in: ~/TouchKio-Photo-Screensaver/photos"
echo ""

# Provide instructions for viewing live logs
echo ""
echo "🔍 To view live TouchKio logs, use any of these commands:"
echo "   Option 1 (Simple): sudo journalctl -f | grep touchkio"
echo "   Option 2 (Clean):  sudo journalctl -f --no-hostname --output=short | grep touchkio"
echo "   Option 3 (Window): lxterminal --title='TouchKio Logs' --command='sudo journalctl -f | grep touchkio' &"
echo "   Option 4 (Recent): sudo journalctl -n 20 -f | grep touchkio"
echo ""
echo "💡 Press Ctrl+C to exit log viewing"

exit 0
