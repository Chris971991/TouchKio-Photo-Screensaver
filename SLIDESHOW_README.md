# TouchKio Photo Screensaver Extension

A comprehensive native photo slideshow extension for TouchKio that automatically displays photos from local directories or Google Photos shared albums after a period of inactivity.

## Features

- **Dual Photo Sources**: Support for both local photo directories and Google Photos shared albums
- **Smart Fallback**: Automatically falls back to local photos if Google Photos fails to load
- **Idle Detection**: Automatically shows slideshow after configurable idle time
- **User Activity Detection**: Hides slideshow on any user interaction (touch, mouse, keyboard, VNC clicks)
- **MQTT Integration**: Full Home Assistant integration with auto-discovery for remote control
- **Smooth Transitions**: Multiple transition effects (fade, slide, zoom, blur, rotate) with configurable duration
- **Customizable Overlays**: Clock, source indicator, and photo counter with extensive positioning and styling options
- **Production Ready**: Follows TouchKio architecture patterns with proper error handling and cleanup

## Installation

The slideshow extension is integrated into TouchKio's core system. Simply ensure you have TouchKio installed and configure the slideshow options.

## Configuration

### Command Line Arguments

Enable and configure the slideshow using command-line arguments:

```bash
touchkio \
  --slideshow_enabled=true \
  --slideshow_photos_dir=/home/pi/Pictures \
  --slideshow_interval=5 \
  --slideshow_idle_timeout=180 \
  --slideshow_show_clock=true \
  --slideshow_clock_position=bottom-right \
  --slideshow_clock_size=large \
  --slideshow_clock_background=none \
  --slideshow_show_source=false \
  --slideshow_show_counter=false \
  --slideshow_transition_type=fade \
  --slideshow_transition_duration=2000
```

### Basic Settings

| Argument | Default | Description |
|----------|---------|-------------|
| `--slideshow_enabled` | `false` | Enable/disable slideshow functionality |
| `--slideshow_photos_dir` | `~/Pictures` | Local photos directory path |
| `--slideshow_google_album` | `null` | Google Photos shared album ID (optional) |
| `--slideshow_interval` | `5` | Photo change interval in seconds |
| `--slideshow_idle_timeout` | `180` | Idle time before slideshow starts (seconds) |

### Clock Overlay Settings

| Argument | Default | Options | Description |
|----------|---------|---------|-------------|
| `--slideshow_show_clock` | `true` | `true/false` | Show/hide clock overlay |
| `--slideshow_clock_position` | `bottom-right` | `top-left`, `top-right`, `bottom-left`, `bottom-right`, `center` | Clock position |
| `--slideshow_clock_size` | `large` | `tiny`, `small`, `medium`, `large`, `xlarge`, `xxlarge`, `massive`, `giant` | Clock text size |
| `--slideshow_clock_background` | `dark` | `dark`, `light`, `none` | Clock background style |
| `--slideshow_clock_opacity` | `0.7` | `0.0-1.0` | Clock background opacity |
| `--slideshow_clock_color` | `#ffffff` | Any hex color | Clock text color |

### Source Indicator Settings

| Argument | Default | Options | Description |
|----------|---------|---------|-------------|
| `--slideshow_show_source` | `true` | `true/false` | Show/hide source indicator ("Local Photos") |
| `--slideshow_source_position` | `top-left` | `top-left`, `top-right`, `bottom-left`, `bottom-right` | Source indicator position |
| `--slideshow_source_size` | `medium` | `small`, `medium`, `large` | Source indicator text size |
| `--slideshow_source_opacity` | `0.8` | `0.0-1.0` | Source indicator opacity |

### Photo Counter Settings

| Argument | Default | Options | Description |
|----------|---------|---------|-------------|
| `--slideshow_show_counter` | `true` | `true/false` | Show/hide photo counter ("2 / 6") |
| `--slideshow_counter_position` | `bottom-left` | `top-left`, `top-right`, `bottom-left`, `bottom-right` | Counter position |
| `--slideshow_counter_size` | `medium` | `small`, `medium`, `large` | Counter text size |
| `--slideshow_counter_opacity` | `0.8` | `0.0-1.0` | Counter opacity |

### Photo & Transition Settings

| Argument | Default | Options | Description |
|----------|---------|---------|-------------|
| `--slideshow_random_order` | `true` | `true/false` | Shuffle photos randomly |
| `--slideshow_photo_fit` | `contain` | `contain`, `cover`, `fill` | How photos fit the screen |
| `--slideshow_transition_type` | `fade` | `fade`, `slide`, `zoom`, `blur`, `rotate` | Transition animation type |
| `--slideshow_transition_duration` | `2000` | Any number | Transition duration in milliseconds |

## Google Photos Setup

