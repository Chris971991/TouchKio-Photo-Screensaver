const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const zlib = require("zlib");
const axios = require("axios");
const { app, WebContentsView } = require("electron");

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
  config: {
    enabled: false,
    photosDir: "~/Pictures",
    googleAlbumId: null,
    interval: 5000,
    idleTimeout: 180000,
    showClock: true,
    clockPosition: "bottom-right",
    clockSize: "large",
    clockBackground: "dark",
    clockOpacity: 0.7,
    clockColor: "#ffffff",
    showSourceIndicator: true,
    sourcePosition: "top-left",
    sourceSize: "medium",
    sourceOpacity: 0.8,
    showPhotoCounter: true,
    counterPosition: "bottom-left",
    counterSize: "medium",
    counterOpacity: 0.8,
    randomOrder: true,
    photoFit: "contain",
    transitionType: "fade",
    transitionDuration: 2000,
    port: 8081,
    maxCachedPhotos: 100,
  },
};

const init = async () => {
  if (!ARGS.slideshow_enabled || ARGS.slideshow_enabled === "false") {
    return true;
  }

  const expandedDir = ARGS.slideshow_photos_dir ? ARGS.slideshow_photos_dir.replace("~", require("os").homedir()) : path.join(require("os").homedir(), "Pictures");

  SLIDESHOW.config = {
    ...SLIDESHOW.config,
    enabled: true,
    photosDir: expandedDir,
    googleAlbumId: ARGS.slideshow_google_album || null,
    interval: parseInt(ARGS.slideshow_interval) * 1000 || 5000,
    idleTimeout: parseInt(ARGS.slideshow_idle_timeout) * 1000 || 180000,
    showClock: ARGS.slideshow_show_clock !== "false",
    clockPosition: ARGS.slideshow_clock_position || "bottom-right",
    clockSize: ARGS.slideshow_clock_size || "large",
    clockBackground: ARGS.slideshow_clock_background || "dark",
    clockOpacity: parseFloat(ARGS.slideshow_clock_opacity) || 0.7,
    clockColor: ARGS.slideshow_clock_color || "#ffffff",
    showSourceIndicator: ARGS.slideshow_show_source !== "false",
    sourcePosition: ARGS.slideshow_source_position || "top-left",
    sourceSize: ARGS.slideshow_source_size || "medium",
    sourceOpacity: parseFloat(ARGS.slideshow_source_opacity) || 0.8,
    showPhotoCounter: ARGS.slideshow_show_counter !== "false",
    counterPosition: ARGS.slideshow_counter_position || "bottom-left",
    counterSize: ARGS.slideshow_counter_size || "medium",
    counterOpacity: parseFloat(ARGS.slideshow_counter_opacity) || 0.8,
    randomOrder: ARGS.slideshow_random_order !== "false",
    photoFit: ARGS.slideshow_photo_fit || "contain",
    transitionType: ARGS.slideshow_transition_type || "fade",
    transitionDuration: parseInt(ARGS.slideshow_transition_duration) || 2000,
  };

  console.log("Slideshow Configuration:", SLIDESHOW.config);

  try {
    await startServer();
    await initSlideshowView();
    await loadPhotos();

    SLIDESHOW.initialized = true;
    console.log("Slideshow initialized successfully");

    // Send initial configuration to slideshow HTML
    if (SLIDESHOW.view) {
      try {
        SLIDESHOW.view.webContents.send("slideshow-config", {
          config: SLIDESHOW.config,
          photos: SLIDESHOW.photos,
        });
        console.log(`Sent config with ${SLIDESHOW.photos.length} photos to slideshow view`);
      } catch (error) {
        console.warn("Could not send initial config:", error.message);
      }
    }

    setupIdleTimer();
    setupUserActivityListeners();
  } catch (error) {
    console.error("Failed to initialize slideshow:", error.message);
    return false;
  }

  return true;
};

