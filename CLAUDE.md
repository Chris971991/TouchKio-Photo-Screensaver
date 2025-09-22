# TouchKio Photo Screensaver - Claude Development Guide

## Project Overview
TouchKio Photo Screensaver is an Electron-based photo slideshow application with comprehensive MQTT integration for Home Assistant. Features include Google Photos synchronization, extensive UI customization, and smart positioning controls.

## 🎯 Upstream Contribution Goal

### **CRITICAL CONTEXT: Pull Request to Official TouchKio**

This slideshow feature is being developed for **integration into the official TouchKio GitHub repository**. This is NOT a personal project - it's intended to become a core feature of TouchKio.

### **Implications for Development:**

#### **🏆 Production-Ready Code Quality**
- Code must meet professional open-source standards
- Zero tolerance for experimental or "quick fix" code
- Every feature must be robust and reliable
- Comprehensive error handling and edge case coverage
- Clean, maintainable, well-documented codebase

#### **📚 Documentation Standards**
- User-facing documentation for slideshow setup
- Installation guides for different Pi models
- Configuration examples and best practices
- Troubleshooting guides for common issues
- Developer documentation for future maintainers

#### **🧪 Testing Requirements**
- Extensive testing across different Pi models (3B+, 4, Zero)
- Network condition testing (slow, offline, unstable)
- Edge case scenarios (missing files, corrupted data, etc.)
- Performance benchmarking and optimization
- Long-term stability testing (24+ hour runs)

#### **🔒 Security & Stability**
- Proper input validation and sanitization
- Resource management and memory cleanup
- Graceful error recovery and fallbacks
- No security vulnerabilities or data leaks
- Backwards compatibility with existing TouchKio installs

#### **📋 PR Preparation Standards**
- **Feature Documentation**: Complete user guides
- **Code Review Ready**: Clean, commented, maintainable code
- **Testing Evidence**: Comprehensive test results
- **Performance Metrics**: Before/after benchmarks
- **Backwards Compatibility**: No breaking changes
- **Integration Testing**: Works with existing TouchKio features

## 💬 Communication Style & Development Preferences

### **🔴 CRITICAL: User Communication Preferences**

**Testing Philosophy:**
- ⚠️ **NEVER commit without Pi testing** - Code must be deployed and tested on actual Pi hardware first
- ⚠️ **No exceptions** - Even small changes require Pi verification
- ⚠️ **User approval required** - Get explicit approval before any git commits

**Communication Style:**
- ✅ **Be concise and direct** - User prefers short, actionable responses
- ❌ **No long explanations** unless specifically requested
- ✅ **Focus on solutions** - What to do, not why in detail
- ✅ **Action-oriented** - Commands, code changes, next steps

## Architecture Overview

### Core Components
1. **Integration Layer** (`touchkio/js/integration.js`)
   - MQTT device discovery and state management
   - Handles all Home Assistant communication
   - Manages settings persistence via Arguments.json

2. **Slideshow Frontend** (`touchkio/html/slideshow.html`)
   - Electron renderer process
   - Applies visual styling and positioning
   - Receives config via IPC from integration layer

3. **Main Process** (`touchkio/index.js`)
   - Electron main process
   - Window management and system integration

### Settings Flow
1. User changes setting in Home Assistant
2. MQTT message sent to TouchKio
3. Integration.js receives MQTT message
4. Setting saved to Arguments.json via `updateSlideshowSetting()`
5. Setting applied to slideshow via `slideshow.updateConfig()`
6. Setting published back to MQTT via `publishState()`

### Critical Initialization Sequence
1. TouchKio starts, reads Arguments.json
2. `initSlideshow()` creates MQTT controls
3. **CRITICAL**: Load saved ARGS values into slideshow runtime config
4. `updateSlideshow()` publishes current states to MQTT
5. Home Assistant receives and displays current values

## Development Phases

### Phase 1: Core Standardization ✅
- Standardized all slideshow elements (Clock, Date, Source, Counter, Metadata)
- Consistent MQTT controls and state management
- Basic positioning and styling options

### Phase 2: Advanced Background Options ✅
- Border radius, padding, shadow controls
- Background opacity and color variations
- Enhanced visual customization

