const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const axios = require("axios");
const crypto = require("crypto");
const exifr = require("exifr");
const { app, WebContentsView } = require("electron");
const { URL } = require("url");

global.SLIDESHOW = global.SLIDESHOW || {
  initialized: false,
  active: false,
  server: null,
  view: null,
  photos: [],
  currentIndex: 0,
  timer: null,
  idleTimer: null,
  lastActivity: new Date(),
  preloadedNext: null,

  // Google Photos lazy loading
  googlePhotoUrls: [],
  googlePhotoIndex: 0,
  photoCache: new Map(),
  lastAlbumFetch: null,
  lastAlbumConfig: null,

  // Smart Preloading System
  preloadQueue: [],
  preloadActive: false,
  preloadWorkers: [],
  diskCache: new Map(),
  cacheDirectory: null,
  networkStatus: {
    connected: true,
    quality: 'good',
    lastCheck: new Date(),
    failureCount: 0
  },
  fallbackMode: {
    enabled: true,
    currentSource: 'auto',
    preferredSource: 'google',
    lastSwitch: null
  },
  config: {
    enabled: false,
    photosDir: null,
    googleAlbumIds: null, // Support comma-separated list of album IDs/URLs
    interval: 5000,
    idleTimeout: 180000,

    // Clock settings
    showClock: true,
    clockPosition: "bottom-right", // "top-left", "top-right", "bottom-left", "bottom-right", "center"
    clockSize: "large", // "small", "medium", "large", "xlarge"
    clockBackground: "dark", // "dark", "light", "none"
    clockOpacity: 0.7,
    clockColor: "#ffffff",

    // Source indicator settings
    showSourceIndicator: true,
    sourcePosition: "top-left", // "top-left", "top-right", "bottom-left", "bottom-right"
    sourceSize: "medium", // "small", "medium", "large"
    sourceOpacity: 0.8,

    // Photo counter settings
    showPhotoCounter: true,
    counterPosition: "bottom-left", // "top-left", "top-right", "bottom-left", "bottom-right"
    counterSize: "medium", // "small", "medium", "large"
    counterOpacity: 0.8,

    // Photo metadata settings
    showMetadata: true,
    metadataPosition: "bottom-center", // "top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right", "center"
    metadataSize: "small", // "small", "medium", "large"
    metadataOpacity: 0.8,
    metadataFontSize: "small", // "tiny", "small", "medium", "large", "xlarge", "xxlarge"
    metadataBackgroundOpacity: 70, // 0-100%
    metadataTransitionType: "fade", // "fade", "blur", "slide-up", "slide-down", "typewriter", "glow"
    showFilename: true,
    showDateTaken: true,
    showCameraInfo: true,
    showLocation: false, // GPS coordinates can be sensitive
    metadataBackground: "dark", // "dark", "light", "blue", "green", "red", "purple", "none"

    // Photo settings
    randomOrder: true,
    photoFit: "contain", // "contain", "cover", "fill"

    // Transition settings
    transitionType: "fade",
    transitionDuration: 2000,

    // System settings
    port: 8081,
    maxCachedPhotos: 100,

    // Smart Preloading settings
    preloadBufferSize: 20,
    diskCacheEnabled: true,
    diskCacheMaxSize: 2147483648, // 2GB in bytes
    diskCacheCleanupTrigger: 0.9, // 90%
    concurrentDownloads: 3,
    fallbackEnabled: true,
    fallbackTimeout: 5000, // 5 seconds
    preferredSource: 'google', // 'google', 'local', 'auto'
  },
};

/**
 * Central Timer Controller - coordinates all backend timing using requestAnimationFrame-like pattern
 */
class BackendTimerController {
  constructor() {
    this.timers = new Map();
    this.intervals = new Map();
    this.isRunning = false;
    this.frameId = null;
  }

  // High-precision timer using native setTimeout for accuracy
  scheduleTimeout(callback, delay, id = null) {
    const timerId = id || `timeout_${Date.now()}`;

    const timeoutHandle = setTimeout(() => {
      this.timers.delete(timerId);
      callback();
    }, delay);

    this.timers.set(timerId, timeoutHandle);
    return timerId;
  }

  // High-precision interval using native setInterval for stability
  scheduleInterval(callback, interval, id = null) {
    const intervalId = id || `interval_${Date.now()}`;

    const intervalHandle = setInterval(callback, interval);
    this.intervals.set(intervalId, intervalHandle);
    return intervalId;
  }

  // Clear specific timer
  clearTimer(id) {
    if (this.timers.has(id)) {
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
    }
    if (this.intervals.has(id)) {
      clearInterval(this.intervals.get(id));
      this.intervals.delete(id);
    }
  }

  // Clear all timers
  clearAll() {
    this.timers.forEach(timer => clearTimeout(timer));
    this.intervals.forEach(interval => clearInterval(interval));
    this.timers.clear();
    this.intervals.clear();
  }
}

// Global timer controller instance
global.timerController = new BackendTimerController();

/**
 * Backend Memory Management - handles photo cache and preload cleanup
 */
class BackendMemoryManager {
  constructor() {
    this.maxCacheSize = 50; // Maximum cached photos
    this.maxPreloadSize = 10; // Maximum preloaded photos
    this.cleanupInterval = null;
    this.isMonitoring = false;
  }

  // Clean up old cache entries
  cleanupPhotoCache() {
    const cache = SLIDESHOW.photoCache;
    if (cache.size <= this.maxCacheSize) return;

    // Convert to array and sort by last access (if available) or insertion order
    const entries = Array.from(cache.entries());
    const toRemove = entries.slice(0, entries.length - this.maxCacheSize);

    toRemove.forEach(([key, value]) => {
      cache.delete(key);
      // If it's a buffer or binary data, clear it
      if (value && typeof value === 'object' && value.buffer) {
        value.buffer = null;
      }
    });

    console.log(`Cleaned up ${toRemove.length} old photo cache entries`);
  }

  // Clean up disk cache
  cleanupDiskCache() {
    const diskCache = SLIDESHOW.diskCache;
    if (diskCache.size <= this.maxCacheSize) return;

    const entries = Array.from(diskCache.entries());
    const toRemove = entries.slice(0, entries.length - this.maxCacheSize);

    toRemove.forEach(([key, value]) => {
      diskCache.delete(key);
      // Clean up file references if any
      if (value && value.path) {
        try {
          require('fs').unlinkSync(value.path);
        } catch (err) {
          // File may already be deleted, ignore error
        }
      }
    });

    console.log(`Cleaned up ${toRemove.length} old disk cache entries`);
  }

  // Clean up preload queue
  cleanupPreloadQueue() {
    if (SLIDESHOW.preloadQueue.length <= this.maxPreloadSize) return;

    // Keep only the most recent preload requests
    const toRemove = SLIDESHOW.preloadQueue.splice(0, SLIDESHOW.preloadQueue.length - this.maxPreloadSize);
    console.log(`Cleaned up ${toRemove.length} old preload queue entries`);
  }

  // Force cleanup of all caches
  cleanupAll() {
    console.log('Performing full memory cleanup...');

    // Clear photo cache
    SLIDESHOW.photoCache.clear();

    // Clear disk cache and files
    SLIDESHOW.diskCache.forEach((value, key) => {
      if (value && value.path) {
        try {
          require('fs').unlinkSync(value.path);
        } catch (err) {
          // Ignore errors
        }
      }
    });
    SLIDESHOW.diskCache.clear();

    // Clear preload queue
    SLIDESHOW.preloadQueue.length = 0;

    // Clear preloaded next
    SLIDESHOW.preloadedNext = null;

    console.log('Full memory cleanup completed');
  }

  // Start memory monitoring
  startMonitoring() {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.cleanupInterval = global.timerController.scheduleInterval(() => {
      this.cleanupPhotoCache();
      this.cleanupDiskCache();
      this.cleanupPreloadQueue();

      // Log memory usage
      const memInfo = this.getMemoryInfo();
      console.log('Memory status:', memInfo);
    }, 60000, 'backend_memory_monitor'); // Check every minute
  }

  // Stop monitoring
  stopMonitoring() {
    if (this.cleanupInterval) {
      global.timerController.clearTimer(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.isMonitoring = false;
  }

  // Get memory usage info
  getMemoryInfo() {
    const memUsage = process.memoryUsage();
    return {
      photoCacheSize: SLIDESHOW.photoCache.size,
      diskCacheSize: SLIDESHOW.diskCache.size,
      preloadQueueSize: SLIDESHOW.preloadQueue.length,
      rss: Math.round(memUsage.rss / 1024 / 1024), // MB
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      external: Math.round(memUsage.external / 1024 / 1024) // MB
    };
  }
}

// Global backend memory manager instance
global.backendMemoryManager = new BackendMemoryManager();

/**
 * IPC Batching System - reduces frequent webContents.send() calls
 */
class IPCBatcher {
  constructor() {
    this.updateQueue = [];
    this.batchTimeout = null;
    this.batchDelay = 16; // ~60fps batching
    this.isProcessing = false;
  }

  // Queue an IPC message for batching
  queue(channel, data) {
    this.updateQueue.push({ channel, data, timestamp: Date.now() });

    // Schedule batch processing if not already scheduled
    if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => {
        this.processBatch();
      }, this.batchDelay);
    }
  }

