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
Environment="WAYLAND_DISPLAY=wayland-1"
Environment="XAUTHORITY=/home/%u/.Xauthority"
Environment="XDG_RUNTIME_DIR=/run/user/%U"
ExecStartPre=/bin/bash -c 'until pgrep -x Xorg || pgrep -x Xwayland || pgrep -x labwc || pgrep -x weston; do sleep 2; done'
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

# Download sample images with rich metadata
echo "Adding sample slideshow images with rich metadata..."
cd "$HOME/TouchKio-Photo-Screensaver/photos"

# Install exiftool for metadata enhancement (if not already installed)
if ! command -v exiftool &> /dev/null; then
    echo "Installing exiftool for metadata enhancement..."
    sudo apt-get update -qq
    sudo apt-get install -y libimage-exiftool-perl
fi

# Download high-quality sample images
echo "Downloading sample photos..."
wget -q "https://picsum.photos/1920/1080?random=1" -O mountain_vista.jpg
wget -q "https://picsum.photos/1920/1080?random=2" -O city_skyline.jpg
wget -q "https://picsum.photos/1920/1080?random=3" -O forest_path.jpg
wget -q "https://picsum.photos/1920/1080?random=4" -O ocean_sunset.jpg
wget -q "https://picsum.photos/1920/1080?random=5" -O urban_architecture.jpg

# Add comprehensive metadata to showcase the metadata system
echo "Adding rich metadata to sample photos..."

# Mountain Vista - Landscape Photography
exiftool -overwrite_original \
    -EXIF:Make="Canon" \
    -EXIF:Model="EOS R5" \
    -EXIF:LensModel="RF 24-70mm F2.8 L IS USM" \
    -EXIF:DateTime="2024:09:15 06:30:00" \
    -EXIF:DateTimeOriginal="2024:09:15 06:30:00" \
    -EXIF:ISO=100 \
    -EXIF:FNumber=8.0 \
    -EXIF:ExposureTime="1/250" \
    -EXIF:FocalLength="35.0 mm" \
    -GPS:GPSLatitude=46.8181877 \
    -GPS:GPSLongitude=8.2275124 \
    -GPS:GPSLatitudeRef="N" \
    -GPS:GPSLongitudeRef="E" \
    -EXIF:ImageDescription="Breathtaking mountain vista captured during golden hour in the Swiss Alps" \
    -EXIF:Artist="TouchKio Demo" \
    -EXIF:Copyright="Sample Photo for Slideshow Demo" \
    -XMP:Subject="mountains, landscape, alps, golden hour, nature" \
    -XMP:Title="Alpine Morning Glory" \
    mountain_vista.jpg 2>/dev/null

# City Skyline - Urban Photography
exiftool -overwrite_original \
    -EXIF:Make="Sony" \
    -EXIF:Model="α7R V" \
    -EXIF:LensModel="FE 70-200mm F2.8 GM OSS II" \
    -EXIF:DateTime="2024:08:22 20:15:00" \
    -EXIF:DateTimeOriginal="2024:08:22 20:15:00" \
    -EXIF:ISO=800 \
    -EXIF:FNumber=4.0 \
    -EXIF:ExposureTime="1/60" \
    -EXIF:FocalLength="135.0 mm" \
    -GPS:GPSLatitude=40.7589 \
    -GPS:GPSLongitude=-73.9851 \
    -GPS:GPSLatitudeRef="N" \
    -GPS:GPSLongitudeRef="W" \
    -EXIF:ImageDescription="Dynamic city skyline showcasing modern architecture and urban energy" \
    -EXIF:Artist="TouchKio Demo" \
    -EXIF:Copyright="Sample Photo for Slideshow Demo" \
    -XMP:Subject="city, skyline, urban, architecture, night, lights" \
    -XMP:Title="Metropolitan Nights" \
    city_skyline.jpg 2>/dev/null

# Forest Path - Nature Photography
exiftool -overwrite_original \
    -EXIF:Make="Nikon" \
    -EXIF:Model="Z9" \
    -EXIF:LensModel="NIKKOR Z 14-24mm f/2.8 S" \
    -EXIF:DateTime="2024:07:10 14:45:00" \
    -EXIF:DateTimeOriginal="2024:07:10 14:45:00" \
    -EXIF:ISO=400 \
    -EXIF:FNumber=5.6 \
    -EXIF:ExposureTime="1/125" \
    -EXIF:FocalLength="20.0 mm" \
    -GPS:GPSLatitude=47.6062 \
    -GPS:GPSLongitude=-122.3321 \
    -GPS:GPSLatitudeRef="N" \
    -GPS:GPSLongitudeRef="W" \
    -EXIF:ImageDescription="Mystical forest path winding through ancient trees with dappled sunlight" \
    -EXIF:Artist="TouchKio Demo" \
    -EXIF:Copyright="Sample Photo for Slideshow Demo" \
    -XMP:Subject="forest, nature, trees, path, woodland, peaceful" \
    -XMP:Title="Enchanted Forest Trail" \
    forest_path.jpg 2>/dev/null

