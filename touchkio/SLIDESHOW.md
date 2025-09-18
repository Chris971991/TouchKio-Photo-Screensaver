# TouchKio Photo Slideshow Feature

A native photo slideshow extension for TouchKio that transforms your touch kiosk into a beautiful photo display when idle.

## 🌟 Features

### Core Functionality
- **Automatic activation** after configurable idle time (default: 3 minutes)
- **Dual photo sources**: Local photos from ~/TouchKio-Photo-Screensaver/photos and Google Photos shared albums
- **Smart fallback**: Uses local photos when internet is unavailable
- **Smooth transitions** with 2-second fade effects
- **User interaction detection** - hides immediately on any touch, click, or movement
- **HTTP server** on port 8081 for serving photos efficiently

### Display Elements
- **Clock overlay** showing current time and date (configurable)
- **Source indicator** showing whether photos are from Google Photos or local storage
- **Photo counter** displaying current position (e.g., "5 / 23")
- **Smooth preloading** of next image for seamless transitions
- **Error handling** with automatic skip of broken images

### MQTT Integration (Home Assistant)
- `switch.touchkio_slideshow` - Enable/disable slideshow
- `number.touchkio_slideshow_interval` - Slide duration (1-60 seconds)
- `number.touchkio_slideshow_idle` - Idle timeout (1-60 minutes)
- Real-time state updates when slideshow activates/deactivates

## 🚀 Installation

The slideshow feature is integrated natively into TouchKio. Simply use the updated TouchKio with the slideshow code included.

## ⚙️ Configuration

### Command Line Arguments

```bash
# Enable slideshow with default settings
touchkio --slideshow-enabled=true

# Full configuration example
touchkio --slideshow-enabled=true \
         --slideshow-photos-dir=/home/user/Photos \
         --slideshow-google-album=YOUR_ALBUM_ID \
         --slideshow-interval=10 \
         --slideshow-idle-timeout=300 \
         --slideshow-show-clock=true
```

### Available Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `--slideshow-enabled` | `false` | Enable/disable slideshow feature |
| `--slideshow-photos-dir` | `~/TouchKio-Photo-Screensaver/photos` | Directory containing local photos |
| `--slideshow-google-album` | - | Google Photos shared album ID (optional) |
| `--slideshow-interval` | `5` | Seconds between photo changes |
| `--slideshow-idle-timeout` | `180` | Seconds of inactivity before slideshow starts |
| `--slideshow-show-clock` | `true` | Show clock overlay |

### Interactive Setup

When running TouchKio for the first time or with `--setup`, you'll be prompted for slideshow configuration:

```
Enable photo slideshow? (y/N): y
Enter slideshow photos directory (~/TouchKio-Photo-Screensaver/photos): /home/user/Photos
Enter Google Photos album ID (optional):
Enter slideshow interval (seconds) (5): 10
Enter idle timeout (seconds) (180): 300
Show clock overlay? (true): true
```

## 📸 Setting Up Photo Sources

### Local Photos

1. Place photos in your configured directory (default: `~/TouchKio-Photo-Screensaver/photos`)
2. Supported formats: JPG, JPEG, PNG, GIF, BMP, WEBP
3. Photos will be automatically discovered and shuffled

### Google Photos

1. Create a shared album in Google Photos
2. Get the album ID from the sharing URL:
   ```
   https://photos.google.com/share/ALBUM_ID_HERE
   ```
3. Use the `ALBUM_ID_HERE` part as the `--slideshow-google-album` parameter

The slideshow will:
- Try Google Photos first (if configured)
- Fall back to local photos if Google Photos fails
- Cache up to 100 photos from Google Photos
- Automatically retry Google Photos every minute if offline

## 🏠 Home Assistant Integration

### MQTT Entities

When MQTT is configured, the following entities are automatically created:

#### Switch: `switch.touchkio_slideshow`
- **Purpose**: Enable/disable slideshow manually
- **States**: `ON` / `OFF`

