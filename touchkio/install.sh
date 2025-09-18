#!/usr/bin/env bash

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

# Copy enhanced TouchKio files
echo -e "\nCopying enhanced TouchKio slideshow files..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOUCHKIO_LIB="/usr/lib/touchkio/resources/app"

if [ -d "$SCRIPT_DIR/html" ] && [ -d "$SCRIPT_DIR/js" ]; then
    sudo cp -r "$SCRIPT_DIR/html"/* "$TOUCHKIO_LIB/html/" || { echo "Failed to copy HTML files."; exit 1; }
    sudo cp -r "$SCRIPT_DIR/js"/* "$TOUCHKIO_LIB/js/" || { echo "Failed to copy JS files."; exit 1; }
    echo "Enhanced slideshow files copied successfully."
else
    echo "Enhanced slideshow files not found in $SCRIPT_DIR"
fi

# Create photos directory
echo ""
mkdir -p "$HOME/TouchKio-Photo-Screensaver/photos"
echo "Created photos directory at $HOME/TouchKio-Photo-Screensaver/photos"

# Ask about MQTT integration
echo ""
read -p "Enable MQTT integration for Home Assistant control? (Y/n) " enable_mqtt

if [[ ${enable_mqtt:-y} == [Yy]* ]]; then
    echo ""
    read -p "Enter MQTT broker URL (e.g., mqtt://192.168.50.45:1883): " mqtt_url
    read -p "Enter MQTT username: " mqtt_user
    read -s -p "Enter MQTT password: " mqtt_pass
    echo ""

    echo ""
    echo "Starting TouchKio with MQTT enabled - configure everything from Home Assistant..."
    /usr/bin/touchkio --web-url "file://$TOUCHKIO_LIB/html/slideshow.html" \
        --integration_mqtt_enabled \
        --integration_mqtt_connection_string "$mqtt_url" \
        --integration_mqtt_username "$mqtt_user" \
        --integration_mqtt_password "$mqtt_pass" &

    echo ""
    echo "TouchKio started! All slideshow settings can now be controlled from Home Assistant."
    echo "Check your HA MQTT integrations for 23+ new TouchKio entities."
else
    # Start the setup mode
    echo ""
    read -p "Start touchkio setup? (Y/n) " setup

    if [[ ${setup:-y} == [Yy]* ]]; then
        echo "/usr/bin/touchkio --setup"
        /usr/bin/touchkio --setup
    else
        echo "/usr/bin/touchkio"
        /usr/bin/touchkio
    fi
fi

exit 0