  // Process all queued messages in a single batch
  processBatch() {
    if (this.isProcessing || this.updateQueue.length === 0) return;

    this.isProcessing = true;
    this.batchTimeout = null;

    // Group messages by channel
    const batches = {};
    this.updateQueue.forEach(msg => {
      if (!batches[msg.channel]) {
        batches[msg.channel] = [];
      }
      batches[msg.channel].push(msg);
    });

    // Send batched messages
    Object.keys(batches).forEach(channel => {
      const messages = batches[channel];

      if (channel === 'slideshow-config') {
        // Merge config updates into single message
        const mergedConfig = {};
        messages.forEach(msg => {
          Object.assign(mergedConfig, msg.data);
        });

        if (SLIDESHOW.view && SLIDESHOW.view.webContents) {
          SLIDESHOW.view.webContents.send(channel, mergedConfig);
        }
      } else {
        // For non-config messages, send the latest one
        const latestMessage = messages[messages.length - 1];
        if (SLIDESHOW.view && SLIDESHOW.view.webContents) {
          SLIDESHOW.view.webContents.send(channel, latestMessage.data);
        }
      }
    });

    // Clear queue and reset processing flag
    this.updateQueue.length = 0;
    this.isProcessing = false;

    console.log(`Processed IPC batch: ${Object.keys(batches).length} channels`);
  }

  // Force immediate processing of queue
  flush() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    this.processBatch();
  }

  // Get batch statistics
  getStats() {
    return {
      queueLength: this.updateQueue.length,
      isProcessing: this.isProcessing,
      batchDelay: this.batchDelay
    };
  }
}

// Global IPC batcher instance
global.ipcBatcher = new IPCBatcher();

/**
 * Combines multiple Google album fields into a single string
 */
const getGoogleAlbumIds = () => {
  console.log("Getting Google Album IDs from ARGS:", JSON.stringify(ARGS, null, 2));

  const albums = [];

  // Check for individual album fields (album_1, album_2, etc.)
  for (let i = 1; i <= 5; i++) {
    const albumValue = ARGS[`slideshow_google_album_${i}`];
    console.log(`ARGS.slideshow_google_album_${i}: "${albumValue}"`);
    if (albumValue && albumValue.trim()) {
      albums.push(albumValue.trim());
    }
  }

  // Fallback to legacy fields for backward compatibility
  if (albums.length === 0) {
    const legacyAlbums = ARGS.slideshow_google_albums || ARGS.slideshow_google_album;
    console.log(`Legacy album fields - slideshow_google_albums: "${legacyAlbums}", slideshow_google_album: "${ARGS.slideshow_google_album}"`);
    if (legacyAlbums) {
      console.log(`Using legacy albums: "${legacyAlbums}"`);
      return legacyAlbums;
    }
  }

  const result = albums.length > 0 ? albums.join(',') : null;
  console.log(`Final getGoogleAlbumIds result: "${result}"`);
  return result;
};

const init = async () => {
  // Always initialize slideshow when slideshow.html is loaded
  // Slideshow can be controlled via MQTT regardless of command line args

  const homedir = require("os").homedir();
  const defaultPhotosDir = path.join(homedir, "TouchKio-Photo-Screensaver", "photos");

  // Expand tilde in photos directory path
  let photosDir = ARGS.slideshow_photos_dir || defaultPhotosDir;
  if (photosDir.startsWith('~')) {
    photosDir = photosDir.replace(/^~/, homedir);
  }

  SLIDESHOW.config = {
    enabled: ARGS.slideshow_enabled === "true",
    photosDir: photosDir,
    googleAlbumIds: getGoogleAlbumIds(), // Combine multiple album fields
    interval: parseInt(ARGS.slideshow_interval) * 1000 || 5000,
    idleTimeout: parseFloat(ARGS.slideshow_idle_timeout) * 60000 || 180000,

    // Clock settings
    showClock: ARGS.slideshow_show_clock !== "false",
    clockPosition: ARGS.slideshow_clock_position || "bottom-right",
    clockSize: ARGS.slideshow_clock_size || "large",
    clockBackground: ARGS.slideshow_clock_background || "dark",
    clockOpacity: parseFloat(ARGS.slideshow_clock_opacity) || 0.7,
    clockColor: ARGS.slideshow_clock_color || "#ffffff",

    // Source indicator settings
    showSourceIndicator: ARGS.slideshow_show_source !== "false",
    sourcePosition: ARGS.slideshow_source_position || "top-left",
    sourceSize: ARGS.slideshow_source_size || "medium",
    sourceOpacity: parseFloat(ARGS.slideshow_source_opacity) || 0.8,

    // Photo counter settings
    showPhotoCounter: ARGS.slideshow_show_counter !== "false",
    counterPosition: ARGS.slideshow_counter_position || "bottom-left",
    counterSize: ARGS.slideshow_counter_size || "medium",
    counterOpacity: parseFloat(ARGS.slideshow_counter_opacity) || 0.8,

    // Photo metadata settings
    showMetadata: ARGS.slideshow_show_metadata !== "false",
    metadataPosition: ARGS.slideshow_metadata_position || "bottom-center",
    metadataSize: ARGS.slideshow_metadata_size || "small",
    metadataOpacity: parseFloat(ARGS.slideshow_metadata_opacity) || 0.8,
    metadataFontSize: ARGS.slideshow_metadata_font_size || "small",
    metadataBackgroundOpacity: parseInt(ARGS.slideshow_metadata_background_opacity) || 70,
    metadataTransitionType: ARGS.slideshow_metadata_transition_type || "fade",
    showFilename: ARGS.slideshow_show_filename !== "false",
    showDateTaken: ARGS.slideshow_show_date_taken !== "false",
    showCameraInfo: ARGS.slideshow_show_camera_info !== "false",
    showLocation: ARGS.slideshow_show_location === "true", // Default false for privacy
    metadataBackground: ARGS.slideshow_metadata_background || "dark",

    // Photo settings
    randomOrder: ARGS.slideshow_random_order !== "false",
    photoFit: ARGS.slideshow_photo_fit || "contain",

    // Transition settings
    transitionType: ARGS.slideshow_transition_type || "fade",
    transitionDuration: parseInt(ARGS.slideshow_transition_duration) || 2000,

    // System settings
    port: 8081,
    maxCachedPhotos: 100,

    // Smart Preloading settings
    preloadBufferSize: parseInt(ARGS.slideshow_preload_buffer_size) || 20,
    diskCacheEnabled: ARGS.slideshow_disk_cache_enabled !== "false",
    diskCacheMaxSize: parseInt(ARGS.slideshow_disk_cache_max_size) || 2147483648, // 2GB in bytes
    diskCacheCleanupTrigger: parseFloat(ARGS.slideshow_cache_cleanup_trigger) || 0.9, // 90%
    concurrentDownloads: parseInt(ARGS.slideshow_concurrent_downloads) || 3,
    fallbackEnabled: ARGS.slideshow_fallback_enabled !== "false",
    fallbackTimeout: parseInt(ARGS.slideshow_fallback_timeout) || 5000, // 5 seconds
    preferredSource: ARGS.slideshow_preferred_source || 'google', // 'google', 'local', 'auto'
  };

  console.log("Slideshow Configuration:", JSON.stringify(SLIDESHOW.config, null, 2));

  try {
    await initHttpServer();
    await initSlideshowView();
    await initDiskCache();
    await loadPhotos();
    setupIdleDetection();
    startPreloadManager();

    SLIDESHOW.initialized = true;

    // Pre-populate frontend with photos now that slideshow is fully initialized
    await prePopulateSlideshowPhotos();

    // Start backend memory monitoring
    global.backendMemoryManager.startMonitoring();
    console.log('Slideshow initialized with memory management');
    console.log("Slideshow initialized successfully");
    return true;
  } catch (error) {
    console.error("Failed to initialize slideshow:", error.message);
    return false;
  }
};

const initHttpServer = async () => {
  return new Promise((resolve, reject) => {
    SLIDESHOW.server = http.createServer(async (req, res) => {
      try {
        if (req.url === "/photos") {
          // Smart photo counting: use Google Photos if available, otherwise local photos
          let photosToCount;
          if (SLIDESHOW.googlePhotoUrls.length > 0) {
            // Google Photos are available - count those
            photosToCount = SLIDESHOW.googlePhotoUrls.map((url, index) => ({
              id: `google_${index}`,
              url: `/google-photo/${encodeURIComponent(url)}`,
              type: "google",
              title: `Google Photo ${index + 1}`
            }));
          } else {
            // No Google Photos - count local photos
            photosToCount = SLIDESHOW.photos.map((photo, index) => ({
              ...photo,
              id: `local_${index}`,
              url: `/photo/${index}`
            }));
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ photos: photosToCount }));
        } else if (req.url.startsWith("/photo/")) {
          const index = parseInt(req.url.split("/")[2]);
          if (index >= 0 && index < SLIDESHOW.photos.length) {
            const photo = SLIDESHOW.photos[index];
            await servePhoto(photo, res);
          } else {
            res.writeHead(404);
            res.end("Photo not found");
          }
        } else if (req.url.startsWith("/google-photo/")) {
          const photoUrl = decodeURIComponent(req.url.substring(14));
          await serveGooglePhoto(photoUrl, res);
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      } catch (error) {
        console.error("HTTP Server Error:", error.message);
        res.writeHead(500);
        res.end("Internal Server Error");
      }
    });

    SLIDESHOW.server.listen(SLIDESHOW.config.port, (error) => {
      if (error) {
        reject(error);
      } else {
        console.log(`Slideshow HTTP server listening on port ${SLIDESHOW.config.port}`);
        resolve();
      }
    });
  });
};

