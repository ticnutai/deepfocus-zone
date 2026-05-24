// Electron main process — desktop wrapper for the Vite/React app.
// Kept fully isolated from the web build: this file is loaded ONLY by Electron.
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");

const isDev = process.env.ELECTRON_DEV === "1";
const DEV_URL = process.env.ELECTRON_DEV_URL || "http://localhost:8080";

let mainWindow = null;

function createWindow() {
  const appIconPath = path.join(__dirname, "build", "icon.png");
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0b0b0f",
    title: "פשש",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Hide native menu in production (keep DevTools shortcut available in dev)
  if (!isDev) Menu.setApplicationMenu(null);

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // Web build is emitted to ../dist relative to this file
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    if (process.env.ELECTRON_DEBUG === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  }

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("[electron] did-fail-load", { code, desc, url });
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("[electron] render-process-gone", details);
  });
  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message}  (${sourceId}:${line})`);
  });

  // Hard guard: never allow the renderer to navigate away from our local file.
  // Any external URL (http/https) opens in the system browser instead, which
  // prevents OAuth or stray links from turning the window black.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const isInternal = url.startsWith("file://");
    if (!isInternal) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Open external links in the system browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Single-instance lock so users don't accidentally launch multiple copies
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