### Phase 3: Custom X/Y Positioning ✅
- Pixel-perfect positioning for all elements
- CSS units auto-detection and correction
- Settings persistence across restarts

### Phase 4: Animation & Transitions ✅ (Complete)
- **4A**: CSS animation framework and JavaScript controller ✅
- **4B**: Element entrance/exit and position transitions ✅
- **4C**: Advanced animation themes and smart timing ✅
- **4D**: Polish, optimization and accessibility ✅
- **4E**: Performance optimization and production readiness ✅

### Phase 5: Content & Metadata Enhancement (Pending)

#### **Core Concept**
Transform basic metadata display into a rich, informative, and visually appealing information system that provides context about photos.

#### **Key Features**

**1. Extended Metadata Fields**
- EXIF Data: Camera model, lens, ISO, aperture, shutter speed
- Location Info: GPS coordinates → City, Country display
- Date/Time: Relative dates ("3 days ago", "Last summer")
- Album/Collection: Google Photos album name, folder path
- Tags/Description: Photo descriptions, AI-generated captions
- Photo Stats: View count, favorites, sharing status

**2. Metadata Display Modes**
- **Minimal**: Just filename (current)
- **Basic**: Filename + date
- **Extended**: All available metadata
- **Photography**: Camera settings focus
- **Journey**: Location + date focus
- **Smart**: Auto-selects relevant info per photo

### Phase 6: Visual Preset Editor System ✅ (Infrastructure Complete)

#### **🎯 Vision Statement**
Create a **Canva/Webflow-style visual editor** for TouchKio slideshow layouts that allows users to design presets through intuitive drag-and-drop, resize, and style controls.

#### **📋 Implementation Status**

##### **Phase 6A: Editor Mode Infrastructure ✅ COMPLETE**
- ✅ **MQTT Control**: `switch.preset_editor_mode` - Toggle editor on/off via Home Assistant
- ✅ **Grid Overlay System**: Subtle white grid (20px spacing, 30% opacity)
- ✅ **Activity Detection Control**: Mouse movement disabled when editor mode active
- ✅ **Visual Feedback**: Blue notification shows "Editor Mode Active" status

##### **Phase 6B: Context Menu System ✅ COMPLETE**
- ✅ **Right-Click Context Menus**: Right-click any UI element to open customization menu
- ✅ **Touch Support**: Long press (500ms) on touch devices with haptic feedback
- ✅ **Beautiful Menu Design**: Dark theme with blur backdrop and smooth animations
- ✅ **Save/Discard System**: Preview changes before saving, discard to exit editor mode
- ✅ **Pending Changes Tracking**: Shows count of unsaved changes in status bar

##### **Phase 6C: Settings Persistence Architecture ✅ COMPLETE**
- ✅ **Critical Save Bug Fixed**: All settings properly persist to Arguments.json
- ✅ **IPC Communication**: Proper renderer→main process communication
- ✅ **Runtime Config Update**: All editor properties mapped to MQTT settings
- ✅ **Restart Survival**: Settings load on TouchKio restart

## ⚠️ Known Issues & Current Bugs

### **🔴 CRITICAL: Custom Position Saving Issues**

**Problem**: Photo counter and source elements don't retain custom positions when saving in editor mode - they revert to center position.

**Root Cause**: Custom coordinates not being properly saved to Arguments.json despite UI appearing to work.

**Evidence**:
```bash
# Check saved coordinates (should have pixel values, currently empty)
ssh pi@kiosk.local "cat ~/.config/touchkio/Arguments.json | python3 -m json.tool | grep -E 'counter_custom|source_custom'"
# Shows: "slideshow_counter_custom_x": "", "slideshow_counter_custom_y": ""
```

**Investigation Needed**:
1. Check if editor save function includes counter/source coordinate mapping
2. Verify IPC communication sends counter/source coordinates to main process
3. Confirm MQTT settings update includes these specific coordinate keys
4. Test if integration.js properly handles these coordinate updates

**Files to Check**:
- `touchkio/html/slideshow.html` - Editor save function coordinate mapping
- `touchkio/js/slideshow.js` - IPC message handling for coordinates
- `touchkio/js/integration.js` - MQTT setting update functions