const initSlideshowView = async () => {
  try {
    SLIDESHOW.view = new WebContentsView({
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        transparent: true,
        backgroundThrottling: false,
      },
    });

    // Set the view to be transparent
    SLIDESHOW.view.setBackgroundColor('#00000000');
    SLIDESHOW.view.setVisible(false);

    const slideshowHtmlPath = path.join(APP.path, "html", "slideshow.html");
    await SLIDESHOW.view.webContents.loadFile(slideshowHtmlPath);

    // Listen for user activity events from the slideshow interface
    const { ipcMain } = require("electron");
    let activityGracePeriod = false;

    ipcMain.on("slideshow-user-activity", () => {
      // Only process activity if slideshow is actually visible and not in grace period
      if (SLIDESHOW.active && !activityGracePeriod) {
        console.log("User activity detected in slideshow");
        EVENTS.emit("userActivity");
      } else if (activityGracePeriod) {
        console.log("User activity detected but ignored during grace period");
      }
    });

    // Function to start activity grace period after slideshow starts
    SLIDESHOW.startActivityGracePeriod = () => {
      activityGracePeriod = true;
      console.log("Activity detection disabled for 1 second (grace period)");
      setTimeout(() => {
        activityGracePeriod = false;
        console.log("Activity detection re-enabled");
      }, 1000);
    };
  } catch (error) {
    console.warn("Running outside Electron context, slideshow view not initialized");
    SLIDESHOW.view = null;
  }
};

const publishSlideshowState = () => {
  // Publish slideshow active state to MQTT if integration is available
  if (global.INTEGRATION?.client && global.INTEGRATION?.root) {
    const state = SLIDESHOW.active ? "ON" : "OFF";
    const topic = `${global.INTEGRATION.root}/slideshow_active/state`;
    global.INTEGRATION.client.publish(topic, state, { retain: true });
  }
};

const resizeSlideshowView = () => {
  if (SLIDESHOW.view && SLIDESHOW.active && global.WEBVIEW?.window) {
    const windowBounds = global.WEBVIEW.window.getBounds();
    SLIDESHOW.view.setBounds({
      x: 0,
      y: 0,
      width: windowBounds.width,
      height: windowBounds.height,
    });
  }
};

const loadPhotos = async () => {
  SLIDESHOW.photos = [];
  SLIDESHOW.googlePhotoUrls = [];

  try {
    let hasGooglePhotos = false;

    if (SLIDESHOW.config.googleAlbumIds) {
      console.log("Loading Google Photos...");
      await loadGooglePhotos();
      hasGooglePhotos = SLIDESHOW.googlePhotoUrls.length > 0;
    }

    // Only load local photos if no Google Photos were found
    if (!hasGooglePhotos) {
      console.log("No Google Photos found, loading local photos...");
      await loadLocalPhotos();
    }

    const totalPhotos = SLIDESHOW.googlePhotoUrls.length + SLIDESHOW.photos.length;
    if (totalPhotos === 0) {
      console.warn("No photos found for slideshow");
    } else {
      if (SLIDESHOW.googlePhotoUrls.length > 0) {
        console.log(`Loaded ${SLIDESHOW.googlePhotoUrls.length} Google Photos for slideshow`);
      } else {
        console.log(`Loaded ${SLIDESHOW.photos.length} local photos for slideshow`);
      }

      // Check persistent random mode setting
      const randomModeEnabled = ARGS.slideshow_random_order === "true" || ARGS.slideshow_random_order === true;
      if (randomModeEnabled) {
        console.log("Random mode enabled - shuffling photos");
        shufflePhotos();
      }
    }
  } catch (error) {
    console.error("Error loading photos:", error.message);
  }
};

// Pre-populate frontend slideshow with photos during startup to prevent "No Photos Available"
const prePopulateSlideshowPhotos = async () => {
  // Only pre-populate if slideshow view exists and is initialized
  if (!SLIDESHOW.view || !SLIDESHOW.initialized) {
    console.log("Slideshow view not ready yet, skipping photo pre-population");
    return;
  }

  try {
    // Prepare photo list for frontend counting (same logic as in showSlideshow)
    let photosToCount;
    if (SLIDESHOW.googlePhotoUrls.length > 0) {
      // Google Photos are available
      photosToCount = SLIDESHOW.googlePhotoUrls.map((url, index) => ({
        id: `google_${index}`,
        url: `/google-photo/${encodeURIComponent(url)}`,
        type: "google",
        title: `Google Photo ${index + 1}`
      }));
    } else {
      // Local photos
      photosToCount = SLIDESHOW.photos.map((photo, index) => ({
        ...photo,
        id: `local_${index}`,
        url: `/photo/${index}`
      }));
    }

    // Send photo configuration to frontend
    global.ipcBatcher.queue("slideshow-config", {
      config: SLIDESHOW.config,
      photos: photosToCount,
      googlePhotoCount: SLIDESHOW.googlePhotoUrls.length,
    });

    console.log("Pre-populated slideshow with photo configuration");

    // Optionally load and send first photo to avoid any delay
    if (photosToCount.length > 0) {
      let firstPhoto = null;
      if (SLIDESHOW.googlePhotoUrls.length > 0) {
        firstPhoto = await getNextGooglePhoto();
      } else if (SLIDESHOW.photos.length > 0) {
        firstPhoto = SLIDESHOW.photos[0];
      }

      if (firstPhoto) {
        SLIDESHOW.view.webContents.send("show-photo", {
          index: 0,
          photo: firstPhoto,
        });
        console.log("Pre-loaded first photo for immediate display");
      }
    }
  } catch (error) {
    console.warn("Error pre-populating slideshow photos:", error.message);
  }
};

