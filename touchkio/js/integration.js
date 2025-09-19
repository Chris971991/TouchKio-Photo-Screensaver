const mqtt = require("mqtt");
const hardware = require("./hardware");
const slideshow = require("./slideshow");
const { app } = require("electron");

global.INTEGRATION = global.INTEGRATION || {
  initialized: false,
};

/**
 * Initializes the integration with the provided arguments.
 *
 * @returns {bool} Returns true if the initialization was successful.
 */
const init = async () => {
  if (!ARGS.mqtt_url) {
    return false;
  }
  if (!/^mqtts?:\/\//.test(ARGS.mqtt_url)) {
    console.error("Please provide the '--mqtt-url' parameter with mqtt(s)");
    return app.quit();
  }

  // Parse arguments
  const url = new URL(ARGS.mqtt_url);
  const user = ARGS.mqtt_user ? ARGS.mqtt_user : null;
  const password = ARGS.mqtt_password ? ARGS.mqtt_password : null;
  const discovery = ARGS.mqtt_discovery ? ARGS.mqtt_discovery : "homeassistant";

  const model = hardware.getModel();
  const vendor = hardware.getVendor();
  const hostName = hardware.getHostName();
  const serialNumber = hardware.getSerialNumber();
  const serialNumberSuffix = serialNumber.slice(-6);
  const deviceName = hostName.charAt(0).toUpperCase() + hostName.slice(1);
  const deviceId = serialNumberSuffix.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Init globals
  INTEGRATION.discovery = discovery;
  INTEGRATION.node = `rpi_${deviceId}`;
  INTEGRATION.root = `${APP.name}/${INTEGRATION.node}`;
  INTEGRATION.device = {
    name: `${APP.title} ${deviceName}`,
    model: model,
    manufacturer: vendor,
    serial_number: serialNumber,
    identifiers: [INTEGRATION.node],
    sw_version: `${APP.name}-v${APP.version}`,
    configuration_url: APP.homepage,
  };

  // Connection settings
  const options = user === null || password === null ? null : { username: user, password: password };
  const masked = password === null ? "null" : "*".repeat(password.length);
  console.log("MQTT Connecting:", `${user}:${masked}@${url.toString()}`);
  INTEGRATION.client = mqtt.connect(url.toString(), options);

  // Increase max listeners for all the slideshow MQTT subscriptions
  INTEGRATION.client.setMaxListeners(50);

  // Client connected
  INTEGRATION.client
    .once("connect", () => {
      console.log(`MQTT Connected: ${url.toString()}`);
      process.stdout.write("\n");

      // Init client controls
      initApp();
      initShutdown();
      initReboot();
      initRefresh();
      initKiosk();
      initDisplay();
      initKeyboard();
      initPageNumber();
      initPageZoom();
      initPageUrl();
      initSlideshow();

      // Init client sensors
      initModel();
      initSerialNumber();
      initHostName();
      initNetworkAddress();
      initUpTime();
      initMemorySize();
      initMemoryUsage();
      initProcessorUsage();
      initProcessorTemperature();
      initBatteryLevel();
      initPackageUpgrades();
      initHeartbeat();
      initLastActive();

      // Integration initialized
      INTEGRATION.initialized = true;
    })
    .on("error", (error) => {
      console.error("MQTT", error.message);
    });

  // Update sensor states from events
  EVENTS.on("updateDisplay", updateDisplay);
  EVENTS.on("updateKeyboard", updateKeyboard);

  // Update time sensors periodically (30s)
  setInterval(() => {
    updateHeartbeat();
    updateLastActive();
  }, 30 * 1000);

  // Update system sensors periodically (1min)
  setInterval(() => {
    update();
  }, 60 * 1000);

  // Update upgrade sensors periodically (1h)
  setInterval(() => {
    updateApp();
    updatePackageUpgrades();
  }, 3600 * 1000);

  return true;
};

/**
 * Updates the shared integration properties.
 */
const update = async () => {
  if (!INTEGRATION.initialized) {
    return;
  }

  // Update client sensors
  updateKiosk();
  updatePageNumber();
  updatePageZoom();
  updatePageUrl();
  updateNetworkAddress();
  updateUpTime();
  updateLastActive();
  updateMemoryUsage();
  updateProcessorUsage();
  updateProcessorTemperature();
  updateBatteryLevel();
};

/**
 * Publishes the auto-discovery config via the mqtt connection.
 *
 *  @param {string} type - The entity type name.
 *  @param {Object} config - The configuration object.
 *  @returns {Object} Instance of the mqtt client.
 */
const publishConfig = (type, config) => {
  if (type === null || config === null) {
    return INTEGRATION.client;
  }
  const path = config.unique_id.replace(`${INTEGRATION.node}_`, "");
  const root = `${INTEGRATION.discovery}/${type}/${INTEGRATION.node}/${path}/config`;
  return INTEGRATION.client.publish(root, JSON.stringify(config), { qos: 1, retain: true });
};

/**
 * Publishes the sensor attributes via the mqtt connection.
 *
 *  @param {string} path - The entity path name.
 *  @param {Object} attributes - The attributes object.
 *  @returns {Object} Instance of the mqtt client.
 */
const publishAttributes = (path, attributes) => {
  if (path === null || attributes === null) {
    return INTEGRATION.client;
  }
  const root = `${INTEGRATION.root}/${path}/attributes`;
  return INTEGRATION.client.publish(root, JSON.stringify(attributes), { qos: 1, retain: true });
};

/**
 * Publishes the sensor state via the mqtt connection.
 *
 *  @param {string} path - The entity path name.
 *  @param {string|number} state - The state value.
 *  @returns {Object} Instance of the mqtt client.
 */
const publishState = (path, state) => {
  if (path === null || state === null) {
    return INTEGRATION.client;
  }
  const root = `${INTEGRATION.root}/${path}/state`;
  return INTEGRATION.client.publish(root, `${state}`, { qos: 1, retain: true });
};

/**
 * Initializes the app update entity and handles the execute logic.
 */
const initApp = () => {
  if (!HARDWARE.support.appUpdate) {
    return;
  }
  const root = `${INTEGRATION.root}/app`;
  const config = {
    name: "App",
    unique_id: `${INTEGRATION.node}_app`,
    command_topic: `${root}/install`,
    state_topic: `${root}/version/state`,
    payload_install: "update",
    device: INTEGRATION.device,
  };
  publishConfig("update", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        console.log("Update App...");
        hardware.setDisplayStatus("ON", () => {
          const args = ["-c", `bash <(wget -qO- ${APP.scripts.install}) update`];
          hardware.execScriptCommand("bash", args, (progress, error) => {
            if (progress) {
              console.log(`Progress: ${progress}%`);
            }
            updateApp(progress);
          });
        });
      }
    })
    .subscribe(config.command_topic);
  updateApp();
};

/**
 * Updates the app update entity via the mqtt connection.
 */
