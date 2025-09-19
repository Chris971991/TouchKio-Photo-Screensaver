const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const axios = require("axios");
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

    // Photo settings
    randomOrder: true,
    photoFit: "contain", // "contain", "cover", "fill"

    // Transition settings
    transitionType: "fade",
    transitionDuration: 2000,

    // System settings
    port: 8081,
    maxCachedPhotos: 100,
  },
};

/**
 * Combines multiple Google album fields into a single string
 */
const getGoogleAlbumIds = () => {
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
    if (legacyAlbums) {
      return legacyAlbums;
    }
  }

  return albums.length > 0 ? albums.join(',') : null;
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
    idleTimeout: parseInt(ARGS.slideshow_idle_timeout) * 1000 || 180000,

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

    // Photo settings
    randomOrder: ARGS.slideshow_random_order !== "false",
    photoFit: ARGS.slideshow_photo_fit || "contain",

    // Transition settings
    transitionType: ARGS.slideshow_transition_type || "fade",
    transitionDuration: parseInt(ARGS.slideshow_transition_duration) || 2000,

    // System settings
    port: 8081,
    maxCachedPhotos: 100,
  };

  console.log("Slideshow Configuration:", JSON.stringify(SLIDESHOW.config, null, 2));

  try {
    await initHttpServer();
    await initSlideshowView();
    await loadPhotos();
    setupIdleDetection();

    SLIDESHOW.initialized = true;
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
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ photos: SLIDESHOW.photos }));
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
      },
    });

    SLIDESHOW.view.setBackgroundColor("#000000");
    SLIDESHOW.view.setVisible(false);

    const slideshowHtmlPath = path.join(APP.path, "html", "slideshow.html");
    await SLIDESHOW.view.webContents.loadFile(slideshowHtmlPath);

    // Listen for user activity events from the slideshow interface
    const { ipcMain } = require("electron");
    ipcMain.on("slideshow-user-activity", () => {
      // Only process activity if slideshow is actually visible
      if (SLIDESHOW.active) {
        console.log("User activity detected in slideshow");
        EVENTS.emit("userActivity");
      }
    });
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

  try {
    if (SLIDESHOW.config.googleAlbumIds) {
      console.log("Loading Google Photos...");
      await loadGooglePhotos();
    }

    if (SLIDESHOW.photos.length === 0) {
      console.log("Loading local photos...");
      await loadLocalPhotos();
    }

    if (SLIDESHOW.photos.length === 0) {
      console.warn("No photos found for slideshow");
    } else {
      console.log(`Loaded ${SLIDESHOW.photos.length} photos for slideshow`);
      if (SLIDESHOW.config.randomOrder) {
        shufflePhotos();
      }
    }
  } catch (error) {
    console.error("Error loading photos:", error.message);
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
      .filter(url =>
        url.includes('googleusercontent.com') &&
        url.length > 30 &&
        !url.includes('=s32-') &&
        !url.includes('=s64-') &&
        !url.includes('=s96-')
      )
      .map(url => {
        // Remove size restrictions to get full resolution
        url = url.replace(/=w[0-9]+-h[0-9]+-[a-z-]+.*$/, "=w0-h0");
        url = url.replace(/=s[0-9]+-[a-z-]+.*$/, "=s0");
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
  if (!SLIDESHOW.config.googleAlbumIds) return;

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

    SLIDESHOW.photos = photoFiles.map((file, index) => ({
      id: `local_${index}`,
      path: path.join(SLIDESHOW.config.photosDir, file),
      type: "local",
      title: path.basename(file, path.extname(file)),
    }));

    console.log(`Loaded ${SLIDESHOW.photos.length} local photos`);
  } catch (error) {
    console.error("Failed to load local photos:", error.message);
    SLIDESHOW.photos = [];
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
    const response = await axios.get(photoUrl, {
      responseType: "stream",
      timeout: 10000,
    });

    res.writeHead(200, {
      "Content-Type": response.headers["content-type"] || "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    });

    response.data.pipe(res);
  } catch (error) {
    console.error("Failed to serve Google Photo:", error.message);
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
    return null;
  }

  // Get next photo URL
  const photoUrl = SLIDESHOW.googlePhotoUrls[SLIDESHOW.googlePhotoIndex];
  const photoId = `google_lazy_${SLIDESHOW.googlePhotoIndex}`;

  // Check if this photo is already cached
  if (SLIDESHOW.photoCache.has(photoId)) {
    console.log(`Using cached photo ${SLIDESHOW.googlePhotoIndex + 1}/${SLIDESHOW.googlePhotoUrls.length}`);
    const cachedPhoto = SLIDESHOW.photoCache.get(photoId);

    // Move to next photo for next time
    SLIDESHOW.googlePhotoIndex = (SLIDESHOW.googlePhotoIndex + 1) % SLIDESHOW.googlePhotoUrls.length;

    return cachedPhoto;
  }

  // Create new photo object
  const photo = {
    id: photoId,
    url: photoUrl,
    type: "google",
    title: `Google Photo ${SLIDESHOW.googlePhotoIndex + 1}`,
    index: SLIDESHOW.googlePhotoIndex
  };

  // Add to cache (limit cache size to 10 photos)
  if (SLIDESHOW.photoCache.size >= 10) {
    const firstKey = SLIDESHOW.photoCache.keys().next().value;
    SLIDESHOW.photoCache.delete(firstKey);
  }
  SLIDESHOW.photoCache.set(photoId, photo);

  console.log(`Loading photo ${SLIDESHOW.googlePhotoIndex + 1}/${SLIDESHOW.googlePhotoUrls.length} on-demand`);

  // Move to next photo for next time
  SLIDESHOW.googlePhotoIndex = (SLIDESHOW.googlePhotoIndex + 1) % SLIDESHOW.googlePhotoUrls.length;

  return photo;
};

const setupIdleDetection = () => {
  EVENTS.on("userActivity", () => {
    SLIDESHOW.lastActivity = new Date();

    if (SLIDESHOW.active) {
      hideSlideshowSafely();
    }

    resetIdleTimer();
  });

  resetIdleTimer();
};

const resetIdleTimer = () => {
  if (SLIDESHOW.idleTimer) {
    clearTimeout(SLIDESHOW.idleTimer);
  }

  SLIDESHOW.idleTimer = setTimeout(() => {
    if (!SLIDESHOW.active && SLIDESHOW.photos.length > 0) {
      showSlideshow();
    }
  }, SLIDESHOW.config.idleTimeout);
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

  WEBVIEW.window.contentView.addChildView(SLIDESHOW.view);
  SLIDESHOW.view.setVisible(true);

  const windowBounds = WEBVIEW.window.getBounds();
  SLIDESHOW.view.setBounds({
    x: 0,
    y: 0,
    width: windowBounds.width,
    height: windowBounds.height,
  });

  // Send config (photos array can be empty for lazy loading)
  SLIDESHOW.view.webContents.send("slideshow-config", {
    config: SLIDESHOW.config,
    photos: SLIDESHOW.photos,
    googlePhotoCount: SLIDESHOW.googlePhotoUrls.length,
  });

  // Get and show first photo
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

  startSlideshowTimer();
  EVENTS.emit("slideshowStateChanged", true);
};

const hideSlideshowSafely = () => {
  if (!SLIDESHOW.active) {
    return;
  }

  console.log("Stopping slideshow");
  SLIDESHOW.active = false;
  publishSlideshowState();

  if (SLIDESHOW.timer) {
    clearInterval(SLIDESHOW.timer);
    SLIDESHOW.timer = null;
  }

  if (SLIDESHOW.view) {
    SLIDESHOW.view.setVisible(false);
    try {
      WEBVIEW.window.contentView.removeChildView(SLIDESHOW.view);
    } catch (error) {
      console.warn("Failed to remove slideshow view:", error.message);
    }
  }

  resetIdleTimer();
  EVENTS.emit("slideshowStateChanged", false);
};

const startSlideshowTimer = () => {
  if (SLIDESHOW.timer) {
    clearInterval(SLIDESHOW.timer);
  }

  SLIDESHOW.timer = setInterval(async () => {
    if (!SLIDESHOW.active) {
      return;
    }

    let photo = null;

    // Try Google Photos first (lazy loading)
    if (SLIDESHOW.googlePhotoUrls.length > 0) {
      photo = await getNextGooglePhoto();
    }

    // Fall back to local photos if no Google Photos available
    if (!photo && SLIDESHOW.photos.length > 0) {
      SLIDESHOW.currentIndex = (SLIDESHOW.currentIndex + 1) % SLIDESHOW.photos.length;
      photo = SLIDESHOW.photos[SLIDESHOW.currentIndex];
    }

    // If no photos available at all, return
    if (!photo) {
      console.warn("No photos available for slideshow");
      return;
    }

    SLIDESHOW.view.webContents.send("show-photo", {
      index: photo.index || SLIDESHOW.currentIndex,
      photo: photo,
    });
  }, SLIDESHOW.config.interval);
};

const updateConfig = (newConfig) => {
  Object.assign(SLIDESHOW.config, newConfig);

  if (SLIDESHOW.active) {
    if (SLIDESHOW.timer) {
      clearInterval(SLIDESHOW.timer);
      startSlideshowTimer();
    }
  }

  resetIdleTimer();

  SLIDESHOW.view?.webContents.send("slideshow-config", {
    config: SLIDESHOW.config,
  });
};

const reloadPhotos = async () => {
  console.log("Reloading photos...");
  await loadPhotos();

  if (SLIDESHOW.active && SLIDESHOW.photos.length > 0) {
    SLIDESHOW.currentIndex = 0;
    SLIDESHOW.view.webContents.send("slideshow-config", {
      config: SLIDESHOW.config,
      photos: SLIDESHOW.photos,
    });
  }
};

const getStatus = () => ({
  initialized: SLIDESHOW.initialized,
  active: SLIDESHOW.active,
  photoCount: SLIDESHOW.photos.length,
  currentIndex: SLIDESHOW.currentIndex,
  config: SLIDESHOW.config,
  lastActivity: SLIDESHOW.lastActivity,
});

const cleanup = () => {
  if (SLIDESHOW.timer) {
    clearInterval(SLIDESHOW.timer);
    SLIDESHOW.timer = null;
  }

  if (SLIDESHOW.idleTimer) {
    clearTimeout(SLIDESHOW.idleTimer);
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
  updateConfig,
  reloadPhotos,
  getStatus,
  cleanup,
};