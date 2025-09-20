#!/usr/bin/env bash
# Complete TouchKio Enhanced Uninstaller
# This will remove EVERYTHING TouchKio related for a fresh start

echo "=== TouchKio Enhanced Complete Uninstaller ==="
echo "This will remove ALL TouchKio files, configs, and services"
read -p "Are you sure you want to completely uninstall TouchKio? (y/N) " confirm
[[ ${confirm:-n} != [Yy]* ]] && { echo "Cancelled."; exit 0; }

echo ""
echo "Step 1: Stopping and removing TouchKio service..."

# Stop and disable the systemd service
systemctl --user stop touchkio.service 2>/dev/null || true
systemctl --user disable touchkio.service 2>/dev/null || true

# Remove service file
rm -f ~/.config/systemd/user/touchkio.service

# Reload systemd to remove the service
systemctl --user daemon-reload
systemctl --user reset-failed touchkio.service 2>/dev/null || true

echo "✓ Service stopped and removed"

echo ""
echo "Step 2: Killing any running TouchKio processes..."

# Kill any running TouchKio processes (multiple patterns)
pkill -f touchkio || true
pkill -f TouchKio || true
pkill -f /usr/bin/touchkio || true
pkill -f /usr/lib/touchkio || true
sleep 3

# Force kill if still running
pkill -9 -f touchkio || true
pkill -9 -f TouchKio || true
pkill -9 -f /usr/bin/touchkio || true
pkill -9 -f /usr/lib/touchkio || true
sleep 1

echo "✓ All TouchKio processes terminated"

echo ""
echo "Step 3: Removing TouchKio package..."

# Remove the installed package
sudo apt remove --purge touchkio -y 2>/dev/null || true
sudo apt autoremove -y

echo "✓ Package removed"

echo ""
echo "Step 4: Removing TouchKio configuration..."

# Remove all TouchKio config directories and files
rm -rf ~/.config/touchkio/
rm -rf ~/.local/share/touchkio/
rm -rf ~/.cache/touchkio/
rm -rf ~/.touchkio*

# Remove any TouchKio desktop entries
rm -f ~/.local/share/applications/touchkio.desktop
sudo rm -f /usr/share/applications/touchkio.desktop

# Remove any TouchKio systemd user service files
rm -f ~/.config/systemd/user/touchkio*

echo "✓ Configuration files removed"

echo ""
echo "Step 5: Removing TouchKio installation directories..."

# Remove system installation directories
sudo rm -rf /usr/lib/touchkio/
sudo rm -rf /usr/share/touchkio/
sudo rm -f /usr/bin/touchkio
sudo rm -rf /var/lib/touchkio/
sudo rm -rf /etc/touchkio/

# Remove any TouchKio related symlinks
sudo find /usr/local/bin -name "*touchkio*" -type l -delete 2>/dev/null || true

echo "✓ Installation directories removed"

echo ""
echo "Step 6: Removing slideshow photos and data..."

# Remove slideshow photos directory
rm -rf ~/TouchKio-Photo-Screensaver/

# Remove any other TouchKio related directories
rm -rf ~/Pictures/TouchKio* 2>/dev/null || true
rm -rf ~/touchkio* 2>/dev/null || true

echo "✓ Slideshow data removed"

echo ""
echo "Step 7: Cleaning up MQTT entities in Home Assistant..."

# Note: MQTT entities will automatically disappear when TouchKio stops publishing
echo "✓ MQTT entities will be removed automatically from Home Assistant"

echo ""
echo "Step 8: Removing any remaining TouchKio files..."

# Find and remove any remaining TouchKio files (more thorough)
sudo find /usr -name "*touchkio*" -exec rm -rf {} + 2>/dev/null || true
sudo find /opt -name "*touchkio*" -exec rm -rf {} + 2>/dev/null || true
sudo find /var -name "*touchkio*" -exec rm -rf {} + 2>/dev/null || true
sudo find /etc -name "*touchkio*" -exec rm -rf {} + 2>/dev/null || true
find ~ -name "*touchkio*" -exec rm -rf {} + 2>/dev/null || true

# Remove any TouchKio logs
sudo rm -rf /var/log/touchkio* 2>/dev/null || true
rm -rf ~/.local/share/TouchKio* 2>/dev/null || true

# Clear any apt package lists
sudo rm -f /var/lib/apt/lists/*touchkio* 2>/dev/null || true

echo "✓ Remaining files cleaned up"

echo ""
echo "Step 9: Disabling user lingering (if not needed)..."

# Disable user lingering (only if you don't need other user services to run without login)
read -p "Disable user lingering? This stops user services from running when not logged in (y/N) " disable_linger
if [[ ${disable_linger:-n} == [Yy]* ]]; then
    sudo loginctl disable-linger "$USER"
    echo "✓ User lingering disabled"
else
    echo "✓ User lingering left enabled"
fi

echo ""
echo "Step 10: Final system cleanup and verification..."

# Clear systemd failed units
systemctl --user reset-failed 2>/dev/null || true
sudo systemctl reset-failed 2>/dev/null || true

# Update package database to remove any TouchKio references
sudo apt update -qq 2>/dev/null || true

# Verify TouchKio is completely gone
if command -v touchkio &> /dev/null; then
    echo "⚠️  WARNING: TouchKio command still found in PATH"
else
    echo "✓ TouchKio command removed from PATH"
fi

if pgrep -f touchkio > /dev/null; then
    echo "⚠️  WARNING: TouchKio processes still running"
else
    echo "✓ No TouchKio processes running"
fi

if [ -d "/usr/lib/touchkio" ] || [ -f "/usr/bin/touchkio" ] || [ -d "~/.config/touchkio" ]; then
    echo "⚠️  WARNING: Some TouchKio files may still exist"
else
    echo "✓ Main TouchKio directories removed"
fi

echo ""
echo "🎉 TouchKio Enhanced has been completely uninstalled!"
echo ""
echo "To reinstall with the latest fixes, run:"
echo "bash <(wget -qO- https://raw.githubusercontent.com/Chris971991/TouchKio-Photo-Screensaver/master/touchkio/install.sh)"
echo ""
echo "Your system is now clean and ready for a fresh installation."