# Ocean Sunset - Seascape Photography
exiftool -overwrite_original \
    -EXIF:Make="Fujifilm" \
    -EXIF:Model="X-T5" \
    -EXIF:LensModel="XF 16-55mm F2.8 R LM WR" \
    -EXIF:DateTime="2024:06:28 19:30:00" \
    -EXIF:DateTimeOriginal="2024:06:28 19:30:00" \
    -EXIF:ISO=200 \
    -EXIF:FNumber=11.0 \
    -EXIF:ExposureTime="1/500" \
    -EXIF:FocalLength="35.0 mm" \
    -GPS:GPSLatitude=34.0522 \
    -GPS:GPSLongitude=-118.2437 \
    -GPS:GPSLatitudeRef="N" \
    -GPS:GPSLongitudeRef="W" \
    -EXIF:ImageDescription="Spectacular ocean sunset with dramatic clouds reflected in wet sand" \
    -EXIF:Artist="TouchKio Demo" \
    -EXIF:Copyright="Sample Photo for Slideshow Demo" \
    -XMP:Subject="ocean, sunset, beach, seascape, dramatic, clouds" \
    -XMP:Title="Pacific Sunset Spectacular" \
    ocean_sunset.jpg 2>/dev/null

# Urban Architecture - Architectural Photography
exiftool -overwrite_original \
    -EXIF:Make="Leica" \
    -EXIF:Model="Q2" \
    -EXIF:LensModel="Summilux 28mm f/1.7 ASPH" \
    -EXIF:DateTime="2024:05:12 16:20:00" \
    -EXIF:DateTimeOriginal="2024:05:12 16:20:00" \
    -EXIF:ISO=320 \
    -EXIF:FNumber=8.0 \
    -EXIF:ExposureTime="1/320" \
    -EXIF:FocalLength="28.0 mm" \
    -GPS:GPSLatitude=51.5074 \
    -GPS:GPSLongitude=-0.1278 \
    -GPS:GPSLatitudeRef="N" \
    -GPS:GPSLongitudeRef="W" \
    -EXIF:ImageDescription="Bold geometric architecture with striking lines and contemporary design elements" \
    -EXIF:Artist="TouchKio Demo" \
    -EXIF:Copyright="Sample Photo for Slideshow Demo" \
    -XMP:Subject="architecture, modern, geometric, design, urban, contemporary" \
    -XMP:Title="Architectural Geometry" \
    urban_architecture.jpg 2>/dev/null