const updateApp = async (progress = 0) => {
  const latest = APP.releases.latest;
  if (!latest) {
    return;
  }
  const version = {
    title: latest.title,
    latest_version: latest.version,
    installed_version: APP.version,
    release_summary: latest.summary.slice(0, 250) + "...",
    release_url: latest.url,
    update_percentage: progress || null,
    in_progress: progress && progress > 0 && progress < 100,
  };
  publishState("app/version", JSON.stringify(version));
};

/**
 * Initializes the shutdown button and handles the execute logic.
 */
const initShutdown = () => {
  if (!HARDWARE.support.sudoRights) {
    return;
  }
  const root = `${INTEGRATION.root}/shutdown`;
  const config = {
    name: "Shutdown",
    unique_id: `${INTEGRATION.node}_shutdown`,
    command_topic: `${root}/execute`,
    icon: "mdi:power",
    device: INTEGRATION.device,
  };
  publishConfig("button", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        console.log("Shutdown system...");
        hardware.setDisplayStatus("ON", () => {
          hardware.shutdownSystem();
        });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the reboot button and handles the execute logic.
 */
const initReboot = () => {
  if (!HARDWARE.support.sudoRights) {
    return;
  }
  const root = `${INTEGRATION.root}/reboot`;
  const config = {
    name: "Reboot",
    unique_id: `${INTEGRATION.node}_reboot`,
    command_topic: `${root}/execute`,
    icon: "mdi:restart",
    device: INTEGRATION.device,
  };
  publishConfig("button", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        console.log("Rebooting system...");
        hardware.setDisplayStatus("ON", () => {
          hardware.rebootSystem();
        });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the refresh button and handles the execute logic.
 */
const initRefresh = () => {
  const root = `${INTEGRATION.root}/refresh`;
  const config = {
    name: "Refresh",
    unique_id: `${INTEGRATION.node}_refresh`,
    command_topic: `${root}/execute`,
    icon: "mdi:web-refresh",
    device: INTEGRATION.device,
  };
  publishConfig("button", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        console.log("Refreshing webview...");
        hardware.setDisplayStatus("ON", () => {
          EVENTS.emit("reloadView");
        });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the kiosk select status and handles the execute logic.
 */
const initKiosk = () => {
  const root = `${INTEGRATION.root}/kiosk`;
  const config = {
    name: "Kiosk",
    unique_id: `${INTEGRATION.node}_kiosk`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    options: ["Framed", "Fullscreen", "Maximized", "Minimized", "Terminated"],
    icon: "mdi:overscan",
    device: INTEGRATION.device,
  };
  publishConfig("select", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const status = message.toString();
        console.log("Set Kiosk Status:", status);
        hardware.setDisplayStatus("ON", () => {
          switch (status) {
            case "Framed":
              WEBVIEW.window.restore();
              WEBVIEW.window.unmaximize();
              WEBVIEW.window.setFullScreen(false);
              break;
            case "Fullscreen":
              WEBVIEW.window.restore();
              WEBVIEW.window.unmaximize();
              WEBVIEW.window.setFullScreen(true);
              break;
            case "Maximized":
              WEBVIEW.window.restore();
              WEBVIEW.window.setFullScreen(false);
              WEBVIEW.window.maximize();
              break;
            case "Minimized":
              WEBVIEW.window.restore();
              WEBVIEW.window.setFullScreen(false);
              WEBVIEW.window.minimize();
              break;
            case "Terminated":
              app.quit();
          }
        });
      }
    })
    .subscribe(config.command_topic);
  updateKiosk();
};

/**
 * Updates the kiosk status via the mqtt connection.
 */
const updateKiosk = async () => {
  const kiosk = WEBVIEW.tracker.status;
  publishState("kiosk", kiosk);
};

/**
 * Initializes the display status, brightness and handles the execute logic.
 */
const initDisplay = () => {
  if (!HARDWARE.support.displayStatus) {
    return;
  }
  const root = `${INTEGRATION.root}/display`;
  const config = {
    name: "Display",
    unique_id: `${INTEGRATION.node}_display`,
    command_topic: `${root}/power/set`,
    state_topic: `${root}/power/state`,
    icon: "mdi:monitor-shimmer",
    platform: "light",
    device: INTEGRATION.device,
    ...(HARDWARE.support.displayBrightness && {
      brightness_command_topic: `${root}/brightness/set`,
      brightness_state_topic: `${root}/brightness/state`,
      brightness_scale: 100,
    }),
  };
  publishConfig("light", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const status = message.toString();
        console.log("Set Display Status:", status);
        hardware.setDisplayStatus(status, (reply, error) => {
          if (!error) {
            hardware.update();
          } else {
            console.warn("Failed:", error);
          }
        });
      } else if (topic === config.brightness_command_topic) {
        const brightness = parseInt(message, 10);
        console.log("Set Display Brightness:", brightness);
        hardware.setDisplayBrightness(brightness, (reply, error) => {
          if (!error) {
            hardware.update();
          } else {
            console.warn("Failed:", error);
          }
        });
      }
    })
    .subscribe(config.command_topic)
    .subscribe(config.brightness_command_topic);
  updateDisplay();
};

/**
 * Updates the display status, brightness via the mqtt connection.
 */
const updateDisplay = async () => {
  const status = hardware.getDisplayStatus();
  const brightness = hardware.getDisplayBrightness();
  publishState("display/power", status);
  publishState("display/brightness", brightness);
};

/**
 * Initializes the keyboard visibility and handles the execute logic.
 */
const initKeyboard = () => {
  if (!HARDWARE.support.keyboardVisibility) {
    return;
  }
  const root = `${INTEGRATION.root}/keyboard`;
  const config = {
    name: "Keyboard",
    unique_id: `${INTEGRATION.node}_keyboard`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    icon: "mdi:keyboard-close-outline",
    device: INTEGRATION.device,
  };
  publishConfig("switch", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const status = message.toString();
        console.log("Set Keyboard Visibility:", status);
        hardware.setDisplayStatus("ON", () => {
          switch (status) {
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
          hardware.setKeyboardVisibility(status);
        });
      }
    })
    .subscribe(config.command_topic);
  updateKeyboard();
};

/**
 * Updates the keyboard visibility via the mqtt connection.
 */
const updateKeyboard = async () => {
  const visibility = hardware.getKeyboardVisibility();
  publishState("keyboard", visibility);
};

/**
 * Initializes the page number and handles the execute logic.
 */
const initPageNumber = () => {
  if (WEBVIEW.viewUrls.length <= 2) {
    return;
  }
  const root = `${INTEGRATION.root}/page_number`;
  const config = {
    name: "Page Number",
    unique_id: `${INTEGRATION.node}_page_number`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value | int }}",
    mode: "box",
    min: 1,
    max: WEBVIEW.viewUrls.length - 1,
    unit_of_measurement: "Page",
    icon: "mdi:page-next",
    device: INTEGRATION.device,
  };
  publishConfig("number", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const number = parseInt(message, 10);
        console.log("Set Page Number:", number);
        WEBVIEW.viewActive = number || 1;
        EVENTS.emit("updateView");
      }
    })
    .subscribe(config.command_topic);
  updatePageNumber();
};