const startServer = async () => {
  return new Promise((resolve, reject) => {
    SLIDESHOW.server = http.createServer(async (req, res) => {
      const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;

      if (urlPath === "/slideshow") {
        const slideshowHtmlPath = path.join(APP.path, "html", "slideshow.html");
        const htmlContent = fs.readFileSync(slideshowHtmlPath, "utf8");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(htmlContent);
      } else if (urlPath === "/api/slideshow/config") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(SLIDESHOW.config));
      } else if (urlPath === "/api/slideshow/photos") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(SLIDESHOW.photos));
      } else if (urlPath === "/api/slideshow/next") {
        nextPhoto();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, currentIndex: SLIDESHOW.currentIndex }));
      } else if (urlPath === "/api/slideshow/previous") {
        previousPhoto();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, currentIndex: SLIDESHOW.currentIndex }));
      } else if (urlPath.startsWith("/api/slideshow/photo/")) {
        const photoIndex = parseInt(urlPath.split("/").pop());
        if (photoIndex >= 0 && photoIndex < SLIDESHOW.photos.length) {
          try {
            const photoBuffer = await getPhotoBuffer(SLIDESHOW.photos[photoIndex]);
            const contentType = getContentTypeFromBuffer(photoBuffer) || "image/jpeg";
            res.writeHead(200, { "Content-Type": contentType });
            res.end(photoBuffer);
          } catch (error) {
            console.error("Error serving photo:", error.message);
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Photo not found");
          }
        } else {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Photo not found");
        }
      } else if (urlPath.startsWith("/photo/")) {
        const photoIndex = parseInt(urlPath.split("/").pop());
        if (photoIndex >= 0 && photoIndex < SLIDESHOW.photos.length) {
          try {
            const photoBuffer = await getPhotoBuffer(SLIDESHOW.photos[photoIndex]);
            const contentType = getContentTypeFromBuffer(photoBuffer) || "image/jpeg";
            res.writeHead(200, { "Content-Type": contentType });
            res.end(photoBuffer);
          } catch (error) {
            console.error("Error serving photo:", error.message);
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Photo not found");
          }
        } else {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Photo not found");
        }
      } else if (urlPath.startsWith("/google-photo/")) {
        const photoUrl = decodeURIComponent(urlPath.substring(14)); // Remove "/google-photo/"
        try {
          const photoBuffer = await getPhotoBuffer({ type: "google", url: photoUrl });
          const contentType = getContentTypeFromBuffer(photoBuffer) || "image/jpeg";
          res.writeHead(200, { "Content-Type": contentType });
          res.end(photoBuffer);
        } catch (error) {
          console.error("Error serving Google photo:", error.message);
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Photo not found");
        }
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
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

const loadPhotos = async () => {
  SLIDESHOW.photos = [];

  try {
    console.log("Loading Google Photos...");
    await loadGooglePhotos();
  } catch (error) {
    console.error("Error loading Google Photos:", error.message);
  }

  try {
    console.log("Loading local photos...");
    await loadLocalPhotos();
  } catch (error) {
    console.error("Error loading local photos:", error.message);
  }

  console.log(`Loaded ${SLIDESHOW.photos.length} photos for slideshow`);
};

const loadGooglePhotos = async () => {
  if (!SLIDESHOW.config.googleAlbumId) return;

  try {
    // Handle both album ID only and full URL with key
    let albumUrl;
    if (SLIDESHOW.config.googleAlbumId.startsWith('http')) {
      albumUrl = SLIDESHOW.config.googleAlbumId;
    } else if (SLIDESHOW.config.googleAlbumId.includes('?key=')) {
      albumUrl = `https://photos.google.com/share/${SLIDESHOW.config.googleAlbumId}`;
    } else {
      albumUrl = `https://photos.google.com/share/${SLIDESHOW.config.googleAlbumId}`;
    }
    console.log("Fetching Google Photos album:", albumUrl);

    const html = await new Promise((resolve, reject) => {
      const url = new URL(albumUrl);
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
          "DNT": "1",
          "Connection": "keep-alive",
          "Upgrade-Insecure-Requests": "1"
        }
      };

      const req = https.request(options, (res) => {
        let data = "";
        let stream = res;

        // Handle gzip compression
        if (res.headers['content-encoding'] === 'gzip') {
          stream = zlib.createGunzip();
          res.pipe(stream);
        } else if (res.headers['content-encoding'] === 'deflate') {
          stream = zlib.createInflate();
          res.pipe(stream);
        } else if (res.headers['content-encoding'] === 'br') {
          stream = zlib.createBrotliDecompress();
          res.pipe(stream);
        }

        stream.on("data", chunk => {
          data += chunk;
        });
        stream.on("end", () => {
          resolve(data);
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });

      req.end();
    });

    const imageRegex = /https:\/\/lh3\.googleusercontent\.com\/pw\/[^"\s]+/g;
    const matches = html.match(imageRegex) || [];

    const uniqueUrls = [...new Set(matches)];
    const photoUrls = uniqueUrls
      .slice(0, SLIDESHOW.config.maxCachedPhotos)
      .map(url => url.replace(/=w[0-9]+-h[0-9]+-[a-z-]+.*$/, "=w1920-h1080"));

    SLIDESHOW.photos = photoUrls.map((url, index) => ({
      id: `google_${index}`,
      url: url,
      type: "google",
      title: `Google Photo ${index + 1}`,
    }));

    console.log(`Loaded ${SLIDESHOW.photos.length} Google Photos`);
  } catch (error) {
    console.error("Failed to load Google Photos:", error.message);
    SLIDESHOW.photos = [];
  }
};

const loadLocalPhotos = async () => {
  if (!fs.existsSync(SLIDESHOW.config.photosDir)) {
    console.warn(`Photos directory does not exist: ${SLIDESHOW.config.photosDir}`);
    return;
  }

  const supportedExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];

  const files = fs.readdirSync(SLIDESHOW.config.photosDir)
    .filter(file => supportedExtensions.includes(path.extname(file).toLowerCase()))
    .slice(0, SLIDESHOW.config.maxCachedPhotos);

  const localPhotos = files.map((file, index) => ({
    id: `local_${index}`,
    path: path.join(SLIDESHOW.config.photosDir, file),
    type: "local",
    title: path.basename(file, path.extname(file)),
  }));

  // Add local photos to the existing Google Photos (if any)
  SLIDESHOW.photos = [...SLIDESHOW.photos, ...localPhotos];

  console.log(`Loaded ${localPhotos.length} local photos`);

  if (SLIDESHOW.config.randomOrder) {
    shuffleArray(SLIDESHOW.photos);
  }
};

const getPhotoBuffer = async (photo) => {
  if (photo.type === "local") {
    return fs.readFileSync(photo.path);
  } else if (photo.type === "google") {
    const photoUrl = photo.url;
    const response = await axios.get(photoUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });
    return Buffer.from(response.data);
  }
  throw new Error("Unknown photo type");
};