// Helper function to extract photos from a single album
const extractPhotosFromAlbum = async (albumId) => {
  try {
    // Handle both full URLs and just album IDs
    let albumUrl;
    if (albumId.startsWith('http')) {
      albumUrl = albumId;
    } else {
      albumUrl = `https://photos.google.com/share/${albumId}`;
    }

    console.log(`Fetching album: ${albumUrl}`);

    // Helper function to handle redirects
    const fetchWithRedirects = async (url, maxRedirects = 5) => {
      return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
          hostname: urlObj.hostname,
          path: urlObj.pathname + urlObj.search,
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "identity",
            "Cache-Control": "no-cache",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Upgrade-Insecure-Requests": "1"
          }
        };

        const req = https.request(options, (res) => {
          // Handle redirects
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
            if (maxRedirects > 0 && res.headers.location) {
              console.log(`Following redirect to: ${res.headers.location}`);
              // Handle relative URLs
              let redirectUrl = res.headers.location;
              if (!redirectUrl.startsWith('http')) {
                redirectUrl = new URL(redirectUrl, url).href;
              }
              return fetchWithRedirects(redirectUrl, maxRedirects - 1)
                .then(resolve)
                .catch(reject);
            } else {
              reject(new Error(`Too many redirects or no location header. Status: ${res.statusCode}`));
              return;
            }
          }

          let data = "";
          res.on("data", chunk => data += chunk);
          res.on("end", () => {
            console.log(`Response length: ${data.length} characters, Status: ${res.statusCode}`);
            resolve(data);
          });
        });

        req.on("error", reject);
        req.setTimeout(15000, () => {
          req.destroy();
          reject(new Error("Request timeout"));
        });
        req.end();
      });
    };

    // Try different variations of the URL
    const urls = [
      albumUrl,
      albumUrl.replace('/u/0/', '/u/1/'),  // Try different user account
      albumUrl.replace('/u/0/', '/'),      // Try without user specification
      albumUrl + '&hl=en',
      albumUrl + '&hl=en&gl=US',
    ];

    let allHtml = "";

    for (const fetchUrl of urls) {
      try {
        console.log(`Trying URL: ${fetchUrl}`);
        const html = await fetchWithRedirects(fetchUrl);
        allHtml += html;
        if (html.length > 1000) { // If we got substantial content, break
          console.log("Got substantial content, using this response");
          break;
        }
      } catch (error) {
        console.log(`Failed to fetch ${fetchUrl}: ${error.message}`);
      }
    }

    if (allHtml.length < 1000) {
      console.log("Warning: Very little HTML content received");
      // Try a simpler approach - just the base URL without parameters
      try {
        const baseUrl = albumUrl.split('?')[0];
        console.log(`Trying simplified URL: ${baseUrl}`);
        const html = await fetchWithRedirects(baseUrl);
        allHtml = html;
        console.log(`Simplified URL response length: ${allHtml.length} characters`);
      } catch (error) {
        console.log(`Simplified URL also failed: ${error.message}`);
      }
    }

    // Enhanced extraction patterns that work better with modern Google Photos
    const patterns = [
      // Original patterns for /pw/ URLs
      /"(https:\/\/lh[0-9]\.googleusercontent\.com\/pw\/[^"]+)"/g,
      /'(https:\/\/lh[0-9]\.googleusercontent\.com\/pw\/[^']+)'/g,
      /https:\/\/lh[0-9]\.googleusercontent\.com\/pw\/[^\s"',)}\]]+/g,

      // Additional patterns for modern Google Photos (without /pw/)
      /"(https:\/\/lh[0-9]\.googleusercontent\.com\/[^"]+)"/g,
      /'(https:\/\/lh[0-9]\.googleusercontent\.com\/[^']+)'/g,
      /https:\/\/lh[0-9]\.googleusercontent\.com\/[^\s"',)}\]]+/g,

      // JSON array patterns
      /\["(https:\/\/lh[0-9]\.googleusercontent\.com\/[^"]+)"\]/g,
      /"url":\s*"(https:\/\/lh[0-9]\.googleusercontent\.com\/[^"]+)"/g,
      /"src":\s*"(https:\/\/lh[0-9]\.googleusercontent\.com\/[^"]+)"/g,
    ];

    let allMatches = [];
    patterns.forEach((pattern, index) => {
      const matches = allHtml.match(pattern) || [];
      console.log(`Pattern ${index + 1} found ${matches.length} matches`);
      allMatches.push(...matches);
    });

    // Clean and deduplicate URLs
    const cleanUrls = [...new Set(allMatches
      .map(match => {
        let url = match.replace(/['"\\]/g, '');
        // Extract just the URL part if it's in a larger string
        const urlMatch = url.match(/(https:\/\/lh[0-9]\.googleusercontent\.com\/[^\s"',)}\]]+)/);
        if (urlMatch) {
          url = urlMatch[1];
        }
        return url;
      })
      .filter(url => {
        // More strict URL validation
        const isValid = url.includes('googleusercontent.com') &&
          url.startsWith('https://lh') &&
          url.length > 50 && // Minimum realistic length
          url.length < 500 && // Maximum realistic length
          !url.includes('=s32-') &&
          !url.includes('=s64-') &&
          !url.includes('=s96-') &&
          !url.includes('undefined') &&
          !url.includes('null') &&
          !url.includes('%%') && // No double % characters
          !url.includes('/a/ACg8oc') && // Filter out profile pictures (avatar URLs)
          !url.includes('=s32-p-no') && // Filter out small profile pics
          url.includes('/pw/'); // Only allow actual photo URLs with /pw/ path

        if (!isValid) {
          console.log(`Filtering out invalid/non-photo URL: ${url.substring(0, 100)}...`);
        }
        return isValid;
      })
      .map(url => {
        // Remove ALL size restrictions to get full resolution
        // Remove =w###-h###... patterns
        url = url.replace(/=w[0-9]+-h[0-9]+.*$/, "=w0-h0");
        // Remove =s### patterns
        url = url.replace(/=s[0-9]+.*$/, "=s0");
        // Remove =d patterns (another size format)
        url = url.replace(/=d[0-9]*$/, "=d");
        // Remove any remaining size parameters after =
        url = url.replace(/=[whs][0-9]+[^=]*$/g, "");

        // Ensure we end with full resolution parameter
        if (!url.includes("=w0-h0") && !url.includes("=s0") && !url.includes("=d")) {
          url += "=w0-h0";
        }

        console.log(`Full resolution URL: ${url.substring(0, 120)}...`);
        return url;
      })
    )];

    console.log(`Album ${albumId}: extracted ${cleanUrls.length} photos`);
    return cleanUrls;

  } catch (error) {
    console.error(`Error extracting from album ${albumId}:`, error.message);
    return [];
  }
};

const loadGooglePhotos = async () => {
  console.log(`loadGooglePhotos called, googleAlbumIds: "${SLIDESHOW.config.googleAlbumIds}"`);
  if (!SLIDESHOW.config.googleAlbumIds) {
    console.log("No googleAlbumIds configured, skipping Google Photos");
    return;
  }

  // Parse multiple album IDs (comma-separated)
  const albumIds = SLIDESHOW.config.googleAlbumIds
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);

  if (albumIds.length === 0) {
    console.log("No valid album IDs found");
    return;
  }

  console.log(`Loading photos from ${albumIds.length} Google Photos album(s)...`);
  console.log(`Album IDs detected: ${JSON.stringify(albumIds)}`);

  try {
    // Check if album configuration has changed
    const currentAlbumConfig = albumIds.join(',');
    const albumConfigChanged = SLIDESHOW.lastAlbumConfig !== currentAlbumConfig;

    // Check if we need to refresh the albums (every hour, first time, or album config changed)
    const now = new Date();
    if (SLIDESHOW.lastAlbumFetch &&
        (now - SLIDESHOW.lastAlbumFetch) < 3600000 &&
        SLIDESHOW.googlePhotoUrls.length > 0 &&
        !albumConfigChanged) {
      console.log(`Using cached Google Photos URLs (${SLIDESHOW.googlePhotoUrls.length} photos available)`);
      return;
    }

    if (albumConfigChanged) {
      console.log(`Album configuration changed, clearing cache...`);
      SLIDESHOW.googlePhotoUrls = [];
      SLIDESHOW.photoCache.clear();
    }

    // Extract photos from all albums
    const allPhotoUrls = [];

    for (const albumId of albumIds) {
      const albumPhotos = await extractPhotosFromAlbum(albumId);
      allPhotoUrls.push(...albumPhotos);
    }

    console.log(`Total photos extracted from all albums: ${allPhotoUrls.length}`);

    // Remove duplicates across all albums
    SLIDESHOW.googlePhotoUrls = [...new Set(allPhotoUrls)];

    console.log(`Unique photos after deduplication: ${SLIDESHOW.googlePhotoUrls.length}`);

    // Randomize the combined photo pool for variety across albums
    if (SLIDESHOW.config.randomOrder && SLIDESHOW.googlePhotoUrls.length > 1) {
      for (let i = SLIDESHOW.googlePhotoUrls.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [SLIDESHOW.googlePhotoUrls[i], SLIDESHOW.googlePhotoUrls[j]] = [SLIDESHOW.googlePhotoUrls[j], SLIDESHOW.googlePhotoUrls[i]];
      }
      console.log("Randomized photos across all albums");
    }

    SLIDESHOW.lastAlbumFetch = now;
    SLIDESHOW.lastAlbumConfig = currentAlbumConfig;
    SLIDESHOW.googlePhotoIndex = 0;

    // For compatibility, create a minimal photos array for local photos fallback
    SLIDESHOW.photos = [];

    console.log(`Successfully loaded ${SLIDESHOW.googlePhotoUrls.length} photos from ${albumIds.length} album(s)`);

  } catch (error) {
    console.error("Failed to load Google Photos:", error.message);
    SLIDESHOW.googlePhotoUrls = [];
  }
};

const loadLocalPhotos = async () => {
  if (!fs.existsSync(SLIDESHOW.config.photosDir)) {
    console.warn(`Photos directory does not exist: ${SLIDESHOW.config.photosDir}`);
    return;
  }

  try {
    const extensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];
    const files = fs.readdirSync(SLIDESHOW.config.photosDir);

    const photoFiles = files
      .filter(file => extensions.some(ext => file.toLowerCase().endsWith(ext)))
      .slice(0, SLIDESHOW.config.maxCachedPhotos);

    // Create photo objects and extract metadata if enabled
    const localPhotos = [];
    for (let index = 0; index < photoFiles.length; index++) {
      const file = photoFiles[index];
      const filePath = path.join(SLIDESHOW.config.photosDir, file);

      const photo = {
        id: `local_${index}`,
        path: filePath,
        type: "local",
        title: path.basename(file, path.extname(file)),
      };

      // Extract metadata if enabled
      if (SLIDESHOW.config.showMetadata) {
        try {
          photo.metadata = await extractPhotoMetadata(filePath);
        } catch (error) {
          console.warn(`Failed to extract metadata for ${file}: ${error.message}`);
        }
      }

      localPhotos.push(photo);
    }

    SLIDESHOW.photos = localPhotos;

    console.log(`Loaded ${SLIDESHOW.photos.length} local photos`);
  } catch (error) {
    console.error("Failed to load local photos:", error.message);
    SLIDESHOW.photos = [];
  }
};

const initDiskCache = async () => {
  try {
    const homedir = require("os").homedir();
    SLIDESHOW.cacheDirectory = path.join(homedir, "TouchKio-Photo-Screensaver", "cache", "google-photos");

    if (!fs.existsSync(SLIDESHOW.cacheDirectory)) {
      fs.mkdirSync(SLIDESHOW.cacheDirectory, { recursive: true });
      console.log(`Created cache directory: ${SLIDESHOW.cacheDirectory}`);
    }

    await loadDiskCacheIndex();
    await cleanupDiskCache();

    console.log(`Disk cache initialized: ${SLIDESHOW.diskCache.size} cached photos`);
  } catch (error) {
    console.error("Failed to initialize disk cache:", error.message);
    SLIDESHOW.config.diskCacheEnabled = false;
  }
};

const loadDiskCacheIndex = async () => {
  if (!SLIDESHOW.config.diskCacheEnabled || !SLIDESHOW.cacheDirectory) {
    return;
  }

  try {
    const files = fs.readdirSync(SLIDESHOW.cacheDirectory);
    const extensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];

    for (const file of files) {
      if (extensions.some(ext => file.toLowerCase().endsWith(ext))) {
        const filePath = path.join(SLIDESHOW.cacheDirectory, file);
        const stats = fs.statSync(filePath);

        // Extract original URL from filename (base64 encoded)
        const urlHash = path.basename(file, path.extname(file));

        SLIDESHOW.diskCache.set(urlHash, {
          filePath,
          size: stats.size,
          lastAccessed: stats.atime,
          created: stats.birthtime
        });
      }
    }
  } catch (error) {
    console.error("Failed to load disk cache index:", error.message);
  }
};