**Status**: 🔴 **BLOCKING** - Affects editor mode functionality and user experience

## Essential Pi Commands

**Pi Connection**:
- **Hostname**: `pi@kiosk.local` (NOT touchkio.local)
- **TouchKio Install Path**: `/usr/lib/touchkio/resources/app/`
- **Authentication**: SSH key authentication configured (no password prompts)
- **Screenshot API**: `http://kiosk.local:3001` (for Claude development)

**Single File Transfers**:
```bash
# Transfer slideshow.html
scp touchkio/html/slideshow.html pi@kiosk.local:/tmp/slideshow.html
ssh pi@kiosk.local "sudo cp /tmp/slideshow.html /usr/lib/touchkio/resources/app/html/"

# Transfer slideshow.js
scp touchkio/js/slideshow.js pi@kiosk.local:/tmp/slideshow.js
ssh pi@kiosk.local "sudo cp /tmp/slideshow.js /usr/lib/touchkio/resources/app/js/"

# Transfer integration.js
scp touchkio/js/integration.js pi@kiosk.local:/tmp/integration.js
ssh pi@kiosk.local "sudo cp /tmp/integration.js /usr/lib/touchkio/resources/app/js/"

# Restart TouchKio service (always required after file changes)
ssh pi@kiosk.local "systemctl --user restart touchkio.service"
```

**Combined Deploy & Restart (Most Efficient)**:
```bash
# Single file deploy and restart
scp touchkio/js/slideshow.js pi@kiosk.local:/tmp/slideshow.js && ssh pi@kiosk.local "sudo cp /tmp/slideshow.js /usr/lib/touchkio/resources/app/js/ && systemctl --user restart touchkio.service"

# Multiple file deploy and restart
scp touchkio/html/slideshow.html pi@kiosk.local:/tmp/slideshow.html && scp touchkio/js/slideshow.js pi@kiosk.local:/tmp/slideshow.js && ssh pi@kiosk.local "sudo cp /tmp/slideshow.html /usr/lib/touchkio/resources/app/html/ && sudo cp /tmp/slideshow.js /usr/lib/touchkio/resources/app/js/ && systemctl --user restart touchkio.service"
```

**Debug Commands**:
```bash
# Watch ALL TouchKio logs live (shows everything, restarts, errors)
ssh pi@kiosk.local "sudo journalctl -f | grep -i touchkio"

# Check recent logs for slideshow/animation activity
ssh pi@kiosk.local "sudo journalctl -u user@1000.service --since '2 minutes ago' | grep -E 'slideshow|animation|entrance|error' | tail -15"

# Check if custom coordinates are saved
ssh pi@kiosk.local "cat ~/.config/touchkio/Arguments.json | python3 -m json.tool | grep -A1 -B1 -i custom"

# Check TouchKio service status
ssh pi@kiosk.local "systemctl --user status touchkio.service"
```

**Screenshot API for Visual Development**:
```bash
# Take screenshot for development review
curl http://kiosk.local:3001/screenshot > screenshot.png

# Screenshot with wait (for animations)
curl http://kiosk.local:3001/screenshot/wait/2000 > screenshot.png

# Direct screenshot command
ssh pi@kiosk.local "grim /tmp/dev.png" && scp pi@kiosk.local:/tmp/dev.png ./screenshot.png
```

## Key Files & Locations

**Installation Directory**: `/usr/lib/touchkio/resources/app/`
**Config Directory**: `~/.config/touchkio/`
**Main Config File**: `~/.config/touchkio/Arguments.json`
**Service File**: `~/.config/systemd/user/touchkio.service`

**Development Files**:
- `touchkio/js/integration.js` - MQTT integration and settings management
- `touchkio/html/slideshow.html` - Frontend slideshow interface
- `touchkio/index.js` - Main Electron process
- `touchkio/install.sh` - Installation script with smart defaults

## Git Commit Rules ⚠️

### MANDATORY: No Commits Without Testing

**🚫 NEVER commit code to Git unless:**
1. ✅ Code has been deployed and tested on the Pi
2. ✅ User has explicitly approved the changes
3. ✅ All functionality verified working
4. ✅ No errors in TouchKio logs
5. ✅ Settings persistence confirmed
6. ✅ **UPSTREAM READY**: Code meets production standards for official TouchKio PR