const getContentTypeFromBuffer = (buffer) => {
  if (buffer.length >= 8) {
    const header = buffer.toString("hex", 0, 8);
    if (header.startsWith("ffd8ff")) return "image/jpeg";
    if (header.startsWith("89504e47")) return "image/png";
    if (header.startsWith("47494638")) return "image/gif";
    if (header.startsWith("424d")) return "image/bmp";
    if (header.startsWith("52494646")) return "image/webp";
  }
  return null;
};

const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
};

const show = async () => {
  if (!SLIDESHOW.initialized || SLIDESHOW.active || SLIDESHOW.photos.length === 0) {
    return;
  }

  console.log("Starting slideshow");
  SLIDESHOW.active = true;

  if (SLIDESHOW.view) {
    try {
      SLIDESHOW.view.setVisible(true);
      const window = require("electron").BrowserWindow.getFocusedWindow();
      if (window) {
        window.setContentView(SLIDESHOW.view);
      }
    } catch (error) {
      console.warn("Could not show slideshow view:", error.message);
    }
  }

  startPhotoTimer();

  // Send initial photo to slideshow
  if (SLIDESHOW.photos.length > 0) {
    setTimeout(() => {
      if (SLIDESHOW.view) {
        try {
          SLIDESHOW.view.webContents.send("show-photo", {
            photo: SLIDESHOW.photos[SLIDESHOW.currentIndex],
            index: SLIDESHOW.currentIndex,
          });
        } catch (error) {
          console.warn("Could not send initial photo:", error.message);
        }
      }
    }, 1000); // Give HTML time to load
  }
};