echo "✓ Added 5 metadata-rich sample images showcasing:"
echo "  • Camera settings (ISO, aperture, shutter speed, focal length)"
echo "  • GPS location data for different world cities"
echo "  • Professional camera equipment metadata"
echo "  • Descriptive titles and subject tags"
echo "  • Photography dates and artist information"
echo ""
echo "These photos demonstrate the full metadata display capabilities!"
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
            # Read user's configured values and add comprehensive slideshow defaults
            jq '. + {
                "slideshow_clock_enabled": (if .slideshow_show_clock then (.slideshow_show_clock | test("true|ON"; "i")) else true end),
                "slideshow_date_enabled": true,
                "slideshow_source_indicator_enabled": (if .slideshow_show_source then (.slideshow_show_source | test("true|ON"; "i")) else true end),
                "slideshow_photo_counter_enabled": (if .slideshow_show_counter then (.slideshow_show_counter | test("true|ON"; "i")) else true end),

                "slideshow_clock_position": "bottom-right",
                "slideshow_date_position": "bottom-left",
                "slideshow_source_position": "top-left",
                "slideshow_counter_position": "top-right",
                "slideshow_metadata_position": "bottom-center",

                "slideshow_clock_background": "dark",
                "slideshow_date_background": "dark",
                "slideshow_source_background": "dark",
                "slideshow_counter_background": "dark",
                "slideshow_metadata_background": "dark",

                "slideshow_clock_custom_font_size": "2rem",
                "slideshow_date_custom_font_size": "1.2rem",
                "slideshow_source_custom_font_size": "0.9rem",
                "slideshow_counter_custom_font_size": "0.9rem",
                "slideshow_metadata_custom_font_size": "0.8rem",

                "slideshow_clock_border_radius": "8px",
                "slideshow_date_border_radius": "8px",
                "slideshow_source_border_radius": "8px",
                "slideshow_counter_border_radius": "8px",
                "slideshow_metadata_border_radius": "8px",

                "slideshow_clock_padding": "10px 15px",
                "slideshow_date_padding": "8px 12px",
                "slideshow_source_padding": "6px 10px",
                "slideshow_counter_padding": "6px 10px",
                "slideshow_metadata_padding": "10px 15px",

                "slideshow_clock_shadow": "0 2px 8px rgba(0,0,0,0.3)",
                "slideshow_date_shadow": "0 2px 8px rgba(0,0,0,0.3)",
                "slideshow_source_shadow": "0 2px 6px rgba(0,0,0,0.2)",
                "slideshow_counter_shadow": "0 2px 6px rgba(0,0,0,0.2)",
                "slideshow_metadata_shadow": "0 2px 8px rgba(0,0,0,0.3)",

                "slideshow_clock_opacity": 1.0,
                "slideshow_date_opacity": 0.9,
                "slideshow_source_opacity": 0.8,
                "slideshow_counter_opacity": 0.8,
                "slideshow_metadata_opacity": 0.9,

                "slideshow_clock_background_opacity": 70,
                "slideshow_date_background_opacity": 70,
                "slideshow_source_background_opacity": 60,
                "slideshow_counter_background_opacity": 60,
                "slideshow_metadata_background_opacity": 70,

                "slideshow_clock_custom_x": "",
                "slideshow_clock_custom_y": "",
                "slideshow_date_custom_x": "",
                "slideshow_date_custom_y": "",
                "slideshow_source_custom_x": "",
                "slideshow_source_custom_y": "",
                "slideshow_counter_custom_x": "",
                "slideshow_counter_custom_y": "",
                "slideshow_metadata_custom_x": "",
                "slideshow_metadata_custom_y": "",
                "slideshow_animation_theme": "default",
                "slideshow_animation_speed": "1.0",
                "slideshow_animation_enabled": "true"
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

    # Add comprehensive slideshow defaults (preserve user's configured values)
    slideshow_defaults = {
        'slideshow_clock_enabled': config.get('slideshow_show_clock', 'true').lower() in ['true', 'on', '1'],
        'slideshow_date_enabled': True,
        'slideshow_source_indicator_enabled': config.get('slideshow_show_source', 'true').lower() in ['true', 'on', '1'],
        'slideshow_photo_counter_enabled': config.get('slideshow_show_counter', 'true').lower() in ['true', 'on', '1'],

        'slideshow_clock_position': 'bottom-right',
        'slideshow_date_position': 'bottom-left',
        'slideshow_source_position': 'top-left',
        'slideshow_counter_position': 'top-right',
        'slideshow_metadata_position': 'bottom-center',

        'slideshow_clock_background': 'dark',
        'slideshow_date_background': 'dark',
        'slideshow_source_background': 'dark',
        'slideshow_counter_background': 'dark',
        'slideshow_metadata_background': 'dark',

        'slideshow_clock_custom_font_size': '2rem',
        'slideshow_date_custom_font_size': '1.2rem',
        'slideshow_source_custom_font_size': '0.9rem',
        'slideshow_counter_custom_font_size': '0.9rem',
        'slideshow_metadata_custom_font_size': '0.8rem',

        'slideshow_clock_border_radius': '8px',
        'slideshow_date_border_radius': '8px',
        'slideshow_source_border_radius': '8px',
        'slideshow_counter_border_radius': '8px',
        'slideshow_metadata_border_radius': '8px',

        'slideshow_clock_padding': '10px 15px',
        'slideshow_date_padding': '8px 12px',
        'slideshow_source_padding': '6px 10px',
        'slideshow_counter_padding': '6px 10px',
        'slideshow_metadata_padding': '10px 15px',

        'slideshow_clock_shadow': '0 2px 8px rgba(0,0,0,0.3)',
        'slideshow_date_shadow': '0 2px 8px rgba(0,0,0,0.3)',
        'slideshow_source_shadow': '0 2px 6px rgba(0,0,0,0.2)',
        'slideshow_counter_shadow': '0 2px 6px rgba(0,0,0,0.2)',
        'slideshow_metadata_shadow': '0 2px 8px rgba(0,0,0,0.3)',

        'slideshow_clock_opacity': 1.0,
        'slideshow_date_opacity': 0.9,
        'slideshow_source_opacity': 0.8,
        'slideshow_counter_opacity': 0.8,
        'slideshow_metadata_opacity': 0.9,

        'slideshow_clock_background_opacity': 70,
        'slideshow_date_background_opacity': 70,
        'slideshow_source_background_opacity': 60,
        'slideshow_counter_background_opacity': 60,
        'slideshow_metadata_background_opacity': 70,

        'slideshow_clock_custom_x': '',
        'slideshow_clock_custom_y': '',
        'slideshow_date_custom_x': '',
        'slideshow_date_custom_y': '',
        'slideshow_source_custom_x': '',
        'slideshow_source_custom_y': '',
        'slideshow_counter_custom_x': '',
        'slideshow_counter_custom_y': '',
        'slideshow_metadata_custom_x': '',
        'slideshow_metadata_custom_y': '',
        'slideshow_animation_theme': 'default',
        'slideshow_animation_speed': '1.0',
        'slideshow_animation_enabled': 'true'
    }

    # Only add defaults that don't exist (preserve ALL user setup choices)
    for key, value in slideshow_defaults.items():
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