/**
 * Updates the page number via the mqtt connection.
 */
const updatePageNumber = async () => {
  const pageNumber = WEBVIEW.viewActive || 1;
  publishState("page_number", pageNumber);
};

/**
 * Initializes the page zoom and handles the execute logic.
 */
const initPageZoom = () => {
  const root = `${INTEGRATION.root}/page_zoom`;
  const config = {
    name: "Page Zoom",
    unique_id: `${INTEGRATION.node}_page_zoom`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value | int }}",
    mode: "slider",
    min: 25,
    max: 400,
    unit_of_measurement: "%",
    icon: "mdi:magnify-plus",
    device: INTEGRATION.device,
  };
  publishConfig("number", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const zoom = parseInt(message, 10);
        console.log("Set Page Zoom:", zoom);
        WEBVIEW.views[WEBVIEW.viewActive || 1].webContents.setZoomFactor(zoom / 100.0);
        EVENTS.emit("updateView");
      }
    })
    .subscribe(config.command_topic);
  updatePageZoom();
};

/**
 * Updates the page zoom via the mqtt connection.
 */
const updatePageZoom = async () => {
  const pageZoom = Math.round(WEBVIEW.views[WEBVIEW.viewActive || 1].webContents.getZoomFactor() * 100.0);
  publishState("page_zoom", pageZoom);
};

/**
 * Initializes the page url and handles the execute logic.
 */
const initPageUrl = () => {
  const root = `${INTEGRATION.root}/page_url`;
  const config = {
    name: "Page Url",
    unique_id: `${INTEGRATION.node}_page_url`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    pattern: "https?://.*",
    icon: "mdi:web",
    device: INTEGRATION.device,
  };
  publishConfig("text", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const url = message.toString();
        console.log("Set Page Url:", url);
        WEBVIEW.views[WEBVIEW.viewActive || 1].webContents.loadURL(url);
      }
    })
    .subscribe(config.command_topic);
  updatePageUrl();
};

/**
 * Updates the page url via the mqtt connection.
 */
const updatePageUrl = async () => {
  const defaultUrl = WEBVIEW.viewUrls[WEBVIEW.viewActive || 1];
  const currentUrl = WEBVIEW.views[WEBVIEW.viewActive || 1].webContents.getURL();
  const pageUrl = !currentUrl || currentUrl.startsWith("data:") ? defaultUrl : currentUrl;
  publishState("page_url", pageUrl);
};

/**
 * Initializes the model sensor.
 */
const initModel = () => {
  const root = `${INTEGRATION.root}/model`;
  const config = {
    name: "Model",
    unique_id: `${INTEGRATION.node}_model`,
    state_topic: `${root}/state`,
    json_attributes_topic: `${root}/attributes`,
    value_template: "{{ value }}",
    icon: "mdi:raspberry-pi",
    device: INTEGRATION.device,
  };
  publishConfig("sensor", config);
  updateModel();
};

/**
 * Updates the model sensor via the mqtt connection.
 */
const updateModel = async () => {
  const model = hardware.getModel();
  publishState("model", model);
  publishAttributes("model", HARDWARE.support);
};

/**
 * Initializes the serial number sensor.
 */
const initSerialNumber = () => {
  const root = `${INTEGRATION.root}/serial_number`;
  const config = {
    name: "Serial Number",
    unique_id: `${INTEGRATION.node}_serial_number`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    icon: "mdi:hexadecimal",
    device: INTEGRATION.device,
  };
  publishConfig("sensor", config);
  updateSerialNumber();
};

/**
 * Updates the serial number sensor via the mqtt connection.
 */
const updateSerialNumber = async () => {
  const serialNumber = hardware.getSerialNumber();
  publishState("serial_number", serialNumber);
};

/**
 * Initializes the network address sensor.
 */
const initNetworkAddress = () => {
  const root = `${INTEGRATION.root}/network_address`;
  const config = {
    name: "Network Address",
    unique_id: `${INTEGRATION.node}_network_address`,
    state_topic: `${root}/state`,
    json_attributes_topic: `${root}/attributes`,
    value_template: "{{ value }}",
    icon: "mdi:ip-network",
    device: INTEGRATION.device,
  };
  publishConfig("sensor", config);
  updateNetworkAddress();
};

/**
 * Updates the network address sensor via the mqtt connection.
 */
const updateNetworkAddress = async () => {
  const networkAddresses = hardware.getNetworkAddresses();
  const [name] = Object.keys(networkAddresses);
  const [family] = name ? Object.keys(networkAddresses[name]) : [];
  const networkAddress = networkAddresses[name]?.[family]?.[0] || null;
  publishState("network_address", networkAddress);
  publishAttributes("network_address", networkAddresses);
};

/**
 * Initializes the host name sensor.
 */
const initHostName = () => {
  const root = `${INTEGRATION.root}/host_name`;
  const config = {
    name: "Host Name",
    unique_id: `${INTEGRATION.node}_host_name`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    icon: "mdi:console-network",
    device: INTEGRATION.device,
  };
  publishConfig("sensor", config);
  updateHostName();
};

/**
 * Updates the host name sensor via the mqtt connection.
 */
const updateHostName = async () => {
  const hostName = hardware.getHostName();
  publishState("host_name", hostName);
};

/**
 * Initializes the up time sensor.
 */
const initUpTime = () => {
  const root = `${INTEGRATION.root}/up_time`;
  const config = {
    name: "Up Time",
    unique_id: `${INTEGRATION.node}_up_time`,
    state_topic: `${root}/state`,
    value_template: "{{ (value | float) | round(0) }}",
    unit_of_measurement: "min",
    icon: "mdi:timeline-clock",
    device: INTEGRATION.device,
  };
  publishConfig("sensor", config);
  updateUpTime();
};

/**
 * Updates the up time sensor via the mqtt connection.
 */
const updateUpTime = async () => {
  const upTime = hardware.getUpTime();
  publishState("up_time", upTime);
};

/**
 * Initializes the memory size sensor.
 */
const initMemorySize = () => {
  const root = `${INTEGRATION.root}/memory_size`;
  const config = {
    name: "Memory Size",
    unique_id: `${INTEGRATION.node}_memory_size`,
    state_topic: `${root}/state`,
    value_template: "{{ (value | float) | round(2) }}",
    unit_of_measurement: "GiB",
    icon: "mdi:memory",
    device: INTEGRATION.device,
  };
  publishConfig("sensor", config);
  updateMemorySize();
};

/**
 * Updates the memory size sensor via the mqtt connection.
 */
const updateMemorySize = async () => {
  const memorySize = hardware.getMemorySize();
  publishState("memory_size", memorySize);
};

/**
 * Initializes the memory usage sensor.
 */