const hide = () => {
  if (!SLIDESHOW.active) {
    return;
  }

  console.log("Stopping slideshow");
  SLIDESHOW.active = false;

  if (SLIDESHOW.timer) {
    clearInterval(SLIDESHOW.timer);
    SLIDESHOW.timer = null;
  }

  if (SLIDESHOW.view) {
    try {
      SLIDESHOW.view.setVisible(false);
    } catch (error) {
      console.warn("Could not hide slideshow view:", error.message);
    }
  }
};

const startPhotoTimer = () => {
  if (SLIDESHOW.timer) {
    clearInterval(SLIDESHOW.timer);
  }

  SLIDESHOW.timer = setInterval(() => {
    if (SLIDESHOW.active) {
      nextPhoto();
    }
  }, SLIDESHOW.config.interval);
};

const nextPhoto = () => {
  if (SLIDESHOW.photos.length === 0) return;

  SLIDESHOW.currentIndex = (SLIDESHOW.currentIndex + 1) % SLIDESHOW.photos.length;

  if (SLIDESHOW.view) {
    try {
      SLIDESHOW.view.webContents.send("slideshow-next-photo", {
        photo: SLIDESHOW.photos[SLIDESHOW.currentIndex],
        currentIndex: SLIDESHOW.currentIndex,
        totalPhotos: SLIDESHOW.photos.length,
        config: SLIDESHOW.config,
      });
    } catch (error) {
      console.warn("Could not send next photo message:", error.message);
    }
  }
};

const previousPhoto = () => {
  if (SLIDESHOW.photos.length === 0) return;

  SLIDESHOW.currentIndex = SLIDESHOW.currentIndex === 0
    ? SLIDESHOW.photos.length - 1
    : SLIDESHOW.currentIndex - 1;

  if (SLIDESHOW.view) {
    try {
      SLIDESHOW.view.webContents.send("slideshow-previous-photo", {
        photo: SLIDESHOW.photos[SLIDESHOW.currentIndex],
        currentIndex: SLIDESHOW.currentIndex,
        totalPhotos: SLIDESHOW.photos.length,
        config: SLIDESHOW.config,
      });
    } catch (error) {
      console.warn("Could not send previous photo message:", error.message);
    }
  }
};

const setupIdleTimer = () => {
  const resetIdleTimer = () => {
    if (SLIDESHOW.idleTimer) {
      clearTimeout(SLIDESHOW.idleTimer);
    }

    SLIDESHOW.idleTimer = setTimeout(() => {
      if (!SLIDESHOW.active) {
        show();
      }
    }, SLIDESHOW.config.idleTimeout);
  };

  EVENTS.on("userActivity", () => {
    SLIDESHOW.lastActivity = new Date();
    if (SLIDESHOW.active) {
      hide();
    }
    resetIdleTimer();
  });

  resetIdleTimer();
};

const setupUserActivityListeners = () => {
  // No additional listeners needed since we're using global events
};

module.exports = {
  init,
  show,
  hide,
  nextPhoto,
  previousPhoto,
};