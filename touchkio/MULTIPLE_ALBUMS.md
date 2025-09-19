# Multiple Google Photos Albums Support

## Overview

TouchKio Photo Screensaver now supports multiple Google Photos albums! Instead of being limited to ~330 photos from a single album, you can now combine multiple albums to get virtually unlimited photos for your slideshow.

## How It Works

- **Multiple Albums**: Provide comma-separated album IDs or URLs
- **Smart Extraction**: Each album provides up to ~330 photos (Google Photos limit)
- **Deduplication**: Automatically removes duplicate photos across albums
- **Cross-Album Randomization**: Mixes photos from all albums for variety
- **Intelligent Caching**: Caches album data for 1 hour to avoid re-fetching

## Usage

### Command Line Arguments

Use the new `--slideshow-google-albums` argument (or the legacy `--slideshow-google-album` for single albums):

```bash
# Multiple albums (new format)
touchkio --slideshow-enabled=true --slideshow-google-albums="ALBUM_ID_1,ALBUM_ID_2,ALBUM_ID_3"

# Single album (legacy format - still works)
touchkio --slideshow-enabled=true --slideshow-google-album="ALBUM_ID_1"
```

### Album ID Formats

You can use either:

1. **Full URLs**:
   ```
   https://photos.google.com/share/AF1QipXXX...?key=YYYY
   ```

2. **Just Album IDs**:
   ```
   AF1QipXXX...
   ```

### Examples

**Example 1: Multiple Family Albums**
```bash
touchkio --slideshow-enabled=true --slideshow-google-albums="YOUR_FAMILY_ALBUM_ID,YOUR_VACATION_ALBUM_ID,YOUR_EVENTS_ALBUM_ID"
```

**Example 2: Vacation + Family + Events**
```bash
touchkio --slideshow-enabled=true --slideshow-google-albums="https://photos.google.com/share/VACATION_ALBUM,https://photos.google.com/share/FAMILY_ALBUM,https://photos.google.com/share/EVENTS_ALBUM"
```

## Benefits

### 🎯 **Unlimited Photos**
- Single album: ~330 photos max
- Multiple albums: 330 × number of albums
- Example: 3 albums = ~990 photos!

### 🎲 **Better Randomization**
- Photos are mixed across ALL albums
- No more seeing all photos from Album A, then Album B
- True variety in your slideshow

### ⚡ **Smart Performance**
- Each album extracted separately for efficiency
- Automatic deduplication prevents showing same photo twice
- 1-hour caching prevents unnecessary re-fetching

### 🔧 **Easy Management**
- Split photos by theme (Family, Vacation, Events, etc.)
- Keep each album under 300 photos for best performance
- Add/remove albums easily by updating the command line

## Best Practices

### 📁 **Album Organization**
```
Album 1: Family Photos (250 photos)
Album 2: Vacation 2024 (280 photos)
Album 3: Holiday Events (200 photos)
Album 4: Pet Photos (150 photos)
Total: ~880 randomized photos!
```

### 🎯 **Optimal Album Size**
- Keep each album under **300 photos** for best extraction
- If you have 900 photos, split into 3 albums of 300 each
- This works better than 1 album of 900 photos

### ⚡ **Performance Tips**
- Use 2-5 albums for best performance
- Albums are fetched sequentially, so more albums = longer initial load
- But once cached (1 hour), switching is instant

## Troubleshooting

### No Photos Showing
1. **Check Album Privacy**: Albums must be publicly shared
2. **Verify Album IDs**: Make sure the URLs/IDs are correct
3. **Check Logs**: Look for extraction messages in console

### Only Getting Photos from One Album
1. **Check Comma Separation**: Make sure albums are separated by commas
2. **No Spaces in URLs**: Remove spaces around commas
3. **Quote the Entire List**: Use quotes around the full album list

### Performance Issues
1. **Reduce Album Count**: Try fewer albums first
2. **Check Network**: Multiple albums require more network requests
3. **Album Size**: Keep individual albums under 300 photos

## Migration from Single Album

If you're currently using single album:

**Old**:
```bash
--slideshow-google-album="ALBUM_ID"
```

**New** (backwards compatible):
```bash
--slideshow-google-albums="ALBUM_ID"
```

**Multiple Albums**:
```bash
--slideshow-google-albums="ALBUM_ID_1,ALBUM_ID_2,ALBUM_ID_3"
```

## Technical Details

- **Extraction**: Uses the same sophisticated regex patterns for each album
- **Deduplication**: SHA-256 hashing of URLs to remove duplicates
- **Randomization**: Fisher-Yates shuffle across the combined photo pool
- **Full Resolution**: All photos converted to `=w0-h0` format
- **Error Handling**: Failed albums are skipped, others continue working
- **Memory Efficient**: Photos are loaded on-demand during slideshow

---

**🎉 Enjoy your enhanced slideshow with unlimited photos!**