const generateUrlHash = (url) => {
  return crypto.createHash('md5').update(url).digest('hex');
};

const extractPhotoMetadata = async (photoPath, photoBuffer = null) => {
  try {
    let metadata = {};
    let exifData = null;

    // Extract EXIF data from file path or buffer
    if (photoBuffer) {
      exifData = await exifr.parse(photoBuffer, {
        pick: ['DateTimeOriginal', 'DateTime', 'CreateDate', 'Make', 'Model', 'LensModel',
               'FNumber', 'ExposureTime', 'ISO', 'FocalLength', 'latitude', 'longitude',
               'ImageWidth', 'ImageHeight', 'Orientation'],
        skipTags: ['thumbnail', 'preview'] // Skip large embedded images for performance
      });
    } else if (photoPath && fs.existsSync(photoPath)) {
      exifData = await exifr.parse(photoPath, {
        pick: ['DateTimeOriginal', 'DateTime', 'CreateDate', 'Make', 'Model', 'LensModel',
               'FNumber', 'ExposureTime', 'ISO', 'FocalLength', 'latitude', 'longitude',
               'ImageWidth', 'ImageHeight', 'Orientation'],
        skipTags: ['thumbnail', 'preview'] // Skip large embedded images for performance
      });
    }

    // Extract filename
    if (photoPath) {
      metadata.filename = path.basename(photoPath, path.extname(photoPath));
    }

    // Extract date taken (try multiple date fields)
    if (exifData) {
      const dateTaken = exifData.DateTimeOriginal || exifData.DateTime || exifData.CreateDate;
      if (dateTaken) {
        metadata.dateTaken = new Date(dateTaken);
        metadata.dateFormatted = metadata.dateTaken.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }

      // Extract camera information
      if (exifData.Make || exifData.Model) {
        const make = exifData.Make || '';
        const model = exifData.Model || '';
        // Avoid duplication (e.g., "Canon Canon EOS R5" -> "Canon EOS R5")
        if (model.toLowerCase().includes(make.toLowerCase())) {
          metadata.camera = model;
        } else {
          metadata.camera = `${make} ${model}`.trim();
        }
      }

      // Extract lens information
      if (exifData.LensModel) {
        metadata.lens = exifData.LensModel;
      }

      // Extract exposure settings
      const exposureSettings = [];
      if (exifData.FNumber) {
        exposureSettings.push(`f/${exifData.FNumber}`);
      }
      if (exifData.ExposureTime) {
        if (exifData.ExposureTime >= 1) {
          exposureSettings.push(`${exifData.ExposureTime}s`);
        } else {
          exposureSettings.push(`1/${Math.round(1/exifData.ExposureTime)}s`);
        }
      }
      if (exifData.ISO) {
        exposureSettings.push(`ISO ${exifData.ISO}`);
      }
      if (exifData.FocalLength) {
        exposureSettings.push(`${exifData.FocalLength}mm`);
      }
      if (exposureSettings.length > 0) {
        metadata.exposure = exposureSettings.join(' • ');
      }

      // Extract GPS coordinates
      if (exifData.latitude && exifData.longitude) {
        metadata.location = {
          latitude: exifData.latitude,
          longitude: exifData.longitude,
          formatted: `${exifData.latitude.toFixed(6)}, ${exifData.longitude.toFixed(6)}`
        };
      }

      // Extract image dimensions
      if (exifData.ImageWidth && exifData.ImageHeight) {
        metadata.dimensions = `${exifData.ImageWidth} × ${exifData.ImageHeight}`;
      }
    }

    // Get file size if we have a path
    if (photoPath && fs.existsSync(photoPath)) {
      const stats = fs.statSync(photoPath);
      const fileSizeKB = Math.round(stats.size / 1024);
      if (fileSizeKB < 1024) {
        metadata.fileSize = `${fileSizeKB} KB`;
      } else {
        metadata.fileSize = `${(fileSizeKB / 1024).toFixed(1)} MB`;
      }
    }

    return metadata;

  } catch (error) {
    console.warn(`Failed to extract metadata: ${error.message}`);
    return {
      filename: photoPath ? path.basename(photoPath, path.extname(photoPath)) : 'Unknown'
    };
  }
};

const cleanupDiskCache = async () => {
  if (!SLIDESHOW.config.diskCacheEnabled || !SLIDESHOW.cacheDirectory) {
    return;
  }

  try {
    let totalSize = 0;
    const cacheEntries = Array.from(SLIDESHOW.diskCache.entries()).map(([hash, data]) => ({
      hash,
      ...data
    }));

    for (const entry of cacheEntries) {
      totalSize += entry.size;
    }

    const maxSize = SLIDESHOW.config.diskCacheMaxSize;
    const cleanupTrigger = maxSize * SLIDESHOW.config.diskCacheCleanupTrigger;

    if (totalSize > cleanupTrigger) {
      console.log(`Cache cleanup triggered: ${(totalSize / 1024 / 1024).toFixed(1)}MB > ${(cleanupTrigger / 1024 / 1024).toFixed(1)}MB`);

      // Sort by last accessed time (LRU eviction)
      cacheEntries.sort((a, b) => a.lastAccessed - b.lastAccessed);

      let cleanedSize = 0;
      const targetSize = maxSize * 0.7; // Clean down to 70% of max

      for (const entry of cacheEntries) {
        if (totalSize - cleanedSize <= targetSize) {
          break;
        }

        try {
          fs.unlinkSync(entry.filePath);
          SLIDESHOW.diskCache.delete(entry.hash);
          cleanedSize += entry.size;
          console.log(`Cleaned cached file: ${path.basename(entry.filePath)}`);
        } catch (unlinkError) {
          console.warn(`Failed to clean cache file: ${unlinkError.message}`);
        }
      }

      console.log(`Cache cleanup completed: cleaned ${(cleanedSize / 1024 / 1024).toFixed(1)}MB`);
    }
  } catch (error) {
    console.error("Failed to cleanup disk cache:", error.message);
  }
};

const checkNetworkStatus = async () => {
  try {
    const start = Date.now();
    const testUrl = 'https://www.google.com';

    const response = await axios.get(testUrl, {
      timeout: 3000,
      headers: { 'User-Agent': 'TouchKio-Slideshow/1.0' }
    });

    const duration = Date.now() - start;
    SLIDESHOW.networkStatus.connected = response.status === 200;
    SLIDESHOW.networkStatus.quality = duration < 1000 ? 'good' : duration < 3000 ? 'fair' : 'poor';
    SLIDESHOW.networkStatus.lastCheck = new Date();
    SLIDESHOW.networkStatus.failureCount = 0;

    return true;
  } catch (error) {
    SLIDESHOW.networkStatus.connected = false;
    SLIDESHOW.networkStatus.quality = 'offline';
    SLIDESHOW.networkStatus.lastCheck = new Date();
    SLIDESHOW.networkStatus.failureCount++;

    console.warn(`Network check failed: ${error.message}`);
    return false;
  }
};

const servePhoto = async (photo, res) => {
  if (photo.type === "local") {
    if (fs.existsSync(photo.path)) {
      const ext = path.extname(photo.path).toLowerCase();
      const mimeType = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
        ".webp": "image/webp",
      }[ext] || "image/jpeg";

      res.writeHead(200, { "Content-Type": mimeType });
      fs.createReadStream(photo.path).pipe(res);
    } else {
      res.writeHead(404);
      res.end("Photo not found");
    }
  } else {
    res.writeHead(400);
    res.end("Invalid photo type");
  }
};