**📝 Commit Message Must Include:**
- What was changed
- What was tested on Pi
- Confirmation that it works
- **Production readiness confirmation**

## Testing Guidelines

### Before Code Changes
1. Always test on Pi after file transfers
2. Check Home Assistant shows correct values
3. Verify settings persist across restarts
4. Test both custom positioning and preset positioning

### After Code Changes
1. Transfer files to Pi using commands above
2. Restart TouchKio service
3. Check startup logs for errors
4. Test in Home Assistant interface
5. Restart TouchKio again to verify persistence
6. **Get user approval before ANY git commit**

## 📡 Complete MQTT Control Reference

### Current MQTT Controls (100+ Total)

#### **Core Slideshow Controls (3)**
- `switch.slideshow_enabled` - Master on/off for slideshow feature
- `switch.slideshow_active` - Current running state (visibility-based)
- `text.slideshow_photos_dir` - Local photos directory path

#### **Visual Preset Editor Controls (11)**
- `switch.preset_editor_mode` - Toggle visual editor on/off
- `switch.editor_grid_visible` - Show positioning grid
- `switch.editor_snap_to_grid` - Enable snap to grid
- `switch.editor_show_guides` - Show alignment guides
- `number.editor_grid_size` - Grid spacing (5-50px)
- `select.editor_element_focus` - Currently selected element
- `select.current_preset` - Active preset selection
- `text.preset_save_name` - Name for saving custom preset
- `button.save_current_preset` - Save current layout as preset
- `button.apply_preset` - Apply selected preset
- `button.export_preset` - Export preset to file

#### **Slideshow Behavior (6)**
- `number.slideshow_interval` - Time between photos (seconds)
- `number.slideshow_idle_timeout` - Activate after inactivity (minutes)
- `switch.slideshow_random_order` - Random vs sequential playback
- `select.slideshow_photo_fit` - Contain/Cover/Fill/None/Scale-Down
- `select.slideshow_transition_type` - Fade/Slide/Zoom/None
- `number.slideshow_transition_duration` - Transition time (ms)

#### **Animation Controls (3)**
- `select.animation_theme` - None/Subtle/Dynamic/Energetic/Cinematic
- `number.animation_speed` - Animation speed multiplier (0.1-3.0)
- `switch.animations_enabled` - Enable/disable all animations

#### **Element Controls (65)**
Each of 5 elements (Clock, Date, Source, Counter, Metadata) has 13 controls:
- Position (9 presets + custom coordinates)
- Styling (colors, opacity, fonts, backgrounds)
- Effects (shadows, borders, padding)

#### **Performance Settings (7)**
- `number.slideshow_preload_buffer_size` - Photos to preload (1-50)
- `switch.slideshow_disk_cache_enabled` - Enable disk caching
- `number.slideshow_disk_cache_max_size` - Cache size (MB)
- `number.slideshow_cache_cleanup_trigger` - Cleanup threshold (%)
- `number.slideshow_concurrent_downloads` - Parallel downloads (1-5)
- `switch.slideshow_fallback_enabled` - Enable fallback photos
- `number.slideshow_fallback_timeout` - Fallback timeout (seconds)

#### **Photo Sources & Albums (11)**
- `text.slideshow_google_album_1` through `text.slideshow_google_album_10` - Google Photos album IDs
- `select.slideshow_preferred_source` - Choose between local/Google photos

### MQTT Entity Naming Convention

**Pattern**: `homeassistant/{domain}/touchkio_kiosk_{entity}/config`

**Domain Types**:
- `switch` - 24 entities (on/off controls)
- `select` - 21 entities (dropdown choices)
- `number` - 23 entities (numeric values)
- `text` - 40 entities (text input fields)
- `button` - 9 entities (action triggers)

**State Topics**: `touchkio/kiosk/{entity}/state`

---

*Last Updated: 2025-09-22*
*Version: Phase 6C Complete - Editor Mode Flash Bug Fixed + All State Management Working*
*MQTT Controls: 117 entities across 5 domains*