const initMemoryUsage = () => {
  const root = `${INTEGRATION.root}/memory_usage`;
  const config = {
    name: "Memory Usage",
    unique_id: `${INTEGRATION.node}_memory_usage`,
    state_topic: `${root}/state`,
    value_template: "{{ (value | float) | round(0) }}",
    unit_of_measurement: "%",
    icon: "mdi:memory-arrow-down",
    device: INTEGRATION.device,
  };
  publishConfig("sensor", config);
  updateMemoryUsage();
};

/**
 * Updates the memory usage sensor via the mqtt connection.
 */
const updateMemoryUsage = async () => {
  const memoryUsage = hardware.getMemoryUsage();
  publishState("memory_usage", memoryUsage);
};

/**
 * Initializes the processor usage sensor.
 */
const initProcessorUsage = () => {
  const root = `${INTEGRATION.root}/processor_usage`;
  const config = {
    name: "Processor Usage",
    unique_id: `${INTEGRATION.node}_processor_usage`,
    state_topic: `${root}/state`,
    value_template: "{{ (value | float) | round(0) }}",
    unit_of_measurement: "%",
    icon: "mdi:cpu-64-bit",
    device: INTEGRATION.device,
  };
  publishConfig("sensor", config);
  updateProcessorUsage();
};

/**
 * Updates the processor usage sensor via the mqtt connection.
 */
const updateProcessorUsage = async () => {
  const processorUsage = hardware.getProcessorUsage();
  publishState("processor_usage", processorUsage);
};

/**
 * Initializes the processor temperature sensor.
 */
const initProcessorTemperature = () => {
  const root = `${INTEGRATION.root}/processor_temperature`;
  const config = {
    name: "Processor Temperature",
    unique_id: `${INTEGRATION.node}_processor_temperature`,
    state_topic: `${root}/state`,
    value_template: "{{ (value | float) | round(0) }}",
    unit_of_measurement: "°C",
    icon: "mdi:radiator",
    device: INTEGRATION.device,
  };
  publishConfig("sensor", config);
  updateProcessorTemperature();
};

/**
 * Updates the processor temperature sensor via the mqtt connection.
 */
const updateProcessorTemperature = async () => {
  const processorTemperature = hardware.getProcessorTemperature();
  publishState("processor_temperature", processorTemperature);
};

/**
 * Initializes the battery level sensor.
 */
const initBatteryLevel = () => {
  if (!HARDWARE.support.batteryLevel) {
    return;
  }
  const root = `${INTEGRATION.root}/battery_level`;
  const config = {
    name: "Battery Level",
    unique_id: `${INTEGRATION.node}_battery_level`,
    state_topic: `${root}/state`,
    value_template: "{{ (value | float) | round(0) }}",
    unit_of_measurement: "%",
    icon: "mdi:battery-medium",
    device: INTEGRATION.device,
  };
  publishConfig("sensor", config);
  updateBatteryLevel();
};

/**
 * Updates the battery level sensor via the mqtt connection.
 */
const updateBatteryLevel = async () => {
  const batteryLevel = hardware.getBatteryLevel();
  publishState("battery_level", batteryLevel);
};

/**
 * Initializes the package upgrades sensor.
 */
const initPackageUpgrades = () => {
  const root = `${INTEGRATION.root}/package_upgrades`;
  const config = {
    name: "Package Upgrades",
    unique_id: `${INTEGRATION.node}_package_upgrades`,
    state_topic: `${root}/state`,
    json_attributes_topic: `${root}/attributes`,
    value_template: "{{ value | int }}",
    icon: "mdi:package-down",
    device: INTEGRATION.device,
  };
  publishConfig("sensor", config);
  updatePackageUpgrades();
};

/**
 * Updates the package upgrades sensor via the mqtt connection.
 */
const updatePackageUpgrades = async () => {
  const packages = hardware.checkPackageUpgrades();
  const attributes = {
    total: packages.length,
    packages: packages.map((pkg) => pkg.replace(/\s*\[.*?\]\s*/g, "").trim()),
  };
  publishState("package_upgrades", attributes.total);
  publishAttributes("package_upgrades", attributes);
};

/**
 * Initializes the heartbeat sensor.
 */
const initHeartbeat = () => {
  const root = `${INTEGRATION.root}/heartbeat`;
  const config = {
    name: "Heartbeat",
    unique_id: `${INTEGRATION.node}_heartbeat`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    icon: "mdi:heart-flash",
    device: INTEGRATION.device,
  };
  publishConfig("sensor", config);
  updateHeartbeat();
};

/**
 * Updates the heartbeat sensor via the mqtt connection.
 */
const updateHeartbeat = async () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000);
  const heartbeat = local.toISOString().replace(/\.\d{3}Z$/, "");
  publishState("heartbeat", heartbeat);
};

/**
 * Initializes the last active sensor.
 */
const initLastActive = () => {
  const root = `${INTEGRATION.root}/last_active`;
  const config = {
    name: "Last Active",
    unique_id: `${INTEGRATION.node}_last_active`,
    state_topic: `${root}/state`,
    value_template: "{{ (value | float) | round(0) }}",
    unit_of_measurement: "min",
    icon: "mdi:gesture-tap-hold",
    device: INTEGRATION.device,
  };
  publishConfig("sensor", config);
  updateLastActive();
};

/**
 * Updates the last active sensor via the mqtt connection.
 */
const updateLastActive = async () => {
  const now = new Date();
  const then = WEBVIEW.tracker.pointer.time;
  const lastActive = (now - then) / (1000 * 60);
  publishState("last_active", lastActive);
};

/**
 * Initializes all slideshow controls and handles the execute logic.
 */
const initSlideshow = () => {
  // Always initialize slideshow MQTT controls when MQTT is enabled
  // Users can enable/disable slideshow through Home Assistant

  // Master slideshow controls
  initSlideshowEnabled();
  initSlideshowActive();

  // Photo source settings
  initSlideshowPhotosDir();
  initSlideshowGoogleAlbums();

  // Timing settings
  initSlideshowInterval();
  initSlideshowIdleTimeout();

  // Photo settings
  initSlideshowRandomOrder();
  initSlideshowPhotoFit();
  initSlideshowOrientationMode();

  // Transition settings
  initSlideshowTransitionType();
  initSlideshowTransitionDuration();

  // Clock settings
  initSlideshowShowClock();
  initSlideshowClockPosition();
  initSlideshowClockSize();
  initSlideshowClockBackground();
  initSlideshowClockOpacity();
  initSlideshowClockColor();

  // Source indicator settings
  initSlideshowShowSource();
  initSlideshowSourcePosition();
  initSlideshowSourceSize();
  initSlideshowSourceOpacity();

  // Counter settings
  initSlideshowShowCounter();
  initSlideshowCounterPosition();
  initSlideshowCounterSize();
  initSlideshowCounterOpacity();

  // Publish initial states
  updateSlideshow();

  // Listen for slideshow state changes
  EVENTS.on("slideshowStateChanged", updateSlideshow);
};

