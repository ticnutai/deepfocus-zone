// Electron main process — desktop wrapper for the Vite/React app.
// Kept fully isolated from the web build: this file is loaded ONLY by Electron.
const { app, BrowserWindow, shell, Menu, protocol, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");

const isDev = process.env.ELECTRON_DEV === "1";
const DEV_URL = process.env.ELECTRON_DEV_URL || "http://localhost:5000";

// ---------------------------------------------------------------------------
// shas:// — offline access to the bundled Shas library (public/shas → dist/shas).
// The renderer is loaded via file://, where fetch() cannot read local JSON, so
// the local-first layer (src/lib/study/localShas.ts) fetches shas://local/<path>
// and we serve the file from the packaged app (asar-aware via fs.readFile).
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  {
    scheme: "shas",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

function registerShasProtocol() {
  const baseDir = isDev
    ? path.join(__dirname, "..", "public", "shas")
    : path.join(__dirname, "..", "dist", "shas");
  protocol.handle("shas", async (request) => {
    try {
      const url = new URL(request.url); // shas://local/<rel>
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const filePath = path.normalize(path.join(baseDir, rel));
      if (!filePath.startsWith(path.normalize(baseDir))) {
        return new Response("forbidden", { status: 403 });
      }
      const data = await fs.promises.readFile(filePath); // asar-aware
      return new Response(data, {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}

let mainWindow = null;

function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("updater:status", status);
  }
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => sendUpdateStatus({ type: "checking" }));
  autoUpdater.on("update-available", (info) => sendUpdateStatus({ type: "available", version: info.version }));
  autoUpdater.on("update-not-available", (info) => sendUpdateStatus({ type: "not-available", version: info.version }));
  autoUpdater.on("download-progress", (progress) => sendUpdateStatus({
    type: "downloading",
    percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
  }));
  autoUpdater.on("update-downloaded", (info) => sendUpdateStatus({ type: "downloaded", version: info.version }));
  autoUpdater.on("error", (error) => sendUpdateStatus({
    type: "error",
    message: error?.message || "בדיקת העדכון נכשלה",
  }));

  ipcMain.handle("updater:get-version", () => app.getVersion());
  ipcMain.handle("updater:check", async () => {
    if (isDev) {
      const status = { type: "development", version: app.getVersion() };
      sendUpdateStatus(status);
      return status;
    }
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (error) {
      const status = { type: "error", message: error?.message || "בדיקת העדכון נכשלה" };
      sendUpdateStatus(status);
      return status;
    }
  });
  ipcMain.handle("updater:download", async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      const status = { type: "error", message: error?.message || "הורדת העדכון נכשלה" };
      sendUpdateStatus(status);
      return status;
    }
  });
  ipcMain.handle("updater:install", () => {
    // NSIS is configured as an assisted installer (oneClick=false). Updates
    // must therefore be launched silently, otherwise the updater closes the
    // app and leaves an invisible/waiting setup wizard in unattended or VM
    // environments.
    autoUpdater.quitAndInstall(true, true);
    return { ok: true };
  });
}

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
    title: "למען",
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

  app.whenReady().then(() => {
    registerShasProtocol();
    configureAutoUpdater();
    createWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
