const path = require("path");
const axios = require("axios");
const hardware = require("./hardware");
const integration = require("./integration");
const { app, nativeTheme, globalShortcut, ipcMain, session, BaseWindow, WebContentsView } = require("electron");

global.WEBVIEW = global.WEBVIEW || {
  initialized: false,
  tracker: {
    pointer: {
      position: {},
      time: new Date(),
    },
    display: {},
    status: null,
  },
};

/**
 * Initializes the webview with the provided arguments.
 *
 * @returns {bool} Returns true if the initialization was successful.
 */
const init = async () => {
  if (ARGS.web_url.length === 0) {
    console.error("Please provide the '--web-url' parameter");
    return app.quit();
  }
  if (ARGS.web_url.some((url) => !/^https?:\/\//.test(url))) {
    console.error("Please provide the '--web-url' parameter with http(s)");
    return app.quit();
  }
  session.defaultSession.clearCache();

  // Parse arguments
  const fullscreen = ARGS.app_debug !== "true";
  const widget = ARGS.web_widget ? ARGS.web_widget === "true" : true;
  const zoom = !isNaN(parseFloat(ARGS.web_zoom)) ? parseFloat(ARGS.web_zoom) : 1.25;
  const theme = ["light", "dark"].includes(ARGS.web_theme) ? ARGS.web_theme : "dark";
  const urls = [loaderHtml(40, 1.0, theme)].concat(ARGS.web_url);

  // Init global properties
  WEBVIEW.viewActive = 0;
  WEBVIEW.viewUrls = urls;
  WEBVIEW.viewZoom = zoom;
  WEBVIEW.viewTheme = theme;
  WEBVIEW.sidebarOpen = false;
  WEBVIEW.sidebarAutoHideTimer = null;
  WEBVIEW.pagerEnabled = widget;
  WEBVIEW.widgetTheme = theme;
  WEBVIEW.widgetEnabled = widget;
  WEBVIEW.navigationTheme = theme;
  WEBVIEW.navigationEnabled = widget;
  nativeTheme.themeSource = WEBVIEW.viewTheme;

  // Init global root window
  WEBVIEW.window = new BaseWindow({
    title: APP.title,
    icon: path.join(APP.path, "img", "icon.png"),
  });
  WEBVIEW.window.setMenuBarVisibility(false);
  WEBVIEW.window.setFullScreen(fullscreen);
  if (!fullscreen) {
    WEBVIEW.window.maximize();
  }

  // Init global webview
  WEBVIEW.views = [];
  urls.forEach((url, i) => {
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: true,
        enableBlinkFeatures: "CSSOMSmoothScroll",
        v8CacheOptions: "bypassHeatCheck",
        spellcheck: false,
        webgl: false,
        webaudio: false,
        enablePreferredSizeMode: false,
      },
    });
    view.setVisible(i === 0);
    view.setBackgroundColor("#FFFFFFFF");
    WEBVIEW.window.contentView.addChildView(view);
    WEBVIEW.views.push(view);
    onlineStatus(url).then(() => {
      view.webContents.loadURL(url);
    });
  });

  // Init global sidebar trigger (left edge)
  WEBVIEW.sidebarTrigger = new WebContentsView({
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  WEBVIEW.sidebarTrigger.setBackgroundColor("#00000000");
  WEBVIEW.window.contentView.addChildView(WEBVIEW.sidebarTrigger);
  WEBVIEW.sidebarTrigger.webContents.loadFile(path.join(APP.path, "html", "sidebar.html"));

  // Init global pager
  WEBVIEW.pager = new WebContentsView({
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  WEBVIEW.pager.setBackgroundColor("#00000000");
  WEBVIEW.window.contentView.addChildView(WEBVIEW.pager);
  WEBVIEW.pager.webContents.loadFile(path.join(APP.path, "html", "pager.html"));

  // Init global widget
  WEBVIEW.widget = new WebContentsView({
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  WEBVIEW.widget.setBackgroundColor("#00000000");
  WEBVIEW.window.contentView.addChildView(WEBVIEW.widget);
  WEBVIEW.widget.webContents.loadFile(path.join(APP.path, "html", "widget.html"));

  // Init global navigation
  WEBVIEW.navigation = new WebContentsView({
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  WEBVIEW.navigation.setBackgroundColor("#00000000");
  WEBVIEW.window.contentView.addChildView(WEBVIEW.navigation);
  WEBVIEW.navigation.webContents.loadFile(path.join(APP.path, "html", "navigation.html"));

  // Init global keyboard overlay
  WEBVIEW.keyboard = new WebContentsView({
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  WEBVIEW.keyboard.setBackgroundColor("#00000000");
  WEBVIEW.window.contentView.addChildView(WEBVIEW.keyboard);
  WEBVIEW.keyboard.webContents.loadFile(path.join(APP.path, "html", "keyboard.html"));
  WEBVIEW.keyboardVisible = false;
  WEBVIEW.keyboardHeight = 280;

  // Register global events
  EVENTS.on("reloadView", reloadView);
  EVENTS.on("updateView", updateView);
  EVENTS.on("updateDisplay", () => {
    const status = hardware.getDisplayStatus();
    if (status) {
      WEBVIEW.tracker.display[status.toLowerCase()] = new Date();
    }
  });

  // Register local events
  await windowEvents();
  await sidebarEvents();
  await widgetEvents();
  await navigationEvents();
  await keyboardEvents();
  await viewEvents();
  await appEvents();

  return true;
};

/**
 * Updates the shared webview properties.
 */
const update = async () => {
  if (!WEBVIEW.initialized || APP.exiting) {
    return;
  }

  // Update window status
  if (WEBVIEW.window.isFullScreen()) {
    WEBVIEW.tracker.status = "Fullscreen";
  } else if (WEBVIEW.window.isMinimized()) {
    WEBVIEW.tracker.status = "Minimized";
  } else if (WEBVIEW.window.isMaximized()) {
    WEBVIEW.tracker.status = "Maximized";
  } else {
    WEBVIEW.tracker.status = "Framed";
  }

  // Update widget status
  updateWidget();

  // Update navigation status
  updateNavigation();

  // Update integration sensor
  console.log("Update Kiosk Status:", WEBVIEW.tracker.status);
  integration.update();
};

/**
 * Updates the active view.
 */
const updateView = () => {
  if (!WEBVIEW.viewActive) {
    return;
  }
  const url = WEBVIEW.views[WEBVIEW.viewActive].webContents.getURL();
  const host = url.startsWith("data:") ? "whoopsie" : new URL(url).host;
  const title = `${APP.title} - ${host} (${WEBVIEW.viewActive})`;

  // Update window title
  console.log(`Update View: ${title}`);
  WEBVIEW.window.setTitle(title);

  // Hide all other webviews and show only the active one
  WEBVIEW.views.forEach((view, i) => {
    view.setVisible(i === WEBVIEW.viewActive);
  });
  update();
};

/**
 * Updates the widget control.
 */
const updateWidget = () => {
  // Hide keyboard button
  WEBVIEW.widget.webContents.send("button-hidden", {
    id: "keyboard",
    hidden: !HARDWARE.support.keyboardVisibility,
  });

  // Hide navigation button
  WEBVIEW.widget.webContents.send("button-hidden", {
    id: "navigation",
    hidden: !WEBVIEW.navigationEnabled,
  });
};

/**
 * Updates the navigation control.
 */
const updateNavigation = () => {
  const view = WEBVIEW.views[WEBVIEW.viewActive];
  const defaultUrl = WEBVIEW.viewUrls[WEBVIEW.viewActive];
  const currentUrl = view.webContents.getURL();

  // Hide pager buttons
  WEBVIEW.navigation.webContents.send("button-hidden", {
    id: "previous",
    hidden: WEBVIEW.viewUrls.length <= 2,
  });
  WEBVIEW.navigation.webContents.send("button-hidden", {
    id: "next",
    hidden: WEBVIEW.viewUrls.length <= 2,
  });

  // Disable pager buttons
  WEBVIEW.navigation.webContents.send("button-disabled", {
    id: "previous",
    disabled: WEBVIEW.viewActive <= 1,
  });
  WEBVIEW.navigation.webContents.send("button-disabled", {
    id: "next",
    disabled: WEBVIEW.viewActive >= WEBVIEW.viewUrls.length - 1,
  });

  // Update url text
  WEBVIEW.navigation.webContents.send("input-text", {
    id: "url",
    text: currentUrl.startsWith("data:") ? "" : currentUrl,
    placeholder: defaultUrl.startsWith("data:") ? "" : defaultUrl,
  });

  // Set url input readonly state based on keyboard support
  WEBVIEW.navigation.webContents.send("input-readonly", {
    id: "url",
    readonly: !!HARDWARE.support.keyboardVisibility,
  });

  // Disable zoom buttons
  WEBVIEW.navigation.webContents.send("button-disabled", {
    id: "minus",
    disabled: view.webContents.getZoomFactor().toFixed(2) <= 0.25,
  });
  WEBVIEW.navigation.webContents.send("button-disabled", {
    id: "plus",
    disabled: view.webContents.getZoomFactor().toFixed(2) >= 4.0,
  });

  // Disable history buttons
  WEBVIEW.navigation.webContents.send("button-disabled", {
    id: "backward",
    disabled: !view.webContents.navigationHistory.canGoBack(),
  });
  WEBVIEW.navigation.webContents.send("button-disabled", {
    id: "forward",
    disabled: !view.webContents.navigationHistory.canGoForward(),
  });
};

/**
 * Shows or hides the webview navigation bar.
 */
const toggleNavigation = () => {
  const window = WEBVIEW.window.getBounds();
  const navigation = WEBVIEW.navigation.getBounds();
  const height = navigation.height > 0 ? 0 : 60;

  // Show or hide navigation based on height
  WEBVIEW.navigation.setBounds({
    x: 0,
    y: window.height - height,
    width: window.width,
    height: height,
  });
  if (height > 0) {
    WEBVIEW.navigation.webContents.focus();
  } else {
    WEBVIEW.views[WEBVIEW.viewActive].webContents.focus();
  }

  // Resize webview
  resizeView();
};

/**
 * Decreases page zoom on the active webview.
 */
const zoomMinus = () => {
  const view = WEBVIEW.views[WEBVIEW.viewActive];
  view.webContents.setZoomFactor(Math.max(0.25, view.webContents.getZoomFactor() - 0.1));
  update();
};

/**
 * Increases page zoom on the active webview.
 */
const zoomPlus = () => {
  const view = WEBVIEW.views[WEBVIEW.viewActive];
  view.webContents.setZoomFactor(Math.min(4.0, view.webContents.getZoomFactor() + 0.1));
  update();
};

/**
 * Navigates backward in the history of the active webview.
 */
const historyBackward = () => {
  const view = WEBVIEW.views[WEBVIEW.viewActive];
  if (view.webContents.navigationHistory.canGoBack()) {
    view.webContents.navigationHistory.goBack();
  }
};

/**
 * Navigates forward in the history of the active webview.
 */
const historyForward = () => {
  const view = WEBVIEW.views[WEBVIEW.viewActive];
  if (view.webContents.navigationHistory.canGoForward()) {
    view.webContents.navigationHistory.goForward();
  }
};

/**
 * Activates the previous webview page.
 */
const previousView = () => {
  if (WEBVIEW.viewActive > 1) WEBVIEW.viewActive--;
  if (WEBVIEW.sidebarOpen) toggleHASidebar(true);
  updateView();
};

/**
 * Activates the next webview page.
 */
const nextView = () => {
  if (WEBVIEW.viewActive < WEBVIEW.views.length - 1) WEBVIEW.viewActive++;
  if (WEBVIEW.sidebarOpen) toggleHASidebar(true);
  updateView();
};

/**
 * Reloads the default url and settings on the active webview.
 */
const homeView = () => {
  const view = WEBVIEW.views[WEBVIEW.viewActive];
  const defaultUrl = WEBVIEW.viewUrls[WEBVIEW.viewActive];
  const currentUrl = view.webContents.getURL();

  // Reload the default url or refresh the page
  if (currentUrl != defaultUrl) {
    view.webContents.loadURL(defaultUrl);
  } else {
    view.webContents.reloadIgnoringCache();
  }

  // Reset page zoom and history
  view.webContents.setZoomFactor(WEBVIEW.viewZoom);
  setTimeout(() => {
    view.webContents.navigationHistory.clear();
    update();
  }, 2000);
};

/**
 * Reloads the current url on the active webview.
 */
const reloadView = () => {
  const view = WEBVIEW.views[WEBVIEW.viewActive];
  const defaultUrl = WEBVIEW.viewUrls[WEBVIEW.viewActive];
  const currentUrl = view.webContents.getURL();

  // Reload the default url or refresh the page
  if (currentUrl.startsWith("data:")) {
    view.webContents.loadURL(defaultUrl);
  } else {
    view.webContents.reloadIgnoringCache();
  }
  update();
};

/**
 * Resizes and positions all webviews.
 */
const resizeView = () => {
  const window = WEBVIEW.window.getBounds();
  const navigation = WEBVIEW.navigation.getBounds();
  const pager = { width: 20, height: window.height };
  const widget = { width: 60, height: 200 };

  // Update view size
  WEBVIEW.views.forEach((view) => {
    view.setBounds({
      x: 0,
      y: 0,
      width: window.width,
      height: window.height - navigation.height,
    });
  });

  // Update pager size
  if (WEBVIEW.pagerEnabled) {
    WEBVIEW.pager.setBounds({
      x: window.width - pager.width,
      y: 0,
      width: pager.width,
      height: pager.height,
    });
    WEBVIEW.pager.webContents.send("data-theme", { theme: "hidden" });
  }

  // Update widget size
  if (WEBVIEW.widgetEnabled) {
    WEBVIEW.widget.setBounds({
      x: window.width - 20,
      y: parseInt(window.height / 2 - widget.height / 2, 10),
      width: widget.width,
      height: widget.height,
    });
    WEBVIEW.widget.webContents.send("data-theme", { theme: "hidden" });
  }

  // Update navigation size
  if (WEBVIEW.navigationEnabled) {
    WEBVIEW.navigation.setBounds({
      x: 0,
      y: window.height - navigation.height,
      width: window.width,
      height: navigation.height,
    });
    WEBVIEW.navigation.webContents.send("data-theme", { theme: WEBVIEW.navigationTheme });
  }

  // Update slideshow view size if active
  if (global.SLIDESHOW && global.SLIDESHOW.view && global.SLIDESHOW.active) {
    // Remove and re-add to ensure it stays on top during resize
    try {
      WEBVIEW.window.contentView.removeChildView(global.SLIDESHOW.view);
      WEBVIEW.window.contentView.addChildView(global.SLIDESHOW.view);
    } catch (e) {
      // View might not be added
    }

    global.SLIDESHOW.view.setBounds({
      x: 0,
      y: 0,
      width: window.width,
      height: window.height,
    });
  }

  // Update keyboard overlay position
  if (WEBVIEW.keyboard) {
    const keyboardY = WEBVIEW.keyboardVisible
      ? window.height - WEBVIEW.keyboardHeight
      : window.height;
    WEBVIEW.keyboard.setBounds({
      x: 0,
      y: keyboardY,
      width: window.width,
      height: WEBVIEW.keyboardHeight,
    });
  }

  // Update sidebar trigger (left edge) — re-add last to stay on top
  if (WEBVIEW.sidebarTrigger) {
    try {
      WEBVIEW.window.contentView.removeChildView(WEBVIEW.sidebarTrigger);
    } catch (e) {}
    WEBVIEW.window.contentView.addChildView(WEBVIEW.sidebarTrigger);
    // Hide trigger when sidebar is open OR when slideshow is active
    const slideshowActive = global.SLIDESHOW && global.SLIDESHOW.active && global.SLIDESHOW.visible;
    const hideTrigger = WEBVIEW.sidebarOpen || slideshowActive;
    WEBVIEW.sidebarTrigger.setBounds({
      x: hideTrigger ? -20 : 0,
      y: 0,
      width: 20,
      height: window.height,
    });
  }
};

/**
 * Register window events and handler.
 */
const windowEvents = async () => {
  // Handle window resize events
  WEBVIEW.window.on("ready-to-show", resizeView);
  WEBVIEW.window.on("resize", resizeView);
  resizeView();

  // Handle window status updates
  WEBVIEW.window.on("minimize", update);
  WEBVIEW.window.on("restore", update);
  WEBVIEW.window.on("maximize", update);
  WEBVIEW.window.on("unmaximize", update);
  WEBVIEW.window.on("enter-full-screen", update);
  WEBVIEW.window.on("leave-full-screen", update);

  // Handle global shortcut events
  globalShortcut.register("Control+Left", () => {
    previousView();
  });
  globalShortcut.register("Control+Right", () => {
    nextView();
  });
  globalShortcut.register("Control+numsub", () => {
    zoomMinus();
  });
  globalShortcut.register("Control+numadd", () => {
    zoomPlus();
  });
  globalShortcut.register("Alt+Left", () => {
    historyBackward();
  });
  globalShortcut.register("Alt+Right", () => {
    historyForward();
  });

  // Check for window touch events (1s)
  setInterval(() => {
    const now = new Date();
    const then = WEBVIEW.tracker.pointer.time;
    const delta = (now - then) / 1000;

    // Auto-hide navigation
    if (delta > 60) {
      const navigation = WEBVIEW.navigation.getBounds();
      if (navigation.height > 0) {
        toggleNavigation();
      }
    }
  }, 1000);
};

/**
 * Register widget events and handler.
 */
/**
 * Register sidebar trigger events.
 */
const sidebarEvents = async () => {
  const { ipcMain } = require("electron");

  ipcMain.on("sidebar-toggle", () => {
    console.log("Sidebar toggle IPC received");
    EVENTS.emit("userActivity");
    toggleHASidebar();
  });
};

const widgetEvents = async () => {
  if (!WEBVIEW.widgetEnabled) {
    return;
  }

  // Handle widget focus events
  WEBVIEW.widget.webContents.on("focus", () => {
    const window = WEBVIEW.window.getBounds();
    const widget = WEBVIEW.widget.getBounds();

    // Show widget
    WEBVIEW.widget.setBounds({
      x: window.width - 60,
      y: widget.y,
      width: widget.width,
      height: widget.height,
    });
    WEBVIEW.widget.webContents.send("data-theme", { theme: WEBVIEW.widgetTheme });
  });

  // Handle widget blur events
  WEBVIEW.widget.webContents.on("blur", () => {
    const window = WEBVIEW.window.getBounds();
    const widget = WEBVIEW.widget.getBounds();

    // Hide widget
    WEBVIEW.widget.setBounds({
      x: window.width - 20,
      y: widget.y,
      width: widget.width,
      height: widget.height,
    });
    WEBVIEW.widget.webContents.send("data-theme", { theme: "hidden" });
  });

  // Handle widget button click events
  ipcMain.on("button-click", (e, button) => {
    EVENTS.emit("userActivity");
    switch (button.id) {
      case "keyboard":
        const toggle = hardware.getKeyboardVisibility() === "ON" ? "OFF" : "ON";
        switch (toggle) {
          case "OFF":
            WEBVIEW.window.restore();
            WEBVIEW.window.unmaximize();
            WEBVIEW.window.setFullScreen(true);
            break;
          case "ON":
            WEBVIEW.window.restore();
            WEBVIEW.window.setFullScreen(false);
            WEBVIEW.window.maximize();
            break;
        }
        hardware.setKeyboardVisibility(toggle, () => {
          WEBVIEW.views[WEBVIEW.viewActive].webContents.focus();
        });
        break;
      case "fullscreen":
        if (WEBVIEW.window.isFullScreen()) {
          WEBVIEW.window.restore();
          WEBVIEW.window.unmaximize();
          WEBVIEW.window.setFullScreen(false);
        } else {
          WEBVIEW.window.restore();
          WEBVIEW.window.unmaximize();
          WEBVIEW.window.setFullScreen(true);
        }
        hardware.setKeyboardVisibility("OFF", () => {
          WEBVIEW.views[WEBVIEW.viewActive].webContents.focus();
        });
        break;
      case "minimize":
        WEBVIEW.window.restore();
        WEBVIEW.window.setFullScreen(false);
        WEBVIEW.window.minimize();
        hardware.setKeyboardVisibility("OFF");
        break;
      case "navigation":
        toggleNavigation();
        break;
    }
  });
};

/**
 * Register navigation events and handler.
 */
const navigationEvents = async () => {
  if (!WEBVIEW.navigationEnabled) {
    return;
  }

  // Handle input blur events
  let selected = false;
  ipcMain.on("input-blur", (e, input) => {
    const visibility = hardware.getKeyboardVisibility();
    switch (input.id) {
      case "url":
        if (visibility === "ON" && selected) {
          hardware.setKeyboardVisibility("OFF", () => {
            WEBVIEW.navigation.webContents.send("input-select", { id: "url", select: false });
            WEBVIEW.navigation.webContents.send("input-readonly", { id: "url", readonly: true });
          });
        }
        break;
    }
    selected = false;
  });

  // Handle input focus events
  ipcMain.on("input-focus", (e, input) => {
    EVENTS.emit("userActivity");
    const visibility = hardware.getKeyboardVisibility();
    switch (input.id) {
      case "url":
        if (visibility === "OFF") {
          hardware.setKeyboardVisibility("ON", () => {
            setTimeout(() => {
              selected = true;
              WEBVIEW.navigation.webContents.focus();
              WEBVIEW.navigation.webContents.send("input-select", { id: "url", select: true });
              WEBVIEW.navigation.webContents.send("input-readonly", { id: "url", readonly: false });
            }, 400);
          });
        }
        break;
    }
  });

  // Handle input enter events
  ipcMain.on("input-enter", (e, input) => {
    EVENTS.emit("userActivity");
    switch (input.id) {
      case "url":
        let url = input.text.trim();
        if (url && !/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(url)) {
          url = "https://" + url;
        }
        if (!url) {
          url = WEBVIEW.viewUrls[WEBVIEW.viewActive];
        }
        WEBVIEW.views[WEBVIEW.viewActive].webContents.loadURL(url);
        break;
    }
  });

  // Handle navigation button click events
  ipcMain.on("button-click", (e, button) => {
    EVENTS.emit("userActivity");
    const view = WEBVIEW.views[WEBVIEW.viewActive];
    switch (button.id) {
      case "home":
        homeView();
        hardware.setKeyboardVisibility("OFF");
        break;
      case "refresh":
        reloadView();
        hardware.setKeyboardVisibility("OFF");
        break;
      case "previous":
        previousView();
        hardware.setKeyboardVisibility("OFF");
        break;
      case "next":
        nextView();
        hardware.setKeyboardVisibility("OFF");
        break;
      case "minus":
        zoomMinus();
        hardware.setKeyboardVisibility("OFF");
        break;
      case "plus":
        zoomPlus();
        hardware.setKeyboardVisibility("OFF");
        break;
      case "backward":
        historyBackward();
        hardware.setKeyboardVisibility("OFF");
        break;
      case "forward":
        historyForward();
        hardware.setKeyboardVisibility("OFF");
        break;
    }
  });
};

/**
 * Register keyboard events and handler.
 */
const keyboardEvents = async () => {
  const window = WEBVIEW.window.getBounds();

  // Initially hide keyboard off-screen
  WEBVIEW.keyboard.setBounds({
    x: 0,
    y: window.height,
    width: window.width,
    height: WEBVIEW.keyboardHeight,
  });

  // Animate keyboard slide
  let keyboardAnimating = false;
  const animateKeyboard = (targetY, onComplete) => {
    if (keyboardAnimating) return;
    keyboardAnimating = true;
    const bounds = WEBVIEW.window.getBounds();
    const currentBounds = WEBVIEW.keyboard.getBounds();
    const startY = currentBounds.y;
    const distance = targetY - startY;
    const duration = 200; // ms
    const startTime = Date.now();

    const step = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentY = Math.round(startY + distance * eased);

      WEBVIEW.keyboard.setBounds({
        x: 0,
        y: currentY,
        width: bounds.width,
        height: WEBVIEW.keyboardHeight,
      });

      if (progress < 1) {
        setTimeout(step, 16); // ~60fps
      } else {
        keyboardAnimating = false;
        if (onComplete) onComplete();
      }
    };
    step();
  };

  // Show keyboard
  const showKeyboard = () => {
    if (WEBVIEW.keyboardVisible || keyboardAnimating) return;
    WEBVIEW.keyboardVisible = true;
    const bounds = WEBVIEW.window.getBounds();
    // Bring keyboard to front
    WEBVIEW.window.contentView.removeChildView(WEBVIEW.keyboard);
    WEBVIEW.window.contentView.addChildView(WEBVIEW.keyboard);
    // Animate slide up
    animateKeyboard(bounds.height - WEBVIEW.keyboardHeight);
    console.log("Keyboard shown");
  };

  // Hide keyboard
  const hideKeyboard = () => {
    if (!WEBVIEW.keyboardVisible || keyboardAnimating) return;
    WEBVIEW.keyboardVisible = false;
    const bounds = WEBVIEW.window.getBounds();
    // Animate slide down
    animateKeyboard(bounds.height, () => {
      // Refocus webview after animation
      WEBVIEW.views[WEBVIEW.viewActive].webContents.focus();
    });
    console.log("Keyboard hidden");
  };

  // Handle keyboard show request
  ipcMain.on("keyboard-show", () => {
    showKeyboard();
  });

  // Handle keyboard hide request
  ipcMain.on("keyboard-hide", () => {
    hideKeyboard();
  });

  // Handle key press from keyboard overlay
  ipcMain.on("keyboard-key", (e, data) => {
    const view = WEBVIEW.views[WEBVIEW.viewActive];
    if (!view) return;

    if (data.action === "backspace") {
      view.webContents.sendInputEvent({ type: "keyDown", keyCode: "Backspace" });
      view.webContents.sendInputEvent({ type: "keyUp", keyCode: "Backspace" });
    } else if (data.action === "enter") {
      view.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
      view.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    } else if (data.char) {
      // Send full key event sequence for compatibility with web components and iframes
      view.webContents.sendInputEvent({ type: "keyDown", keyCode: data.char });
      view.webContents.sendInputEvent({ type: "char", keyCode: data.char, text: data.char });
      view.webContents.sendInputEvent({ type: "keyUp", keyCode: data.char });
    }
  });

  // Export show/hide for use by viewEvents
  WEBVIEW.showKeyboard = showKeyboard;
  WEBVIEW.hideKeyboard = hideKeyboard;
};

/**
 * Register view events and handler.
 */
/**
 * Toggle the HA sidebar via JavaScript injection.
 */
const resetSidebarAutoHide = () => {
  if (WEBVIEW.sidebarAutoHideTimer) clearTimeout(WEBVIEW.sidebarAutoHideTimer);
  if (WEBVIEW.sidebarOpen) {
    WEBVIEW.sidebarAutoHideTimer = setTimeout(() => {
      toggleHASidebar(true);
    }, 15000);
  }
};

const toggleHASidebar = (forceClose = false) => {
  const view = WEBVIEW.views[WEBVIEW.viewActive];
  if (!view || !view.webContents) return;

  if (forceClose) {
    WEBVIEW.sidebarOpen = false;
  } else {
    WEBVIEW.sidebarOpen = !WEBVIEW.sidebarOpen;
  }

  const show = WEBVIEW.sidebarOpen;
  view.webContents.executeJavaScript(`
    (function() {
      try {
        var ha = document.querySelector('home-assistant');
        if (!ha || !ha.shadowRoot) return;
        var main = ha.shadowRoot.querySelector('home-assistant-main');
        if (!main || !main.shadowRoot) return;
        var drawer = main.shadowRoot.querySelector('ha-drawer');
        if (!drawer) return;
        var style = main.shadowRoot.getElementById('touchkio-sidebar-css');
        if (${show}) {
          if (style) style.remove();
          drawer.open = true;
          // Force sidebar to overlay on top of content with full interactivity
          var showStyle = main.shadowRoot.getElementById('touchkio-sidebar-show-css');
          if (!showStyle) {
            showStyle = document.createElement('style');
            showStyle.id = 'touchkio-sidebar-show-css';
            showStyle.textContent = '.mdc-drawer { position: fixed !important; z-index: 9999 !important; height: 100% !important; } ha-sidebar { pointer-events: auto !important; }';
            main.shadowRoot.appendChild(showStyle);
          }
        } else {
          // Remove show overlay CSS
          var showStyle = main.shadowRoot.getElementById('touchkio-sidebar-show-css');
          if (showStyle) showStyle.remove();
          drawer.open = false;
          if (!style) {
            style = document.createElement('style');
            style.id = 'touchkio-sidebar-css';
            style.textContent = 'ha-sidebar { display: none !important; } .mdc-drawer { width: 0 !important; min-width: 0 !important; padding: 0 !important; overflow: hidden !important; } .mdc-drawer-app-content { margin-left: 0 !important; } :host { --mdc-drawer-width: 0px !important; }';
            main.shadowRoot.appendChild(style);
          }
        }
      } catch(e) {}
    })();
  `).catch(() => {});

  // Move trigger view out of the way when sidebar is open, restore when closed
  if (WEBVIEW.sidebarTrigger) {
    const window = WEBVIEW.window.getBounds();
    if (WEBVIEW.sidebarOpen) {
      // Move off-screen so it doesn't block sidebar clicks
      WEBVIEW.sidebarTrigger.setBounds({ x: -20, y: 0, width: 20, height: window.height });
    } else {
      // Restore to left edge
      WEBVIEW.sidebarTrigger.setBounds({ x: 0, y: 0, width: 20, height: window.height });
    }
  }

  // Auto-hide after 15 seconds of no interaction
  resetSidebarAutoHide();
};

const viewEvents = async () => {
  const ready = [];
  WEBVIEW.views.forEach((view, i) => {
    // Enable webview touch emulation
    view.webContents.debugger.attach("1.1");
    view.webContents.debugger.sendCommand("Emulation.setEmitTouchEventsForMouse", {
      configuration: "mobile",
      enabled: true,
    });

    // Redirect webview hyperlinks
    view.webContents.setWindowOpenHandler(({ url }) => {
      view.webContents.loadURL(url);
      return { action: "deny" };
    });

    // Update webview layout
    view.webContents.on("dom-ready", () => {
      view.webContents.insertCSS("::-webkit-scrollbar { display: none; }");

      // Hide HA sidebar on page load
      view.webContents.executeJavaScript(`
        (function() {
          try {
            var waitForHA = setInterval(function() {
              var ha = document.querySelector('home-assistant');
              if (!ha || !ha.shadowRoot) return;
              var main = ha.shadowRoot.querySelector('home-assistant-main');
              if (!main || !main.shadowRoot) return;
              var drawer = main.shadowRoot.querySelector('ha-drawer');
              if (!drawer) return;
              drawer.open = false;
              var style = document.createElement('style');
              style.id = 'touchkio-sidebar-css';
              style.textContent = 'ha-sidebar { display: none !important; } .mdc-drawer { width: 0 !important; min-width: 0 !important; padding: 0 !important; overflow: hidden !important; } .mdc-drawer-app-content { margin-left: 0 !important; } :host { --mdc-drawer-width: 0px !important; }';
              main.shadowRoot.appendChild(style);
              clearInterval(waitForHA);
            }, 500);
            setTimeout(function() { clearInterval(waitForHA); }, 10000);
          } catch(e) {}
        })();
      `).catch(() => {});

      if (ready.length < WEBVIEW.views.length) {
        view.webContents.setZoomFactor(WEBVIEW.viewZoom);
        ready.push(i);
      }
    });

    // Webview fully loaded
    view.webContents.on("did-finish-load", () => {
      if (WEBVIEW.viewActive === 0 && ready.length === WEBVIEW.views.length) {
        nextView();
      }
      if (ARGS.app_debug === "true") {
        setTimeout(() => {
          view.webContents.openDevTools();
        }, 2000);
      }

      // Inject input focus detection for keyboard overlay (skip loader view)
      if (i > 0 && WEBVIEW.showKeyboard) {
        console.log("Injecting keyboard focus detection for view", i);

        // Use CDP to detect focus changes - more reliable than console interception
        const pollFocus = async () => {
          try {
            const result = await view.webContents.executeJavaScript(`
              (function() {
                function isTextInput(el) {
                  if (!el || !el.tagName) return false;
                  var tagName = el.tagName.toLowerCase();
                  var type = (el.type || '').toLowerCase();
                  if (tagName === 'input' && ['hidden','checkbox','radio','button','submit','range','color','file'].indexOf(type) === -1) return true;
                  if (tagName === 'textarea') return true;
                  if (el.isContentEditable) return true;
                  if (tagName.indexOf('textfield') !== -1 || tagName.indexOf('search-input') !== -1 || tagName.indexOf('text-area') !== -1) return true;
                  var role = el.getAttribute && el.getAttribute('role');
                  if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
                  if (el.shadowRoot) {
                    var innerInput = el.shadowRoot.querySelector('input, textarea');
                    if (innerInput) return true;
                  }
                  return false;
                }
                function getDeepActiveElement() {
                  var active = document.activeElement;
                  while (active) {
                    if (active.shadowRoot && active.shadowRoot.activeElement) {
                      active = active.shadowRoot.activeElement;
                    } else if (active.tagName === 'IFRAME') {
                      try {
                        var iframeActive = active.contentDocument && active.contentDocument.activeElement;
                        if (iframeActive) {
                          active = iframeActive;
                        } else {
                          break;
                        }
                      } catch(e) { break; }
                    } else {
                      break;
                    }
                  }
                  return active;
                }
                return isTextInput(getDeepActiveElement());
              })();
            `);
            return result;
          } catch (e) {
            return false;
          }
        };

        let lastFocusState = false;
        setInterval(async () => {
          const isFocused = await pollFocus();
          if (isFocused && !lastFocusState) {
            console.log("Keyboard focus detected - showing keyboard");
            WEBVIEW.showKeyboard();
            lastFocusState = true;
          } else if (!isFocused && lastFocusState) {
            console.log("Keyboard focus lost - hiding keyboard");
            WEBVIEW.hideKeyboard();
            lastFocusState = false;
          }
        }, 150);

        console.log("Keyboard focus polling started for view", i);
      }
    });

    // Webview not loaded
    view.webContents.on("did-fail-load", (e, code, text, url, mainframe) => {
      if (mainframe) {
        if (WEBVIEW.viewActive === 0 && ready.length === WEBVIEW.views.length) {
          nextView();
        }
        view.webContents.loadURL(errorHtml(code, text, url));
      }
    });

    // Webview url changed
    view.webContents.on("did-navigate-in-page", (e, url, mainframe) => {
      if (mainframe) {
        updateView();
      }
    });
    view.webContents.on("did-navigate", () => {
      updateView();
    });

    // Handle webview mouse events
    view.webContents.on("before-mouse-event", (e, mouse) => {
      const now = new Date();
      const then = WEBVIEW.tracker.pointer.time;
      const delta = (now - then) / 1000;
      switch (mouse.type) {
        case "mouseMove":
          const posNew = { x: mouse.globalX, y: mouse.globalY };
          if (posNew.x < 0 || posNew.y < 0) {
            break;
          }
          // Update last active on pointer position change
          const posOld = WEBVIEW.tracker.pointer.position;
          if (posOld.x !== posNew.x || posOld.y !== posNew.y) {
            WEBVIEW.tracker.pointer.time = now;
            WEBVIEW.tracker.pointer.position = posNew;
            // Only emit activity if not in display wake grace period
            const wakeGracePassed = !WEBVIEW.displayWakeTime || (Date.now() - WEBVIEW.displayWakeTime > 2000);
            if (wakeGracePassed) {
              EVENTS.emit("userActivity");
            }
            if (delta > 30) {
              console.log("Update Last Active");
              integration.update();
            }
          }
          break;
        case "mouseDown":
          switch (mouse.button) {
            case "left":
              // Sidebar is open: tap outside closes, tap inside resets timer
              if (WEBVIEW.sidebarOpen) {
                if (mouse.globalX > 256) {
                  console.log("Tap outside sidebar - closing");
                  toggleHASidebar(true);
                } else {
                  // Tapping within sidebar area — reset auto-hide timer
                  resetSidebarAutoHide();
                }
              }

              // Check if display was off - handle wake sequence specially
              const displayWasOff = hardware.getDisplayStatus() === "OFF" ||
                                    WEBVIEW.tracker.display.off > WEBVIEW.tracker.display.on;

              // Check if slideshow is active but hidden (black overlay showing)
              // In this state, touch should show the slideshow, not trigger activity
              const slideshowHiddenButActive = global.SLIDESHOW &&
                                                global.SLIDESHOW.active &&
                                                !global.SLIDESHOW.visible;

              if (displayWasOff) {
                console.log("Display Touch Event: Waking display (activity suppressed for 2s)");
                e.preventDefault();
                hardware.setDisplayStatus("ON");
                // Set a wake grace period - don't emit userActivity for 2 seconds
                WEBVIEW.displayWakeTime = Date.now();
              } else if (slideshowHiddenButActive) {
                // Black overlay is showing - don't emit activity, let idle timer handle it
                console.log("Touch on black overlay - resetting idle timer to show slideshow");
                WEBVIEW.displayWakeTime = Date.now(); // Suppress activity briefly
              } else {
                // Display was already on - normal activity detection
                EVENTS.emit("userActivity");
              }
              break;
            case "back":
              historyBackward();
              break;
            case "forward":
              historyForward();
              break;
          }
          break;
      }
    });
  });
};

/**
 * Register app events and handler.
 */
const appEvents = async () => {
  // Handle multiple instances
  app.on("second-instance", () => {
    if (WEBVIEW.window.isMinimized()) {
      WEBVIEW.window.restore();
    }
    WEBVIEW.window.focus();
  });

  // Handle signal and exit events
  app.on("before-quit", () => {
    WEBVIEW.tracker.status = "Terminated";
    console.warn(`${APP.title} Terminated`);
    integration.update();
  });
  process.on("SIGINT", app.quit);

  // Webview initialized
  WEBVIEW.initialized = true;

  // Check for latest release infos (2h)
  setInterval(() => {
    latestRelease();
  }, 7200 * 1000);
  await latestRelease();
};

/**
 * Fetches the latest app release infos from github.
 */
const latestRelease = async () => {
  try {
    const response = await axios.get(`${APP.releases.url}/latest`, { timeout: 10000 });
    const data = response ? response.data : null;
    if (!data || data.draft || data.prerelease) {
      return;
    }
    APP.releases.latest = {
      title: APP.title,
      version: (data.tag_name || data.name || "").replace(/^v/i, ""),
      summary: data.body || "",
      url: data.html_url || "",
    };
  } catch (error) {
    console.warn("Github Error:", error.message);
  }
};

/**
 * Checks for network connectivity by requesting a known url.
 *
 * @param {string} url - Url to request.
 * @param {number} interval - Interval between requests in milliseconds.
 * @param {number} timeout - Maximum time to repeat requests in milliseconds.
 * @returns {Promise<boolean>} Resolves true if online, false on timeout.
 */
const onlineStatus = (url, interval = 1000, timeout = 60000) => {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = async () => {
      const elapsed = Date.now() - start;
      try {
        if (!url.startsWith("data:")) {
          await axios.get(url, { timeout: 10000 });
        }
        resolve(true);
      } catch (error) {
        if (elapsed >= interval) {
          console.warn(`Checking Connection: ${url}`, error.message);
        }
        if (elapsed >= timeout) {
          resolve(false);
        } else {
          setTimeout(check, interval);
        }
      }
    };
    check();
  });
};

/**
 * Generates a html template for a spinning loader.
 *
 * @param {number} size - The size of the circle.
 * @param {number} speed - The rotation speed of the circle.
 * @param {string} theme - The theme used for spinner colors.
 * @returns {string} A data string with the generated html.
 */
const loaderHtml = (size, speed, theme) => {
  const color = {
    dark: { border: "#2A2A2A", spinner: "#03A9F4", background: "#111111" },
    light: { border: "#DCDCDC", spinner: "#03A9F4", background: "#FAFAFA" },
  }[theme];
  const html = `
    <html>
      <head>
        <style>
          body {
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: ${color.background};
          }
          .spinner {
            width: ${size}px;
            height: ${size}px;
            border-radius: 50%;
            border: 4px solid ${color.border};
            border-top-color: ${color.spinner};
            animation: spin ${speed}s linear infinite;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="spinner"></div>
      </body>
    </html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
};

/**
 * Generates a html template for an error page.
 *
 * @param {number} code - The error code of the response.
 * @param {string} text - The error text of the response.
 * @param {string} url - The url of the requested page.
 * @returns {string} A data string with the generated html.
 */
const errorHtml = (code, text, url) => {
  const html = `
    <html>
      <head>
        <style>
          body {
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: sans-serif;
            text-align: center;
          }
          .icon {
            margin: 0;
            font-size: 5rem;
            color: orange;
          }
          .title {
            margin: 0;
          }
        </style>
      </head>
      <body>
        <div>
          <p class="icon">&#9888;</p>
          <h1 class="title">Whoopsie!</h1>
          <p><strong>Loading:</strong> ${url}</p>
          <p><strong>Error:</strong> ${text} (${code})</p>
        </div>
      </body>
    </html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
};

module.exports = {
  init,
  update,
};