/**
 * Initializes the slideshow enabled control (master on/off).
 */
const initSlideshowEnabled = () => {
  const root = `${INTEGRATION.root}/slideshow_enabled`;
  const config = {
    name: "Slideshow Enabled",
    unique_id: `${INTEGRATION.node}_slideshow_enabled`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    icon: "mdi:power",
    device: INTEGRATION.device,
  };

  publishConfig("switch", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const state = message.toString();
        console.log("Set Slideshow Enabled:", state);
        updateSlideshowSetting("slideshow_enabled", state === "ON");
        INTEGRATION.client.publish(config.state_topic, state, { retain: true });
      }
    })
    .subscribe(config.command_topic);

  // Publish initial state
  const enabled = SLIDESHOW.config.enabled ? "ON" : "OFF";
  INTEGRATION.client.publish(config.state_topic, enabled, { retain: true });
};

/**
 * Initializes the slideshow active control (current running state).
 */
const initSlideshowActive = () => {
  const root = `${INTEGRATION.root}/slideshow_active`;
  const config = {
    name: "Slideshow Active",
    unique_id: `${INTEGRATION.node}_slideshow_active`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    icon: "mdi:slideshow",
    device: INTEGRATION.device,
  };

  publishConfig("switch", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const state = message.toString();
        console.log("Set Slideshow Active:", state);
        updateSlideshowSetting("slideshow_active", state === "ON");
        if (state === "ON") {
          slideshow.showSlideshow();
        } else {
          slideshow.hideSlideshow();
        }

        // Publish actual slideshow state (not just echo the command)
        setTimeout(() => {
          const actualState = slideshow.getStatus().active ? "ON" : "OFF";
          INTEGRATION.client.publish(config.state_topic, actualState, { retain: true });
        }, 100); // Small delay to allow state to settle
      }
    })
    .subscribe(config.command_topic);

  // Publish initial state based on slideshow visibility
  const active = SLIDESHOW.visible ? "ON" : "OFF";
  INTEGRATION.client.publish(config.state_topic, active, { retain: true });
};

/**
 * Initializes the slideshow photos directory control.
 */