#### Number: `number.touchkio_slideshow_interval`
- **Purpose**: Control slide duration
- **Range**: 1-60 seconds
- **Unit**: seconds

#### Number: `number.touchkio_slideshow_idle`
- **Purpose**: Control idle timeout
- **Range**: 1-60 minutes
- **Unit**: minutes

### Example Home Assistant Automation

```yaml
automation:
  - alias: "Enable slideshow at night"
    trigger:
      platform: time
      at: "22:00:00"
    action:
      service: switch.turn_on
      target:
        entity_id: switch.touchkio_slideshow

  - alias: "Disable slideshow in morning"
    trigger:
      platform: time
      at: "07:00:00"
    action:
      service: switch.turn_off
      target:
        entity_id: switch.touchkio_slideshow
```

## 🔧 Technical Details

### Architecture

```
TouchKio Core
├── js/slideshow.js          # Main slideshow module
├── html/slideshow.html      # Slideshow display interface
├── js/hardware.js           # Hardware integration (modified)
├── js/integration.js        # MQTT/HA integration (modified)
├── js/webview.js            # User activity detection (modified)
└── index.js                 # Argument parsing (modified)
```

### HTTP API

The slideshow runs an HTTP server on port 8081 with these endpoints:

- `GET /photos` - List all available photos
- `GET /photo/{index}` - Serve local photo by index
- `GET /google-photo/{encoded_url}` - Proxy Google Photos images

### User Activity Detection

The slideshow monitors for:
- Mouse movement and clicks
- Touch events
- Keyboard input
- UI button interactions
- Navigation actions

Any activity immediately hides the slideshow and resets the idle timer.

## 🧪 Testing

### Basic Test
```bash
cd touchkio
node test-basic.js
```

### Full Integration Test
```bash
cd touchkio
node test-slideshow.js
```

### Manual Testing
1. Start TouchKio with slideshow enabled
2. Wait for the configured idle timeout
3. Verify slideshow appears with photos
4. Touch the screen to verify slideshow hides
5. Check MQTT entities in Home Assistant (if configured)

## 🎨 Customization

### Styling

The slideshow interface (`html/slideshow.html`) can be customized:
- Clock position and styling
- Overlay opacity and colors
- Transition effects
- Source indicators

### Behavior

Key configuration in `js/slideshow.js`:
- Photo caching limits
- Retry intervals
- Transition timings
- Error handling

## 🐛 Troubleshooting

### Slideshow Doesn't Start
- Check `--slideshow-enabled=true` is set
- Verify photos exist in the configured directory
- Check console output for initialization errors

### No Photos Found
- Verify the photos directory exists and contains supported image files
- Check file permissions
- For Google Photos, verify the album ID is correct and the album is shared

### MQTT Integration Issues
- Ensure MQTT broker is configured and accessible
- Check TouchKio console output for MQTT connection status
- Verify Home Assistant MQTT discovery is enabled

### Performance Issues
- Reduce `maxCachedPhotos` in slideshow configuration
- Use smaller image files
- Increase slideshow interval to reduce transitions

## 📝 Development Notes

### Adding New Features
- Photo sources: Extend `loadPhotos()` function
- Display elements: Modify `html/slideshow.html`
- MQTT controls: Add entities in `js/integration.js`

### Testing Changes
Always run both test suites after modifications:
```bash
node test-basic.js
node test-slideshow.js
```

## 🎯 Future Enhancements

Potential improvements for future versions:
- Multiple Google Photos albums support
- Photo metadata display (EXIF, location)
- Slideshow themes and layouts
- Facial recognition integration
- Weather overlay integration
- Music synchronization
- Advanced transition effects

## 📄 License

This slideshow feature is part of TouchKio and follows the same MIT license as the main project.

---

**Enjoy your new TouchKio photo slideshow! 📸✨**