const serveGooglePhoto = async (photoUrl, res) => {
  try {
    // Validate URL format
    if (!photoUrl || typeof photoUrl !== 'string') {
      throw new Error(`Invalid URL: ${photoUrl} (type: ${typeof photoUrl})`);
    }

    // The URL might be prefixed with the endpoint path, extract just the photo URL
    let cleanUrl = photoUrl;
    if (photoUrl.startsWith('/google-photo/')) {
      cleanUrl = decodeURIComponent(photoUrl.substring(14));
    }

    if (!cleanUrl.startsWith('https://lh') || !cleanUrl.includes('googleusercontent.com')) {
      throw new Error(`Invalid Google Photos URL format: ${cleanUrl.substring(0, 100)}...`);
    }

    // Check if photo exists in disk cache first
    const urlHash = generateUrlHash(cleanUrl);
    if (SLIDESHOW.config.diskCacheEnabled && SLIDESHOW.diskCache.has(urlHash)) {
      const diskEntry = SLIDESHOW.diskCache.get(urlHash);

      if (fs.existsSync(diskEntry.filePath)) {
        console.log(`Serving cached Google Photo: ${path.basename(diskEntry.filePath)}`);

        // Update last accessed time
        diskEntry.lastAccessed = new Date();

        const ext = path.extname(diskEntry.filePath).toLowerCase();
        const mimeType = {
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".gif": "image/gif",
          ".webp": "image/webp",
        }[ext] || "image/jpeg";

        res.writeHead(200, {
          "Content-Type": mimeType,
          "Cache-Control": "public, max-age=86400", // Cache longer for disk-cached photos
        });

        fs.createReadStream(diskEntry.filePath).pipe(res);
        return;
      } else {
        // File missing from disk, remove from cache index
        SLIDESHOW.diskCache.delete(urlHash);
        console.warn(`Cached file missing, removed from index: ${diskEntry.filePath}`);
      }
    }

    // Fallback to downloading directly
    console.log(`Serving Google Photo from network: ${cleanUrl.substring(0, 80)}...`);

    const response = await axios.get(cleanUrl, {
      responseType: "stream",
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
      }
    });

    res.writeHead(200, {
      "Content-Type": response.headers["content-type"] || "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    });

    response.data.pipe(res);

    // Opportunistically cache this photo for future use
    if (SLIDESHOW.config.diskCacheEnabled) {
      downloadPhotoToCache(cleanUrl).catch(err =>
        console.warn(`Background caching failed: ${err.message}`)
      );
    }

  } catch (error) {
    console.error(`Failed to serve Google Photo: ${error.message}`);

    // Try fallback to local photos if enabled and available
    if (SLIDESHOW.config.fallbackEnabled && SLIDESHOW.photos.length > 0) {
      console.log("Attempting fallback to local photos");
      try {
        const localPhoto = getNextLocalPhoto();
        if (localPhoto) {
          await servePhoto(localPhoto, res);
          return;
        }
      } catch (fallbackError) {
        console.error(`Fallback also failed: ${fallbackError.message}`);
      }
    }

    console.error(`Photo URL: ${photoUrl}`);
    res.writeHead(500);
    res.end("Failed to load photo");
  }
};

const shufflePhotos = () => {
  for (let i = SLIDESHOW.photos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [SLIDESHOW.photos[i], SLIDESHOW.photos[j]] = [SLIDESHOW.photos[j], SLIDESHOW.photos[i]];
  }
};

const getNextGooglePhoto = async () => {
  if (SLIDESHOW.googlePhotoUrls.length === 0) {
    // Try fallback to local photos if enabled
    if (SLIDESHOW.config.fallbackEnabled && SLIDESHOW.photos.length > 0) {
      console.log("Google Photos unavailable, falling back to local photos");
      return getNextLocalPhoto();
    }
    return null;
  }

  // Get next photo URL
  const photoUrl = SLIDESHOW.googlePhotoUrls[SLIDESHOW.googlePhotoIndex];
  const photoId = `google_${SLIDESHOW.googlePhotoIndex}`;

  // Check if this photo is already cached in memory
  if (SLIDESHOW.photoCache.has(photoId)) {
    console.log(`Using cached photo ${SLIDESHOW.googlePhotoIndex + 1}/${SLIDESHOW.googlePhotoUrls.length}`);
    const cachedPhoto = SLIDESHOW.photoCache.get(photoId);

    // Move to next photo for next time
    SLIDESHOW.googlePhotoIndex = (SLIDESHOW.googlePhotoIndex + 1) % SLIDESHOW.googlePhotoUrls.length;

    return cachedPhoto;
  }

  // Check if photo exists in disk cache
  const urlHash = generateUrlHash(photoUrl);
  if (SLIDESHOW.config.diskCacheEnabled && SLIDESHOW.diskCache.has(urlHash)) {
    console.log(`Using disk cached photo ${SLIDESHOW.googlePhotoIndex + 1}/${SLIDESHOW.googlePhotoUrls.length}`);

    const diskEntry = SLIDESHOW.diskCache.get(urlHash);
    // Update last accessed time
    diskEntry.lastAccessed = new Date();

    const photo = {
      id: photoId,
      url: photoUrl,
      type: "google",
      title: `Google Photo ${SLIDESHOW.googlePhotoIndex + 1}`,
      index: SLIDESHOW.googlePhotoIndex,
      cached: true,
      cachePath: diskEntry.filePath
    };

    // Extract metadata from cached file
    if (SLIDESHOW.config.showMetadata) {
      try {
        photo.metadata = await extractPhotoMetadata(diskEntry.filePath);
      } catch (error) {
        console.warn(`Failed to extract metadata for cached photo: ${error.message}`);
      }
    }

    // Add to memory cache for faster access next time
    addToMemoryCache(photoId, photo);

    // Move to next photo for next time
    SLIDESHOW.googlePhotoIndex = (SLIDESHOW.googlePhotoIndex + 1) % SLIDESHOW.googlePhotoUrls.length;

    return photo;
  }

  // Create new photo object for on-demand loading
  const photo = {
    id: photoId,
    url: photoUrl,
    type: "google",
    title: `Google Photo ${SLIDESHOW.googlePhotoIndex + 1}`,
    index: SLIDESHOW.googlePhotoIndex,
    cached: false,
    // Add basic metadata for Google Photos so metadata display works
    metadata: {
      filename: `Google Photo ${SLIDESHOW.googlePhotoIndex + 1}`,
      dateFormatted: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }
  };

  // Add to memory cache
  addToMemoryCache(photoId, photo);

  console.log(`Loading photo ${SLIDESHOW.googlePhotoIndex + 1}/${SLIDESHOW.googlePhotoUrls.length} on-demand`);

  // Trigger preloading for upcoming photos
  queuePreload(SLIDESHOW.googlePhotoIndex + 1);

  // Move to next photo for next time
  SLIDESHOW.googlePhotoIndex = (SLIDESHOW.googlePhotoIndex + 1) % SLIDESHOW.googlePhotoUrls.length;

  return photo;
};

const getNextLocalPhoto = () => {
  if (SLIDESHOW.photos.length === 0) {
    return null;
  }

  const photo = SLIDESHOW.photos[SLIDESHOW.currentIndex];
  SLIDESHOW.currentIndex = (SLIDESHOW.currentIndex + 1) % SLIDESHOW.photos.length;

  return photo;
};

const addToMemoryCache = (photoId, photo) => {
  // Manage memory cache size based on config
  const maxSize = SLIDESHOW.config.preloadBufferSize;

  if (SLIDESHOW.photoCache.size >= maxSize) {
    // Remove oldest entries (LRU)
    const keysToRemove = Array.from(SLIDESHOW.photoCache.keys()).slice(0, SLIDESHOW.photoCache.size - maxSize + 1);
    keysToRemove.forEach(key => SLIDESHOW.photoCache.delete(key));
  }

  SLIDESHOW.photoCache.set(photoId, photo);
};

const queuePreload = (startIndex) => {
  if (!SLIDESHOW.config.diskCacheEnabled || SLIDESHOW.googlePhotoUrls.length === 0) {
    return;
  }

  const bufferSize = SLIDESHOW.config.preloadBufferSize;
  const totalPhotos = SLIDESHOW.googlePhotoUrls.length;

  // Queue next few photos for preloading
  for (let i = 0; i < Math.min(bufferSize / 2, 10); i++) {
    const index = (startIndex + i) % totalPhotos;
    const url = SLIDESHOW.googlePhotoUrls[index];
    const urlHash = generateUrlHash(url);

    // Only queue if not already cached
    if (!SLIDESHOW.diskCache.has(urlHash) && !SLIDESHOW.preloadQueue.includes(url)) {
      SLIDESHOW.preloadQueue.push(url);
    }
  }

  // Start processing queue if not already active
  if (!SLIDESHOW.preloadActive) {
    processPreloadQueue();
  }
};

const processPreloadQueue = async () => {
  if (SLIDESHOW.preloadActive || SLIDESHOW.preloadQueue.length === 0) {
    return;
  }

  SLIDESHOW.preloadActive = true;
  const concurrentLimit = SLIDESHOW.config.concurrentDownloads;

  console.log(`Starting preload of ${SLIDESHOW.preloadQueue.length} photos with ${concurrentLimit} concurrent downloads`);

  try {
    // Process queue in batches
    while (SLIDESHOW.preloadQueue.length > 0) {
      const batch = SLIDESHOW.preloadQueue.splice(0, concurrentLimit);
      const downloadPromises = batch.map(url => downloadPhotoToCache(url));

      await Promise.allSettled(downloadPromises);

      // Check network status between batches
      if (!(await checkNetworkStatus())) {
        console.log("Network issues detected, pausing preload");
        break;
      }

      // Small delay between batches to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (error) {
    console.error("Error during preload processing:", error.message);
  } finally {
    SLIDESHOW.preloadActive = false;
    console.log(`Preload batch completed. ${SLIDESHOW.preloadQueue.length} photos remaining in queue`);

    // Continue processing if there are more photos and network is good
    if (SLIDESHOW.preloadQueue.length > 0 && SLIDESHOW.networkStatus.connected) {
      setTimeout(() => processPreloadQueue(), 1000);
    }
  }
};

const downloadPhotoToCache = async (photoUrl) => {
  if (!SLIDESHOW.config.diskCacheEnabled || !photoUrl) {
    return false;
  }

  const urlHash = generateUrlHash(photoUrl);

  // Check if already cached
  if (SLIDESHOW.diskCache.has(urlHash)) {
    return true;
  }

  try {
    console.log(`Downloading photo to cache: ${photoUrl.substring(0, 80)}...`);

    const response = await axios.get(photoUrl, {
      responseType: "stream",
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
      }
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    const extension = contentType.includes('png') ? '.png' :
                     contentType.includes('gif') ? '.gif' :
                     contentType.includes('webp') ? '.webp' : '.jpg';

    const fileName = `${urlHash}${extension}`;
    const filePath = path.join(SLIDESHOW.cacheDirectory, fileName);

    // Write file to disk
    const writeStream = fs.createWriteStream(filePath);
    response.data.pipe(writeStream);

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Get file stats and add to cache index
    const stats = fs.statSync(filePath);
    SLIDESHOW.diskCache.set(urlHash, {
      filePath,
      size: stats.size,
      lastAccessed: new Date(),
      created: new Date()
    });

    console.log(`Successfully cached photo: ${fileName} (${(stats.size / 1024).toFixed(1)}KB)`);

    // Trigger cleanup if needed
    setTimeout(() => cleanupDiskCache(), 1000);

    return true;

  } catch (error) {
    console.error(`Failed to download photo to cache: ${error.message}`);
    SLIDESHOW.networkStatus.failureCount++;

    // If too many failures, pause preloading temporarily
    if (SLIDESHOW.networkStatus.failureCount > 5) {
      SLIDESHOW.preloadQueue.length = 0; // Clear queue
      console.log("Too many download failures, clearing preload queue");
    }

    return false;
  }
};

const startPreloadManager = () => {
  // Initial network check
  checkNetworkStatus();

  // Periodic network monitoring
  setInterval(async () => {
    await checkNetworkStatus();

    // Resume preloading if network recovered and queue has items
    if (SLIDESHOW.networkStatus.connected &&
        SLIDESHOW.preloadQueue.length > 0 &&
        !SLIDESHOW.preloadActive) {
      processPreloadQueue();
    }
  }, 30000); // Check every 30 seconds

  console.log("Preload manager started");
};

const setupIdleDetection = () => {
  EVENTS.on("userActivity", () => {
    SLIDESHOW.lastActivity = new Date();

    if (SLIDESHOW.active) {
      hideSlideshowOverlay(); // Pause slideshow instead of stopping it completely
    }

    resetIdleTimer();
  });

  resetIdleTimer();
};

const resetIdleTimer = () => {
  if (SLIDESHOW.idleTimer) {
    global.timerController.clearTimer(SLIDESHOW.idleTimer);
  }

  SLIDESHOW.idleTimer = global.timerController.scheduleTimeout(() => {
    // Check if photos are available (Google Photos OR local photos)
    const hasPhotos = SLIDESHOW.googlePhotoUrls.length > 0 || SLIDESHOW.photos.length > 0;

    if (!hasPhotos) {
      return;
    }

    if (SLIDESHOW.active && !SLIDESHOW.timer) {
      // Slideshow is active but paused - resume it
      console.log("Idle timeout reached, resuming paused slideshow");
      showSlideshowOverlay();
    } else if (!SLIDESHOW.active) {
      // Slideshow is not active - start it fresh
      console.log("Idle timeout reached, starting slideshow");
      showSlideshow();
    }
  }, SLIDESHOW.config.idleTimeout, 'idle_timer');
};

// Helper function to calculate animation duration from speed setting
const getAnimationDuration = () => {
  const animationSpeed = parseFloat(ARGS.slideshow_animation_speed) || 1.0;
  const animationEnabled = ARGS.slideshow_animation_enabled !== "false";

  if (!animationEnabled) {
    return 0; // No animation
  }

  // Base duration of 400ms, inversely proportional to speed
  // Speed 1.0 = 400ms, Speed 2.0 = 200ms, Speed 0.5 = 800ms
  return Math.round(400 / animationSpeed);
};

// Helper functions to pause/resume slideshow timer
const pauseSlideshowTimer = () => {
  if (SLIDESHOW.timer) {
    console.log("Pausing slideshow timer");
    global.timerController.clearTimer(SLIDESHOW.timer);
    SLIDESHOW.timer = null;
  }
};

const resumeSlideshowTimer = () => {
  if (SLIDESHOW.active && !SLIDESHOW.timer) {
    console.log("Resuming slideshow timer");
    startSlideshowTimer();
  }
};

const showSlideshow = async () => {
  // Check if photos are available (Google Photos or local)
  const hasPhotos = SLIDESHOW.googlePhotoUrls.length > 0 || SLIDESHOW.photos.length > 0;

  if (SLIDESHOW.active || !SLIDESHOW.initialized || !hasPhotos) {
    if (!hasPhotos) {
      console.warn("No photos available for slideshow (Google Photos or local)");
    }
    return;
  }

  console.log("Starting slideshow");
  SLIDESHOW.active = true;
  publishSlideshowState();
  SLIDESHOW.currentIndex = 0;

  // Start activity grace period immediately to prevent false activity detection
  if (SLIDESHOW.startActivityGracePeriod) {
    SLIDESHOW.startActivityGracePeriod();
  }

  // Remove and re-add to ensure it's on top of all other views
  try {
    WEBVIEW.window.contentView.removeChildView(SLIDESHOW.view);
  } catch (e) {
    // View might not be added yet
  }
  WEBVIEW.window.contentView.addChildView(SLIDESHOW.view);

  const windowBounds = WEBVIEW.window.getBounds();

  SLIDESHOW.view.setBounds({
    x: 0,
    y: 0,
    width: windowBounds.width,
    height: windowBounds.height,
  });

  // Smart photo counting: use Google Photos if available, otherwise local photos
  let photosToCount;
  if (SLIDESHOW.googlePhotoUrls.length > 0) {
    // Google Photos are available - count those
    photosToCount = SLIDESHOW.googlePhotoUrls.map((url, index) => ({
      id: `google_${index}`,
      url: `/google-photo/${encodeURIComponent(url)}`,
      type: "google",
      title: `Google Photo ${index + 1}`
    }));
  } else {
    // No Google Photos - count local photos
    photosToCount = SLIDESHOW.photos.map((photo, index) => ({
      ...photo,
      id: `local_${index}`,
      url: `/photo/${index}`
    }));
  }

  global.ipcBatcher.queue("slideshow-config", {
    config: SLIDESHOW.config,
    photos: photosToCount,
    googlePhotoCount: SLIDESHOW.googlePhotoUrls.length,
  });

  const sourceType = SLIDESHOW.googlePhotoUrls.length > 0 ? "Google Photos" : "local photos";
  console.log(`Started slideshow with ${photosToCount.length} ${sourceType} for counter`);

  // Get and show first photo BEFORE triggering entrance animation
  let firstPhoto = null;

  if (SLIDESHOW.googlePhotoUrls.length > 0) {
    firstPhoto = await getNextGooglePhoto();
  } else if (SLIDESHOW.photos.length > 0) {
    firstPhoto = SLIDESHOW.photos[SLIDESHOW.currentIndex];
  }

  if (firstPhoto) {
    SLIDESHOW.view.webContents.send("show-photo", {
      index: firstPhoto.index || SLIDESHOW.currentIndex,
      photo: firstPhoto,
    });
  }

  SLIDESHOW.view.setVisible(true);

  // Trigger entrance animation with configured duration AFTER first photo is ready
  const animationDuration = getAnimationDuration();
  if (animationDuration > 0) {
    console.log(`Triggering slideshow entrance animation (${animationDuration}ms)`);
    SLIDESHOW.view.webContents.send('apply-entrance-animation', animationDuration);
  }

  startSlideshowTimer();
  EVENTS.emit("slideshowStateChanged", true);
};

// Hide slideshow overlay (pause) without stopping slideshow completely
const hideSlideshowOverlay = () => {
  if (!SLIDESHOW.active) {
    return;
  }

  console.log("Hiding slideshow overlay (pausing)");

  // Pause the timer but keep slideshow active
  pauseSlideshowTimer();

  if (SLIDESHOW.view) {
    // Trigger exit animation with configured duration
    const animationDuration = getAnimationDuration();
    if (animationDuration > 0) {
      console.log(`Triggering slideshow exit animation (${animationDuration}ms)`);
      SLIDESHOW.view.webContents.send('apply-exit-animation', animationDuration);

      // Hide the view after animation completes
      setTimeout(() => {
        if (SLIDESHOW.view && SLIDESHOW.active && !SLIDESHOW.timer) { // Still active but paused
          SLIDESHOW.view.setVisible(false);
          try {
            WEBVIEW.window.contentView.removeChildView(SLIDESHOW.view);
          } catch (error) {
            console.warn("Failed to remove slideshow view:", error.message);
          }
        }
      }, animationDuration);
    } else {
      // No animation, hide immediately
      SLIDESHOW.view.setVisible(false);
      try {
        WEBVIEW.window.contentView.removeChildView(SLIDESHOW.view);
      } catch (error) {
        console.warn("Failed to remove slideshow view:", error.message);
      }
    }
  }

  resetIdleTimer();
};

// Show slideshow overlay (resume) for already active slideshow
const showSlideshowOverlay = () => {
  if (!SLIDESHOW.active) {
    return;
  }

  console.log("Showing slideshow overlay (resuming)");

  if (SLIDESHOW.view) {
    // Remove and re-add to ensure it's on top of all other views
    try {
      WEBVIEW.window.contentView.removeChildView(SLIDESHOW.view);
    } catch (e) {
      // View might not be added yet
    }
    WEBVIEW.window.contentView.addChildView(SLIDESHOW.view);

    SLIDESHOW.view.setVisible(true);

    // Trigger entrance animation with configured duration
    const animationDuration = getAnimationDuration();
    if (animationDuration > 0) {
      console.log(`Triggering slideshow entrance animation (${animationDuration}ms)`);
      SLIDESHOW.view.webContents.send('apply-entrance-animation', animationDuration);
    }

    const windowBounds = WEBVIEW.window.getBounds();
    SLIDESHOW.view.setBounds({
      x: 0,
      y: 0,
      width: windowBounds.width,
      height: windowBounds.height,
    });

    // Start activity grace period immediately to prevent false activity detection
    if (SLIDESHOW.startActivityGracePeriod) {
      SLIDESHOW.startActivityGracePeriod();
    }

    // Resume the slideshow timer
    resumeSlideshowTimer();
  }
};

const hideSlideshowSafely = () => {
  if (!SLIDESHOW.active) {
    return;
  }

  console.log("Stopping slideshow completely");
  SLIDESHOW.active = false;
  publishSlideshowState();

  if (SLIDESHOW.timer) {
    global.timerController.clearTimer(SLIDESHOW.timer);
    SLIDESHOW.timer = null;
  }

  if (SLIDESHOW.view) {
    // Trigger exit animation with configured duration
    const animationDuration = getAnimationDuration();
    if (animationDuration > 0) {
      console.log(`Triggering slideshow exit animation (${animationDuration}ms)`);
      SLIDESHOW.view.webContents.send('apply-exit-animation', animationDuration);

      // Hide the view after animation completes
      setTimeout(() => {
        if (SLIDESHOW.view && !SLIDESHOW.active) { // Double-check we're still supposed to hide
          SLIDESHOW.view.setVisible(false);
          try {
            WEBVIEW.window.contentView.removeChildView(SLIDESHOW.view);
          } catch (error) {
            console.warn("Failed to remove slideshow view:", error.message);
          }
        }
      }, animationDuration);
    } else {
      // No animation, hide immediately
      SLIDESHOW.view.setVisible(false);
      try {
        WEBVIEW.window.contentView.removeChildView(SLIDESHOW.view);
      } catch (error) {
        console.warn("Failed to remove slideshow view:", error.message);
      }
    }
  }

  resetIdleTimer();
  EVENTS.emit("slideshowStateChanged", false);
};

const startSlideshowTimer = () => {
  if (SLIDESHOW.timer) {
    global.timerController.clearTimer(SLIDESHOW.timer);
  }

  // Start preloading photos for the slideshow
  if (SLIDESHOW.googlePhotoUrls.length > 0) {
    console.log("Starting slideshow warmup preload");
    queuePreload(SLIDESHOW.googlePhotoIndex);
  }

  SLIDESHOW.timer = global.timerController.scheduleInterval(async () => {
    if (!SLIDESHOW.active) {
      return;
    }

    let photo = null;

    // Determine best photo source based on config and availability
    const preferredSource = SLIDESHOW.config.preferredSource;
    const hasGoogle = SLIDESHOW.googlePhotoUrls.length > 0;
    const hasLocal = SLIDESHOW.photos.length > 0;

    // Smart source selection
    if (preferredSource === 'google' && hasGoogle) {
      photo = await getNextGooglePhoto();
    } else if (preferredSource === 'local' && hasLocal) {
      photo = getNextLocalPhoto();
    } else if (preferredSource === 'auto') {
      // Auto mode: prefer Google Photos if network is good, otherwise local
      if (hasGoogle && SLIDESHOW.networkStatus.connected && SLIDESHOW.networkStatus.quality !== 'poor') {
        photo = await getNextGooglePhoto();
      } else if (hasLocal) {
        photo = getNextLocalPhoto();
      } else if (hasGoogle) {
        // Fallback to Google Photos even with poor network
        photo = await getNextGooglePhoto();
      }
    }

    // Final fallback: try any available source
    if (!photo) {
      if (hasGoogle) {
        photo = await getNextGooglePhoto();
      } else if (hasLocal) {
        photo = getNextLocalPhoto();
      }
    }

    // If still no photos available, warn and continue
    if (!photo) {
      console.warn("No photos available for slideshow");
      return;
    }

    SLIDESHOW.view.webContents.send("show-photo", {
      index: photo.index || SLIDESHOW.currentIndex,
      photo: photo,
    });
  }, SLIDESHOW.config.interval, 'main_slideshow_timer');
};

const updateConfig = (newConfig) => {
  Object.assign(SLIDESHOW.config, newConfig);

  if (SLIDESHOW.active) {
    if (SLIDESHOW.timer) {
      global.timerController.clearTimer(SLIDESHOW.timer);
      startSlideshowTimer();
    }
  }

  resetIdleTimer();

  // Send config update to view if it exists
  if (SLIDESHOW.view && SLIDESHOW.view.webContents) {
    global.ipcBatcher.queue("slideshow-config", {
      config: SLIDESHOW.config,
    });
  }
};

const reloadPhotos = async () => {
  console.log("Reloading photos...");
  await loadPhotos();

  // Check if we have any photos (Google Photos or local)
  const hasPhotos = SLIDESHOW.googlePhotoUrls.length > 0 || SLIDESHOW.photos.length > 0;

  if (SLIDESHOW.active && hasPhotos) {
    SLIDESHOW.currentIndex = 0;

    // Smart photo counting: use Google Photos if available, otherwise local photos
    let photosToCount;
    if (SLIDESHOW.googlePhotoUrls.length > 0) {
      // Google Photos are available - count those
      photosToCount = SLIDESHOW.googlePhotoUrls.map((url, index) => ({
        id: `google_${index}`,
        url: `/google-photo/${encodeURIComponent(url)}`,
        type: "google",
        title: `Google Photo ${index + 1}`
      }));
    } else {
      // No Google Photos - count local photos
      photosToCount = SLIDESHOW.photos.map((photo, index) => ({
        ...photo,
        id: `local_${index}`,
        url: `/photo/${index}`
      }));
    }

    global.ipcBatcher.queue("slideshow-config", {
      config: SLIDESHOW.config,
      photos: photosToCount,
    });

    const sourceType = SLIDESHOW.googlePhotoUrls.length > 0 ? "Google Photos" : "local photos";
    console.log(`Sent updated config with ${photosToCount.length} ${sourceType} for counter`);
  }
};

const getStatus = () => ({
  initialized: SLIDESHOW.initialized,
  active: SLIDESHOW.active,
  photoCount: SLIDESHOW.googlePhotoUrls.length > 0 ? SLIDESHOW.googlePhotoUrls.length : SLIDESHOW.photos.length,
  activePhotoSource: SLIDESHOW.googlePhotoUrls.length > 0 ? "google" : "local",
  googlePhotoCount: SLIDESHOW.googlePhotoUrls.length,
  localPhotoCount: SLIDESHOW.photos.length,
  currentIndex: SLIDESHOW.currentIndex,
  config: SLIDESHOW.config,
  lastActivity: SLIDESHOW.lastActivity,
});

const cleanup = () => {
  if (SLIDESHOW.timer) {
    global.timerController.clearTimer(SLIDESHOW.timer);
    SLIDESHOW.timer = null;
  }

  if (SLIDESHOW.idleTimer) {
    global.timerController.clearTimer(SLIDESHOW.idleTimer);
    SLIDESHOW.idleTimer = null;
  }

  if (SLIDESHOW.server) {
    SLIDESHOW.server.close();
    SLIDESHOW.server = null;
  }

  hideSlideshowSafely();
};

module.exports = {
  init,
  showSlideshow,
  hideSlideshow: hideSlideshowSafely,
  showSlideshowOverlay,
  hideSlideshowOverlay,
  updateConfig,
  reloadPhotos,
  getStatus,
  cleanup,
};