const initSlideshowPhotosDir = () => {
  const root = `${INTEGRATION.root}/slideshow_photos_dir`;
  const config = {
    name: "Slideshow Photos Directory",
    unique_id: `${INTEGRATION.node}_slideshow_photos_dir`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    icon: "mdi:folder-image",
    mode: "text",
    device: INTEGRATION.device,
  };

  publishConfig("text", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const photosDir = message.toString();
        console.log("Set Slideshow Photos Directory:", photosDir);
        updateSlideshowSetting("slideshow_photos_dir", photosDir);
        slideshow.updateConfig({ photosDir });
        slideshow.reloadPhotos();
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow Google Albums controls (5 separate album fields).
 */
const initSlideshowGoogleAlbums = () => {
  // Create 5 separate Google Photos album fields
  for (let i = 1; i <= 5; i++) {
    const root = `${INTEGRATION.root}/slideshow_google_album_${i}`;
    const config = {
      name: `Slideshow Google Album ${i}`,
      unique_id: `${INTEGRATION.node}_slideshow_google_album_${i}`,
      command_topic: `${root}/set`,
      state_topic: `${root}/state`,
      value_template: "{{ value }}",
      icon: "mdi:google-photos",
      mode: "text",
      device: INTEGRATION.device,
    };

    publishConfig("text", config)
      .on("message", (topic, message) => {
        if (topic === config.command_topic) {
          const albumUrl = message.toString();
          console.log(`Set Slideshow Google Album ${i}:`, albumUrl);
          updateSlideshowSetting(`slideshow_google_album_${i}`, albumUrl);

          // Combine all 5 album fields and update slideshow
          const combinedAlbums = [];
          for (let j = 1; j <= 5; j++) {
            const albumValue = global.ARGS[`slideshow_google_album_${j}`];
            if (albumValue && albumValue.trim()) {
              combinedAlbums.push(albumValue.trim());
            }
          }
          const combinedAlbumsString = combinedAlbums.join(',');

          slideshow.updateConfig({ googleAlbumIds: combinedAlbumsString });
          slideshow.reloadPhotos();
        }
      })
      .subscribe(config.command_topic);
  }
};

/**
 * Initializes the slideshow interval control.
 */
const initSlideshowInterval = () => {
  const root = `${INTEGRATION.root}/slideshow_interval`;
  const config = {
    name: "Slideshow Interval",
    unique_id: `${INTEGRATION.node}_slideshow_interval`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value | int }}",
    mode: "box",
    min: 1,
    max: 60,
    unit_of_measurement: "s",
    icon: "mdi:timer",
    device: INTEGRATION.device,
  };

  publishConfig("number", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const interval = parseInt(message, 10);
        console.log("Set Slideshow Interval:", interval);
        updateSlideshowSetting("slideshow_interval", interval);
        slideshow.updateConfig({ interval: interval * 1000 });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow idle timeout control.
 */
const initSlideshowIdleTimeout = () => {
  const root = `${INTEGRATION.root}/slideshow_idle_timeout`;
  const config = {
    name: "Slideshow Idle Timeout",
    unique_id: `${INTEGRATION.node}_slideshow_idle_timeout`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value | float }}",
    mode: "box",
    min: 0.1,
    max: 60,
    step: 0.1,
    unit_of_measurement: "min",
    icon: "mdi:clock-time-four-outline",
    device: INTEGRATION.device,
  };

  publishConfig("number", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const idleTimeout = parseFloat(message);
        console.log("Set Slideshow Idle Timeout:", idleTimeout);
        updateSlideshowSetting("slideshow_idle_timeout", idleTimeout);
        slideshow.updateConfig({ idleTimeout: idleTimeout * 60000 });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow random order control.
 */
const initSlideshowRandomOrder = () => {
  const root = `${INTEGRATION.root}/slideshow_random_order`;
  const config = {
    name: "Slideshow Random Order",
    unique_id: `${INTEGRATION.node}_slideshow_random_order`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    icon: "mdi:shuffle",
    device: INTEGRATION.device,
  };

  publishConfig("switch", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const randomOrder = message.toString() === "ON";
        console.log("Set Slideshow Random Order:", randomOrder);
        updateSlideshowSetting("slideshow_random_order", randomOrder);
        slideshow.updateConfig({ randomOrder });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow photo fit control.
 */
const initSlideshowPhotoFit = () => {
  const root = `${INTEGRATION.root}/slideshow_photo_fit`;
  const config = {
    name: "Slideshow Photo Fit",
    unique_id: `${INTEGRATION.node}_slideshow_photo_fit`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    options: ["contain", "cover", "fill"],
    icon: "mdi:image-size-select-actual",
    device: INTEGRATION.device,
  };

  publishConfig("select", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const photoFit = message.toString();
        console.log("Set Slideshow Photo Fit:", photoFit);
        updateSlideshowSetting("slideshow_photo_fit", photoFit);
        slideshow.updateConfig({ photoFit });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow orientation mode control.
 */
const initSlideshowOrientationMode = () => {
  const root = `${INTEGRATION.root}/slideshow_orientation_mode`;
  const config = {
    name: "Slideshow Orientation Mode",
    unique_id: `${INTEGRATION.node}_slideshow_orientation_mode`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    options: ["landscape", "portrait"],
    icon: "mdi:screen-rotation",
    device: INTEGRATION.device,
  };

  publishConfig("select", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const orientationMode = message.toString();
        console.log("Set Slideshow Orientation Mode:", orientationMode);
        updateSlideshowSetting("slideshow_orientation_mode", orientationMode);
        slideshow.updateConfig({ orientationMode });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow transition type control.
 */
const initSlideshowTransitionType = () => {
  const root = `${INTEGRATION.root}/slideshow_transition_type`;
  const config = {
    name: "Slideshow Transition Type",
    unique_id: `${INTEGRATION.node}_slideshow_transition_type`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    options: ["fade", "slide", "zoom", "blur", "rotate"],
    icon: "mdi:transition",
    device: INTEGRATION.device,
  };

  publishConfig("select", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const transitionType = message.toString();
        console.log("Set Slideshow Transition Type:", transitionType);
        updateSlideshowSetting("slideshow_transition_type", transitionType);
        slideshow.updateConfig({ transitionType });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow transition duration control.
 */
const initSlideshowTransitionDuration = () => {
  const root = `${INTEGRATION.root}/slideshow_transition_duration`;
  const config = {
    name: "Slideshow Transition Duration",
    unique_id: `${INTEGRATION.node}_slideshow_transition_duration`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value | int }}",
    mode: "box",
    min: 500,
    max: 5000,
    step: 100,
    unit_of_measurement: "ms",
    icon: "mdi:timer-outline",
    device: INTEGRATION.device,
  };

  publishConfig("number", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const transitionDuration = parseInt(message, 10);
        console.log("Set Slideshow Transition Duration:", transitionDuration);
        updateSlideshowSetting("slideshow_transition_duration", transitionDuration);
        slideshow.updateConfig({ transitionDuration });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow show clock control.
 */
const initSlideshowShowClock = () => {
  const root = `${INTEGRATION.root}/slideshow_show_clock`;
  const config = {
    name: "Slideshow Show Clock",
    unique_id: `${INTEGRATION.node}_slideshow_show_clock`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    icon: "mdi:clock",
    device: INTEGRATION.device,
  };

  publishConfig("switch", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const showClock = message.toString() === "ON";
        console.log("Set Slideshow Show Clock:", showClock);
        updateSlideshowSetting("slideshow_show_clock", showClock);
        slideshow.updateConfig({ showClock });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow clock position control.
 */
const initSlideshowClockPosition = () => {
  const root = `${INTEGRATION.root}/slideshow_clock_position`;
  const config = {
    name: "Slideshow Clock Position",
    unique_id: `${INTEGRATION.node}_slideshow_clock_position`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    options: ["top-left", "top-right", "bottom-left", "bottom-right", "center"],
    icon: "mdi:clock-time-four",
    device: INTEGRATION.device,
  };

  publishConfig("select", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const clockPosition = message.toString();
        console.log("Set Slideshow Clock Position:", clockPosition);
        updateSlideshowSetting("slideshow_clock_position", clockPosition);
        slideshow.updateConfig({ clockPosition });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow clock size control.
 */
const initSlideshowClockSize = () => {
  const root = `${INTEGRATION.root}/slideshow_clock_size`;
  const config = {
    name: "Slideshow Clock Size",
    unique_id: `${INTEGRATION.node}_slideshow_clock_size`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    options: ["small", "medium", "large", "xlarge"],
    icon: "mdi:format-size",
    device: INTEGRATION.device,
  };

  publishConfig("select", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const clockSize = message.toString();
        console.log("Set Slideshow Clock Size:", clockSize);
        updateSlideshowSetting("slideshow_clock_size", clockSize);
        slideshow.updateConfig({ clockSize });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow clock background control.
 */
const initSlideshowClockBackground = () => {
  const root = `${INTEGRATION.root}/slideshow_clock_background`;
  const config = {
    name: "Slideshow Clock Background",
    unique_id: `${INTEGRATION.node}_slideshow_clock_background`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    options: ["dark", "light", "none"],
    icon: "mdi:palette",
    device: INTEGRATION.device,
  };

  publishConfig("select", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const clockBackground = message.toString();
        console.log("Set Slideshow Clock Background:", clockBackground);
        updateSlideshowSetting("slideshow_clock_background", clockBackground);
        slideshow.updateConfig({ clockBackground });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow clock opacity control.
 */
const initSlideshowClockOpacity = () => {
  const root = `${INTEGRATION.root}/slideshow_clock_opacity`;
  const config = {
    name: "Slideshow Clock Opacity",
    unique_id: `${INTEGRATION.node}_slideshow_clock_opacity`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value | float }}",
    mode: "slider",
    min: 0.1,
    max: 1.0,
    step: 0.1,
    icon: "mdi:opacity",
    device: INTEGRATION.device,
  };

  publishConfig("number", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const clockOpacity = parseFloat(message.toString());
        console.log("Set Slideshow Clock Opacity:", clockOpacity);
        updateSlideshowSetting("slideshow_clock_opacity", clockOpacity);
        slideshow.updateConfig({ clockOpacity });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow clock color control.
 */
const initSlideshowClockColor = () => {
  const root = `${INTEGRATION.root}/slideshow_clock_color`;
  const config = {
    name: "Slideshow Clock Color",
    unique_id: `${INTEGRATION.node}_slideshow_clock_color`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    icon: "mdi:palette-outline",
    device: INTEGRATION.device,
  };

  publishConfig("text", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const clockColor = message.toString();
        console.log("Set Slideshow Clock Color:", clockColor);
        updateSlideshowSetting("slideshow_clock_color", clockColor);
        slideshow.updateConfig({ clockColor });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow show source control.
 */
const initSlideshowShowSource = () => {
  const root = `${INTEGRATION.root}/slideshow_show_source`;
  const config = {
    name: "Slideshow Show Source",
    unique_id: `${INTEGRATION.node}_slideshow_show_source`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    icon: "mdi:information",
    device: INTEGRATION.device,
  };

  publishConfig("switch", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const showSource = message.toString() === "ON";
        console.log("Set Slideshow Show Source:", showSource);
        updateSlideshowSetting("slideshow_show_source", showSource);
        slideshow.updateConfig({ showSourceIndicator: showSource });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow source position control.
 */
const initSlideshowSourcePosition = () => {
  const root = `${INTEGRATION.root}/slideshow_source_position`;
  const config = {
    name: "Slideshow Source Position",
    unique_id: `${INTEGRATION.node}_slideshow_source_position`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    options: ["top-left", "top-right", "bottom-left", "bottom-right"],
    icon: "mdi:information-outline",
    device: INTEGRATION.device,
  };

  publishConfig("select", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const sourcePosition = message.toString();
        console.log("Set Slideshow Source Position:", sourcePosition);
        updateSlideshowSetting("slideshow_source_position", sourcePosition);
        slideshow.updateConfig({ sourcePosition });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow source size control.
 */
const initSlideshowSourceSize = () => {
  const root = `${INTEGRATION.root}/slideshow_source_size`;
  const config = {
    name: "Slideshow Source Size",
    unique_id: `${INTEGRATION.node}_slideshow_source_size`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    options: ["small", "medium", "large"],
    icon: "mdi:format-size",
    device: INTEGRATION.device,
  };

  publishConfig("select", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const sourceSize = message.toString();
        console.log("Set Slideshow Source Size:", sourceSize);
        updateSlideshowSetting("slideshow_source_size", sourceSize);
        slideshow.updateConfig({ sourceSize });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow source opacity control.
 */
const initSlideshowSourceOpacity = () => {
  const root = `${INTEGRATION.root}/slideshow_source_opacity`;
  const config = {
    name: "Slideshow Source Opacity",
    unique_id: `${INTEGRATION.node}_slideshow_source_opacity`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value | float }}",
    mode: "slider",
    min: 0.1,
    max: 1.0,
    step: 0.1,
    icon: "mdi:opacity",
    device: INTEGRATION.device,
  };

  publishConfig("number", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const sourceOpacity = parseFloat(message.toString());
        console.log("Set Slideshow Source Opacity:", sourceOpacity);
        updateSlideshowSetting("slideshow_source_opacity", sourceOpacity);
        slideshow.updateConfig({ sourceOpacity });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow show counter control.
 */
const initSlideshowShowCounter = () => {
  const root = `${INTEGRATION.root}/slideshow_show_counter`;
  const config = {
    name: "Slideshow Show Counter",
    unique_id: `${INTEGRATION.node}_slideshow_show_counter`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    icon: "mdi:counter",
    device: INTEGRATION.device,
  };

  publishConfig("switch", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const showCounter = message.toString() === "ON";
        console.log("Set Slideshow Show Counter:", showCounter);
        updateSlideshowSetting("slideshow_show_counter", showCounter);
        slideshow.updateConfig({ showPhotoCounter: showCounter });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow counter position control.
 */
const initSlideshowCounterPosition = () => {
  const root = `${INTEGRATION.root}/slideshow_counter_position`;
  const config = {
    name: "Slideshow Counter Position",
    unique_id: `${INTEGRATION.node}_slideshow_counter_position`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    options: ["top-left", "top-right", "bottom-left", "bottom-right"],
    icon: "mdi:counter",
    device: INTEGRATION.device,
  };

  publishConfig("select", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const counterPosition = message.toString();
        console.log("Set Slideshow Counter Position:", counterPosition);
        updateSlideshowSetting("slideshow_counter_position", counterPosition);
        slideshow.updateConfig({ counterPosition });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow counter size control.
 */
const initSlideshowCounterSize = () => {
  const root = `${INTEGRATION.root}/slideshow_counter_size`;
  const config = {
    name: "Slideshow Counter Size",
    unique_id: `${INTEGRATION.node}_slideshow_counter_size`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value }}",
    options: ["small", "medium", "large"],
    icon: "mdi:format-size",
    device: INTEGRATION.device,
  };

  publishConfig("select", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const counterSize = message.toString();
        console.log("Set Slideshow Counter Size:", counterSize);
        updateSlideshowSetting("slideshow_counter_size", counterSize);
        slideshow.updateConfig({ counterSize });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Initializes the slideshow counter opacity control.
 */
const initSlideshowCounterOpacity = () => {
  const root = `${INTEGRATION.root}/slideshow_counter_opacity`;
  const config = {
    name: "Slideshow Counter Opacity",
    unique_id: `${INTEGRATION.node}_slideshow_counter_opacity`,
    command_topic: `${root}/set`,
    state_topic: `${root}/state`,
    value_template: "{{ value | float }}",
    mode: "slider",
    min: 0.1,
    max: 1.0,
    step: 0.1,
    icon: "mdi:opacity",
    device: INTEGRATION.device,
  };

  publishConfig("number", config)
    .on("message", (topic, message) => {
      if (topic === config.command_topic) {
        const counterOpacity = parseFloat(message.toString());
        console.log("Set Slideshow Counter Opacity:", counterOpacity);
        updateSlideshowSetting("slideshow_counter_opacity", counterOpacity);
        slideshow.updateConfig({ counterOpacity });
      }
    })
    .subscribe(config.command_topic);
};

/**
 * Updates a slideshow setting in ARGS and persists to Arguments.json safely.
 * Uses the same approach as install.sh to preserve TouchKio's encryption system.
 */
const updateSlideshowSetting = (key, value) => {
  // Update the ARGS object in memory
  ARGS[key] = value;
  console.log(`Updated runtime ${key}:`, value);

  // Update slideshow runtime config first
  updateSlideshowRuntimeConfig(key, value);

  // Persist to Arguments.json using safe JSON modification (like install.sh)
  const fs = require("fs");
  const path = require("path");
  const argsFilePath = path.join(APP.config, "Arguments.json");

  try {
    // Only persist if Arguments.json exists (follows TouchKio startup pattern)
    if (!fs.existsSync(argsFilePath)) {
      console.log(`Arguments.json not found at ${argsFilePath}, skipping persistence`);
      return;
    }

    // Backup the config file first (following install.sh pattern)
    const backupPath = `${argsFilePath}.backup`;
    fs.copyFileSync(argsFilePath, backupPath);

    // Read current config as text first to preserve formatting
    const configContent = fs.readFileSync(argsFilePath, "utf8");
    const currentConfig = JSON.parse(configContent);

    // Update only the specific key, preserving all other data (including encryption)
    const valueToStore = typeof value === "boolean" ? value.toString() : value;
    currentConfig[key] = valueToStore;

    // Write back with preserved structure (2-space indent like TouchKio)
    fs.writeFileSync(argsFilePath, JSON.stringify(currentConfig, null, 2));
    console.log(`Persisted ${key} to Arguments.json:`, value);

  } catch (error) {
    console.error(`Failed to persist ${key} to Arguments.json:`, error.message);

    // Restore backup if write failed
    const backupPath = `${argsFilePath}.backup`;
    if (fs.existsSync(backupPath)) {
      try {
        fs.copyFileSync(backupPath, argsFilePath);
        console.log("Restored Arguments.json from backup after error");
      } catch (restoreError) {
        console.error("Failed to restore backup:", restoreError.message);
      }
    }
  }
};

/**
 * Updates the slideshow runtime config to keep it in sync with Arguments.json
 */
const updateSlideshowRuntimeConfig = (key, value) => {
  try {
    switch (key) {
      case "slideshow_interval":
        slideshow.updateConfig({ interval: parseInt(value) * 1000 });
        break;
      case "slideshow_idle_timeout":
        slideshow.updateConfig({ idleTimeout: parseFloat(value) * 60000 });
        break;
      case "slideshow_random_order":
        const randomOrder = value === "true" || value === true;
        slideshow.updateConfig({ randomOrder });
        break;
      case "slideshow_photo_fit":
        slideshow.updateConfig({ photoFit: value });
        break;
      case "slideshow_transition_type":
        slideshow.updateConfig({ transitionType: value });
        break;
      case "slideshow_transition_duration":
        slideshow.updateConfig({ transitionDuration: parseInt(value) });
        break;
      case "slideshow_show_clock":
        const showClock = value === "true" || value === true;
        slideshow.updateConfig({ showClock });
        break;
      case "slideshow_show_source":
        const showSource = value === "true" || value === true;
        slideshow.updateConfig({ showSourceIndicator: showSource });
        break;
      case "slideshow_show_counter":
        const showCounter = value === "true" || value === true;
        slideshow.updateConfig({ showPhotoCounter: showCounter });
        break;
      case "slideshow_orientation_mode":
        slideshow.updateConfig({ orientationMode: value });
        break;
      case "slideshow_photos_dir":
        slideshow.updateConfig({ photosDir: value.replace(/^~/, require("os").homedir()) });
        break;
      // Google album settings trigger reload
      case "slideshow_google_album_1":
      case "slideshow_google_album_2":
      case "slideshow_google_album_3":
        slideshow.reloadPhotos();
        break;
      // Clock styling settings
      case "slideshow_clock_position":
        slideshow.updateConfig({ clockPosition: value });
        break;
      case "slideshow_clock_size":
        slideshow.updateConfig({ clockSize: value });
        break;
      case "slideshow_clock_background":
        slideshow.updateConfig({ clockBackground: value });
        break;
      case "slideshow_clock_opacity":
        slideshow.updateConfig({ clockOpacity: parseFloat(value) });
        break;
      case "slideshow_clock_color":
        slideshow.updateConfig({ clockColor: value });
        break;
      // Source indicator styling
      case "slideshow_source_position":
        slideshow.updateConfig({ sourcePosition: value });
        break;
      case "slideshow_source_size":
        slideshow.updateConfig({ sourceSize: value });
        break;
      case "slideshow_source_opacity":
        slideshow.updateConfig({ sourceOpacity: parseFloat(value) });
        break;
      // Counter styling
      case "slideshow_counter_position":
        slideshow.updateConfig({ counterPosition: value });
        break;
      case "slideshow_counter_size":
        slideshow.updateConfig({ counterSize: value });
        break;
      case "slideshow_counter_opacity":
        slideshow.updateConfig({ counterOpacity: parseFloat(value) });
        break;
    }
    console.log(`Synced ${key} to slideshow runtime config:`, value);
  } catch (error) {
    console.error(`Failed to sync ${key} to slideshow runtime config:`, error.message);
  }
};

/**
 * Updates the slideshow status via the mqtt connection.
 */
const updateSlideshow = async () => {
  if (!ARGS.slideshow_enabled || ARGS.slideshow_enabled !== "true") {
    return;
  }

  const status = slideshow.getStatus();

  // Basic slideshow state - use actual runtime state
  publishState("slideshow", status.active ? "ON" : "OFF");
  publishState("slideshow_active", status.active ? "ON" : "OFF");

  // Photo source settings
  const homedir = require("os").homedir();
  const defaultPhotosDir = require("path").join(homedir, "TouchKio-Photo-Screensaver", "photos");
  const photosDir = ARGS.slideshow_photos_dir || defaultPhotosDir;
  const expandedPhotosDir = photosDir.replace(/^~/, homedir);
  publishState("slideshow_photos_dir", expandedPhotosDir);
  // Publish states for all 5 Google album fields
  for (let i = 1; i <= 5; i++) {
    publishState(`slideshow_google_album_${i}`, ARGS[`slideshow_google_album_${i}`] || "");
  }

  // Timing settings - use runtime values as primary, ARGS as fallback
  publishState("slideshow_interval", Math.round(status.config.interval / 1000) || ARGS.slideshow_interval || 5);
  publishState("slideshow_idle_timeout", Math.round(status.config.idleTimeout / 60000) || ARGS.slideshow_idle_timeout || 3);

  // Photo settings - use ARGS as primary since runtime might lag behind
  publishState("slideshow_random_order", (ARGS.slideshow_random_order === "true" || ARGS.slideshow_random_order === true) ? "ON" : "OFF");
  publishState("slideshow_photo_fit", status.config.photoFit || ARGS.slideshow_photo_fit || "contain");
  publishState("slideshow_orientation_mode", status.config.orientationMode || ARGS.slideshow_orientation_mode || "landscape");

  // Transition settings - use runtime values as primary, ARGS as fallback
  publishState("slideshow_transition_type", status.config.transitionType || ARGS.slideshow_transition_type || "fade");
  publishState("slideshow_transition_duration", status.config.transitionDuration || ARGS.slideshow_transition_duration || 2000);

  // Clock settings - use runtime values as primary, ARGS as fallback
  publishState("slideshow_show_clock", status.config.showClock ? "ON" : "OFF");
  publishState("slideshow_clock_position", status.config.clockPosition || ARGS.slideshow_clock_position || "top-right");
  publishState("slideshow_clock_size", status.config.clockSize || ARGS.slideshow_clock_size || "medium");
  publishState("slideshow_clock_background", status.config.clockBackground || ARGS.slideshow_clock_background || "dark");
  publishState("slideshow_clock_opacity", status.config.clockOpacity || ARGS.slideshow_clock_opacity || 0.8);
  publishState("slideshow_clock_color", status.config.clockColor || ARGS.slideshow_clock_color || "#ffffff");

  // Source indicator settings - use runtime values as primary, ARGS as fallback
  publishState("slideshow_show_source", status.config.showSourceIndicator ? "ON" : "OFF");
  publishState("slideshow_source_position", status.config.sourcePosition || ARGS.slideshow_source_position || "bottom-left");
  publishState("slideshow_source_size", status.config.sourceSize || ARGS.slideshow_source_size || "small");
  publishState("slideshow_source_opacity", status.config.sourceOpacity || ARGS.slideshow_source_opacity || 0.7);

  // Counter settings - use runtime values as primary, ARGS as fallback
  publishState("slideshow_show_counter", status.config.showPhotoCounter ? "ON" : "OFF");
  publishState("slideshow_counter_position", status.config.counterPosition || ARGS.slideshow_counter_position || "bottom-right");
  publishState("slideshow_counter_size", status.config.counterSize || ARGS.slideshow_counter_size || "small");
  publishState("slideshow_counter_opacity", status.config.counterOpacity || ARGS.slideshow_counter_opacity || 0.7);
};

module.exports = {
  init,
  update,
};
