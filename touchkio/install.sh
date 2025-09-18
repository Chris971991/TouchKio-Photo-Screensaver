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

# Download the latest .deb package
echo -e "\nDownloading the latest release..."

TMP_DIR=$(mktemp -d)
DEB_URL=$(wget -qO- https://api.github.com/repos/leukipp/touchkio/releases/latest | \
grep -o "\"browser_download_url\": \"[^\"]*_${ARCH}\.deb\"" | \
sed 's/"browser_download_url": "//;s/"//g')
DEB_PATH="${TMP_DIR}/$(basename "$DEB_URL")"
chmod 755 "$TMP_DIR"

[ -z "$DEB_URL" ] && { echo "Download url for .deb file not found."; exit 1; }
wget --show-progress -q -O "$DEB_PATH" "$DEB_URL" || { echo "Failed to download the .deb file."; exit 1; }

# Install the latest .deb package
echo -e "\nInstalling the latest release..."

command -v apt &> /dev/null || { echo "Package manager apt was not found."; exit 1; }
sudo apt install -y "$DEB_PATH" || { echo "Installation of .deb file failed."; exit 1; }

# Create the systemd user service
echo -e "\nCreating systemd user service..."

SERVICE_NAME="touchkio.service"
SERVICE_FILE="$HOME/.config/systemd/user/$SERVICE_NAME"
mkdir -p "$(dirname "$SERVICE_FILE")" || { echo "Failed to create directory for $SERVICE_FILE."; exit 1; }

SERVICE_CONTENT="[Unit]
Description=TouchKio
After=graphical.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/touchkio
Restart=on-failure
RestartSec=5s

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

# Note: Enhanced files will be installed after TouchKio setup
echo -e "\nPreparing for TouchKio setup..."

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

# Run TouchKio first time setup
echo ""
echo "Starting TouchKio initial setup..."
echo "TouchKio will prompt you for configuration (MQTT, web URL, etc.)"
echo "Please answer the questions, then the installer will continue automatically."
echo ""

# Run TouchKio in interactive setup mode with proper TTY handling
export DISPLAY=":0"
export WAYLAND_DISPLAY="wayland-0"

echo "Running TouchKio setup..."
if /usr/bin/touchkio --setup < /dev/tty; then
    echo ""
    echo "TouchKio setup completed successfully!"
else
    echo ""
    echo "TouchKio setup completed or exited."
fi

echo ""
echo "Continuing with slideshow enhancement installation..."
sleep 2

# Download and install enhanced TouchKio files
echo ""
echo "Installing enhanced TouchKio slideshow files..."

TOUCHKIO_LIB="/usr/lib/touchkio/resources/app"
TEMP_DIR=$(mktemp -d)

# Download enhanced files from GitHub archive (avoids CDN caching)
cd "$TEMP_DIR"
wget -q "https://github.com/Chris971991/TouchKio-Photo-Screensaver/archive/refs/heads/master.zip" -O repo.zip || { echo "Failed to download enhanced files."; exit 1; }
unzip -q repo.zip || { echo "Failed to extract files."; exit 1; }
mv TouchKio-Photo-Screensaver-master TouchKio-Photo-Screensaver

if [ -d "$TEMP_DIR/TouchKio-Photo-Screensaver/touchkio/html" ] && [ -d "$TEMP_DIR/TouchKio-Photo-Screensaver/touchkio/js" ]; then
    sudo cp -r "$TEMP_DIR/TouchKio-Photo-Screensaver/touchkio/html"/* "$TOUCHKIO_LIB/html/" || { echo "Failed to copy HTML files."; exit 1; }
    sudo cp -r "$TEMP_DIR/TouchKio-Photo-Screensaver/touchkio/js"/* "$TOUCHKIO_LIB/js/" || { echo "Failed to copy JS files."; exit 1; }
    echo "Enhanced slideshow files installed successfully."
else
    echo "Enhanced slideshow files not found in download"
    exit 1
fi

# Cleanup
rm -rf "$TEMP_DIR"

# Now enhance the existing config with slideshow settings
echo ""
echo "Enhancing TouchKio configuration with slideshow features..."

CONFIG_FILE="$HOME/.config/touchkio/Arguments.json"
if [ -f "$CONFIG_FILE" ]; then
    # Backup existing config
    cp "$CONFIG_FILE" "${CONFIG_FILE}.backup"

    # Add slideshow settings to existing config using jq or python
    if command -v python3 &> /dev/null; then
        python3 -c "
import json
import sys

# Read existing config
with open('$CONFIG_FILE', 'r') as f:
    config = json.load(f)

# Add slideshow settings
config.update({
    'slideshow_enabled': True,
    'slideshow_photos_dir': '/home/pi/TouchKio-Photo-Screensaver/photos',
    'slideshow_interval': 6000,
    'slideshow_clock_enabled': True,
    'slideshow_date_enabled': True,
    'slideshow_source_indicator_enabled': True,
    'slideshow_photo_counter_enabled': True,
    'slideshow_idle_timeout': 10
})

# Update web_url to use slideshow.html
if 'web_url' in config:
    config['web_url'] = ['file:///usr/lib/touchkio/resources/app/html/slideshow.html']

# Write updated config
with open('$CONFIG_FILE', 'w') as f:
    json.dump(config, f, indent=2)
"
        echo "TouchKio configuration enhanced with slideshow settings"
    else
        echo "Python3 not available, slideshow config not applied"
        echo "Please manually add slideshow settings to $CONFIG_FILE"
    fi
else
    echo "TouchKio config not found. Please run TouchKio setup first."
    exit 1
fi

# Start TouchKio with new slideshow config
echo "Starting TouchKio with slideshow configuration..."

# Make sure any crashed TouchKio processes are cleaned up
pkill -f touchkio 2>/dev/null || true
sleep 2

# Start TouchKio service
systemctl --user enable touchkio.service
systemctl --user start touchkio.service

# Wait a moment and check if it started successfully
sleep 5

if systemctl --user is-active --quiet touchkio.service; then
    echo ""
    echo "✓ TouchKio slideshow started successfully!"
    echo "1. TouchKio should now display the slideshow with sample images"
    echo "2. MQTT slideshow controls should appear in Home Assistant"
    echo "3. Configure slideshow settings via Home Assistant MQTT entities"
    echo "4. Set your Google Photos albums, timing, overlays, etc. from HA"
else
    echo ""
    echo "⚠ TouchKio service failed to start properly"
    echo "Try manually starting: systemctl --user start touchkio.service"
    echo "Check logs: journalctl --user -u touchkio.service"
fi

exit 0