To use Google Photos shared albums:

1. Create a shared album in Google Photos
2. Get the album share URL (e.g., `https://photos.google.com/share/ALBUM_ID`)
3. Extract the album ID from the URL
4. Use it with `--slideshow_google_album=ALBUM_ID`

The system automatically falls back to local photos if Google Photos fails to load.

## MQTT Integration

When TouchKio's MQTT integration is enabled, the slideshow automatically creates Home Assistant entities:

### Auto-Discovery Entities

- **Switch**: `switch.touchkio_slideshow` - Enable/disable slideshow
- **Number**: `number.touchkio_slideshow_interval` - Photo change interval (1-60 seconds)
- **Number**: `number.touchkio_slideshow_idle_timeout` - Idle timeout (60-3600 seconds)

### Manual MQTT Commands

Publish to these topics to control the slideshow:

```bash
# Enable/disable slideshow
mosquitto_pub -h your-broker -t "touchkio/slideshow/set" -m "ON"
mosquitto_pub -h your-broker -t "touchkio/slideshow/set" -m "OFF"

# Set photo interval (seconds)
mosquitto_pub -h your-broker -t "touchkio/slideshow/interval/set" -m "10"

# Set idle timeout (seconds)
mosquitto_pub -h your-broker -t "touchkio/slideshow/idle_timeout/set" -m "300"

# Reload photos
mosquitto_pub -h your-broker -t "touchkio/slideshow/reload" -m ""
```

## Interactive Setup

Run TouchKio with `--setup` to configure slideshow settings interactively:

```bash
touchkio --setup
```

This will prompt for all slideshow configuration options and save them to your configuration file.

## Example Configurations

### Minimal Clean Setup
```bash
touchkio \
  --slideshow_enabled=true \
  --slideshow_show_source=false \
  --slideshow_show_counter=false \
  --slideshow_clock_background=none \
  --slideshow_transition_type=fade
```

### Full-Featured Setup
```bash
touchkio \
  --slideshow_enabled=true \
  --slideshow_photos_dir=/home/pi/Pictures \
  --slideshow_google_album=YOUR_ALBUM_ID \
  --slideshow_interval=8 \
  --slideshow_idle_timeout=120 \
  --slideshow_show_clock=true \
  --slideshow_clock_position=center \
  --slideshow_clock_size=giant \
  --slideshow_clock_background=dark \
  --slideshow_show_source=true \
  --slideshow_show_counter=true \
  --slideshow_transition_type=zoom \
  --slideshow_transition_duration=1500
```

### Kiosk Mode (No Overlays)
```bash
touchkio \
  --slideshow_enabled=true \
  --slideshow_show_clock=false \
  --slideshow_show_source=false \
  --slideshow_show_counter=false \
  --slideshow_transition_type=slide \
  --slideshow_random_order=true
```

## Troubleshooting

### Slideshow Not Appearing
- Check that photos exist in the configured directory
- Verify idle timeout has elapsed
- Ensure TouchKio has display permissions (`DISPLAY` and `WAYLAND_DISPLAY` variables)

### Google Photos Not Loading
- Verify the album is publicly shared
- Check network connectivity
- The system will automatically fall back to local photos

### Activity Detection Issues
- VNC/Remote access activity is properly detected
- Physical touch, mouse, and keyboard events are all monitored
- Check console logs for activity detection messages

### MQTT Integration Problems
- Ensure MQTT broker is configured in TouchKio
- Check Home Assistant auto-discovery prefix matches
- Verify MQTT broker connectivity

## Clock Size Reference

Visual size reference for `--slideshow_clock_size`:
- `tiny`: 1rem (very small, minimal)
- `small`: 1.5rem (compact)
- `medium`: 2rem (standard)
- `large`: 3rem (prominent)
- `xlarge`: 4rem (very large)
- `xxlarge`: 6rem (extra large)
- `massive`: 8rem (huge)
- `giant`: 12rem (full screen clock)

## Architecture

The slideshow extension integrates natively with TouchKio's modular architecture:

- **slideshow.js**: Main slideshow module with HTTP server and photo management
- **slideshow.html**: Full-screen slideshow interface with transitions and overlays
- **Modified core modules**: Integration with hardware, webview, and MQTT systems
- **Event-driven**: Uses TouchKio's global event system for user activity detection

## File Locations

When installed via package manager:
- Main files: `/usr/lib/touchkio/resources/app/`
- Configuration: `~/.config/touchkio/Arguments.json`
- Logs: `~/.local/share/touchkio/logs/main.log`

## Support

For issues and feature requests, visit the TouchKio repository or check the logs:

```bash
tail -f ~/.local/share/touchkio/logs/main.log
```

The slideshow creates detailed console output for debugging photo loading, transitions, and activity detection.