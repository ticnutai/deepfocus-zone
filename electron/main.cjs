// Electron main process — desktop wrapper for the Vite/React app.
// Kept fully isolated from the web build: this file is loaded ONLY by Electron.
const { app, BrowserWindow, shell, Menu, protocol, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const isDev = process.env.ELECTRON_DEV === "1";
const DEV_URL = process.env.ELECTRON_DEV_URL || "http://localhost:5000";

const automatedReportPath = process.env.ELECTRON_E2E_HOME_REPORT
  || process.env.ELECTRON_E2E_SHAS_REPORT
  || process.env.ELECTRON_PERF_SIDEBAR_REPORT;

if (automatedReportPath) {
  const reportKey = crypto.createHash("sha256").update(automatedReportPath).digest("hex").slice(0, 12);
  app.setPath("userData", path.join(app.getPath("temp"), `lemaan-e2e-${reportKey}`));
}

if (automatedReportPath) {
  fs.writeFileSync(`${automatedReportPath}.startup`, JSON.stringify({
    startedAt: new Date().toISOString(),
    isDev,
    devUrl: DEV_URL,
    pid: process.pid,
  }, null, 2), "utf8");
}

function traceE2E(stage, details = {}) {
  const reportPath = automatedReportPath;
  if (!reportPath) return;
  fs.appendFileSync(`${reportPath}.startup`, `\n${JSON.stringify({ stage, at: new Date().toISOString(), ...details })}`, "utf8");
}

async function runSidebarPerformanceBenchmark(window) {
  const reportPath = process.env.ELECTRON_PERF_SIDEBAR_REPORT;
  if (!isDev || !reportPath) return;

  const evaluate = (expression) => window.webContents.executeJavaScript(expression, true);
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    devUrl: DEV_URL,
    runtime: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    viewport: window.getContentBounds(),
    samplesPerTab: 3,
    tabs: [],
    passed: false,
  };

  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const ready = await evaluate(`document.readyState === "complete" && document.querySelectorAll("nav [data-sidebar-id]").length > 0`);
      if (ready) break;
      await delay(250);
    }
    // Authentication/profile hydration can replace the default sidebar with
    // the user's assigned profile shortly after first paint. Measure only the
    // final visible sidebar, not that temporary bootstrap configuration.
    await delay(3000);
    // Trigger one normal navigation before discovery. Some assigned profile
    // configurations finish applying on the first navigation render.
    await evaluate(`(() => {
      const buttons = [...document.querySelectorAll("nav [data-sidebar-id]")];
      const current = buttons.find((button) => button.className.includes("text-primary-foreground"));
      const alternate = buttons.find((button) => button.dataset.sidebarId === "summary")
        || buttons.find((button) => button !== current && button.dataset.sidebarId !== "home");
      alternate?.click();
    })()`);
    await delay(3000);

    const tabs = await evaluate(`([...document.querySelectorAll("nav [data-sidebar-id]")].map((button) => ({
      id: button.dataset.sidebarId,
      label: button.dataset.sidebarLabel || button.textContent.trim()
    })))`);
    if (!tabs.length) throw new Error("No visible sidebar tabs were found");

    for (const tab of tabs) {
      const samples = [];
      for (let sampleIndex = 0; sampleIndex < report.samplesPerTab; sampleIndex += 1) {
        const result = await evaluate(`(async () => {
          const targetId = ${JSON.stringify(tab.id)};
          const buttons = [...document.querySelectorAll("nav [data-sidebar-id]")];
          let target = buttons.find((button) => button.dataset.sidebarId === targetId);
          if (!target) return { error: "tab-not-found" };

          // Move away first so every sample measures a real navigation/render.
          const alternate = buttons.find((button) => button.dataset.sidebarId !== targetId);
          if (alternate) {
            alternate.click();
            // Isolate the target from deferred work started by the previous
            // page. The target's own post-paint blocking remains measured.
            await new Promise((resolve) => setTimeout(resolve, 250));
          }

          // Navigation may remount the sidebar, so never click a stale node.
          target = [...document.querySelectorAll("nav [data-sidebar-id]")]
            .find((button) => button.dataset.sidebarId === targetId);
          if (!target) return { error: "tab-not-found-after-navigation" };

          // Guides and other dialogs can intercept later clicks. Closing them is
          // outside the timed interval and keeps every tab under equal conditions.
          document.querySelectorAll('[role="dialog"] button').forEach((button) => {
            const label = button.getAttribute('aria-label') || button.textContent.trim();
            if (label === 'Close' || label === 'סגור') button.click();
          });

          let mutations = 0;
          const observer = new MutationObserver((records) => { mutations += records.length; });
          // Attribute animations, clocks and progress indicators can update
          // forever. Time-to-settled intentionally tracks content/structure
          // mutations only, which represent actual page loading work.
          observer.observe(document.body, { subtree: true, childList: true, characterData: true });
          const beforeNodes = document.getElementsByTagName('*').length;
          const started = performance.now();
          target.click();
          const dispatchMs = performance.now() - started;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const firstPaintMs = performance.now() - started;

          // Observe a fixed post-paint window. A fixed window is reproducible
          // even on pages with live clocks/data and still exposes excessive
          // late DOM churn through the mutation count.
          await new Promise((resolve) => setTimeout(resolve, 200));
          const settledMs = performance.now() - started;
          observer.disconnect();
          return {
            dispatchMs,
            firstPaintMs,
            settledMs,
            mutations,
            nodeDelta: document.getElementsByTagName('*').length - beforeNodes,
            active: target.className.includes('text-primary-foreground'),
            timedOut: false
          };
        })()`);
        samples.push(result);
        await delay(100);
      }
      report.tabs.push({ ...tab, samples });
    }
    report.passed = report.tabs.every((tab) => tab.samples.every((sample) => !sample.error && sample.active && !sample.timedOut));
  } catch (error) {
    report.error = error?.stack || error?.message || String(error);
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    if (process.env.ELECTRON_E2E_EXIT === "1") app.quit();
  }
}

function logElectron(stage, details = {}) {
  try {
    const logPath = path.join(app.getPath("logs"), "electron-main.log");
    fs.appendFileSync(logPath, `${JSON.stringify({ stage, at: new Date().toISOString(), ...details })}\n`, "utf8");
  } catch {
    // Diagnostics must never be able to crash the desktop application.
  }
}

// Opt-in CDP endpoint for automated development checks. It is never enabled
// in an installed production build unless the environment variable is set.
if (isDev && process.env.ELECTRON_DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  app.commandLine.appendSwitch("remote-debugging-port", process.env.ELECTRON_DEBUG_PORT);
}

// ---------------------------------------------------------------------------
// shas:// — offline access to the bundled Shas library (public/shas → dist/shas).
// The renderer is loaded via file://, where fetch() cannot read local files, so
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
      const isGzip = filePath.endsWith(".gz");
      return new Response(data, {
        status: 200,
        headers: { "Content-Type": isGzip ? "application/gzip" : "application/json; charset=utf-8" },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}

let mainWindow = null;
let installationState = null;

function configureInstallationTracking() {
  const statePath = path.join(app.getPath("userData"), "installation-state.json");
  const currentVersion = app.getVersion();
  try {
    installationState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    installationState = { installId: crypto.randomUUID(), currentVersion: null, pendingEvents: [] };
  }
  installationState.installId ||= crypto.randomUUID();
  installationState.pendingEvents ||= [];
  if (!isDev && installationState.currentVersion !== currentVersion) {
    installationState.pendingEvents.push({
      id: crypto.randomUUID(),
      eventType: installationState.currentVersion ? "update" : "install",
      fromVersion: installationState.currentVersion,
      toVersion: currentVersion,
      installId: installationState.installId,
      occurredAt: new Date().toISOString(),
    });
    installationState.currentVersion = currentVersion;
    fs.writeFileSync(statePath, JSON.stringify(installationState, null, 2), "utf8");
  }
  ipcMain.handle("installation:get-pending", () => isDev ? [] : installationState.pendingEvents);
  ipcMain.handle("installation:ack", (_event, eventId) => {
    installationState.pendingEvents = installationState.pendingEvents.filter((item) => item.id !== eventId);
    fs.writeFileSync(statePath, JSON.stringify(installationState, null, 2), "utf8");
    return { ok: true };
  });
}

function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("updater:status", status);
  }
}

// Mandatory update: once a download finishes, the app installs it
// automatically — the user is notified but cannot skip or cancel it. The
// renderer runs a pre-update backup of everything the user added (cards,
// decks, categories, ...) and then triggers the install itself via the
// "updater:install" IPC handler below. This timer is only a SAFETY NET in
// case the renderer never responds (e.g. it failed to mount) — it guarantees
// the mandatory update still happens even then, just with a generous grace
// period so a normal backup+cloud-sync has time to finish first.
const MANDATORY_INSTALL_DELAY_MS = 120000;
let mandatoryInstallTimer = null;

function configureAutoUpdater() {
  // Silent background download: as soon as a newer version is found, it
  // starts downloading on its own — no user action, and nothing in the
  // renderer can prevent it (there is no "skip" path).
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => sendUpdateStatus({ type: "checking" }));
  autoUpdater.on("update-available", (info) => sendUpdateStatus({ type: "available", version: info.version }));
  autoUpdater.on("update-not-available", (info) => sendUpdateStatus({ type: "not-available", version: info.version }));
  autoUpdater.on("download-progress", (progress) => sendUpdateStatus({
    type: "downloading",
    percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
  }));
  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateStatus({ type: "downloaded", version: info.version, installInMs: MANDATORY_INSTALL_DELAY_MS });
    // Scheduled here (main process), not in the renderer, so the install
    // still happens even if the window is unfocused/minimized/not mounted.
    if (mandatoryInstallTimer) clearTimeout(mandatoryInstallTimer);
    mandatoryInstallTimer = setTimeout(() => {
      // NSIS is an assisted installer (oneClick=false), so silent+force args
      // are required — otherwise the updater leaves an invisible/waiting
      // setup wizard in unattended or VM environments.
      autoUpdater.quitAndInstall(true, true);
    }, MANDATORY_INSTALL_DELAY_MS);
  });
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
    // Renderer is installing now (e.g. right after its pre-update backup
    // finished) — the main-process safety-net timer is no longer needed.
    if (mandatoryInstallTimer) {
      clearTimeout(mandatoryInstallTimer);
      mandatoryInstallTimer = null;
    }
    // NSIS is configured as an assisted installer (oneClick=false). Updates
    // must therefore be launched silently, otherwise the updater closes the
    // app and leaves an invisible/waiting setup wizard in unattended or VM
    // environments.
    autoUpdater.quitAndInstall(true, true);
    return { ok: true };
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runHomeNavigationE2E(window) {
  const reportPath = process.env.ELECTRON_E2E_HOME_REPORT;
  if (!isDev || !reportPath) return;
  traceE2E("e2e-start");

  const report = {
    startedAt: new Date().toISOString(),
    devUrl: DEV_URL,
    steps: [],
    console: [],
    passed: false,
  };

  const debuggerClient = window.webContents.debugger;
  // Keep CDP attached for renderer console collection. Electron's
  // webContents execution bridge is more reliable than Runtime.evaluate on
  // some Windows/Electron combinations while exercising the same renderer.
  const evaluate = (expression) => window.webContents.executeJavaScript(expression, true);

  try {
    if (process.env.ELECTRON_E2E_NO_CDP !== "1") {
      traceE2E("debugger-attach-start");
      if (!debuggerClient.isAttached()) debuggerClient.attach("1.3");
      traceE2E("debugger-attached");
      debuggerClient.on("message", (_event, method, params) => {
        if (method !== "Runtime.consoleAPICalled") return;
        const values = (params.args ?? []).map((arg) => arg.value ?? arg.description ?? "");
        const line = values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" ");
        if (line.includes("[navigation]")) report.console.push(line);
      });
      await debuggerClient.sendCommand("Runtime.enable");
      traceE2E("runtime-enabled");
    }

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const ready = await evaluate(`document.readyState === "complete" && document.body.innerText.length > 100`);
      if (ready) break;
      await delay(250);
    }

    const initial = await evaluate(`({
      location: location.href,
      title: document.title,
      text: document.body.innerText.slice(0, 300)
    })`);
    report.steps.push({ name: "initial", result: initial });

    const openedDecks = await evaluate(`(() => {
      const buttons = [...document.querySelectorAll("nav button")];
      const target = buttons.find((button) => button.textContent.trim() === "יצירת מבחנים");
      if (!target) return { clicked: false, available: buttons.map((button) => button.textContent.trim()) };
      target.click();
      return { clicked: true, label: target.textContent.trim() };
    })()`);
    report.steps.push({ name: "click-decks", result: openedDecks });
    await delay(800);

    const deckScreen = await evaluate(`({
      location: location.href,
      hasDeckHeading: document.body.innerText.includes("יצירת מבחנים"),
      activeNavigation: [...document.querySelectorAll("nav button")]
        .filter((button) => button.className.includes("text-primary-foreground"))
        .map((button) => button.textContent.trim())
    })`);
    report.steps.push({ name: "decks-rendered", result: deckScreen });

    const dismissedGuide = await evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return false;
      const close = [...dialog.querySelectorAll('button')]
        .find((button) => button.textContent.trim() === 'Close' || button.getAttribute('aria-label') === 'Close');
      if (!close) return false;
      close.click();
      return true;
    })()`);
    report.steps.push({ name: "dismiss-guide-if-open", result: dismissedGuide });
    if (dismissedGuide) await delay(350);

    const clickedHome = await evaluate(`(() => {
      const buttons = [...document.querySelectorAll("nav button")];
      const target = buttons.find((button) => button.textContent.trim() === "בית");
      if (!target) return { clicked: false, available: buttons.map((button) => button.textContent.trim()) };
      target.click();
      return { clicked: true, label: target.textContent.trim() };
    })()`);
    report.steps.push({ name: "click-home", result: clickedHome });
    await delay(1000);

    const finalState = await evaluate(`(() => {
      const bodyText = document.body.innerText;
      return {
        location: location.href,
        hasHomeTitle: bodyText.includes("למען תהיה תורת ה' בפיך"),
        selectedHomeTab: [...document.querySelectorAll('[role="tab"][data-state="active"]')]
          .map((tab) => tab.textContent.trim()),
        activeNavigation: [...document.querySelectorAll("nav button")]
          .filter((button) => button.className.includes("text-primary-foreground"))
          .map((button) => button.textContent.trim()),
        visibleUuids: bodyText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/ig) ?? []
      };
    })()`);
    report.steps.push({ name: "home-rendered", result: finalState });
    report.passed = Boolean(
      openedDecks?.clicked
      && deckScreen?.hasDeckHeading
      && clickedHome?.clicked
      && finalState?.hasHomeTitle
      && finalState?.activeNavigation?.includes("בית")
      && finalState?.visibleUuids?.length === 0
    );
  } catch (error) {
    report.error = error?.stack || error?.message || String(error);
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    traceE2E("e2e-finished", { passed: report.passed, reportPath });
    if (process.env.ELECTRON_E2E_EXIT === "1") app.quit();
  }
}

async function runShasStorageE2E(window) {
  const reportPath = process.env.ELECTRON_E2E_SHAS_REPORT;
  if (!reportPath) return;
  const report = { startedAt: new Date().toISOString(), passed: false };
  try {
    const result = await window.webContents.executeJavaScript(`(async () => {
      const started = Date.now();
      const response = await fetch("shas://local/Berakhot.json.gz");
      const bytes = new Uint8Array(await response.arrayBuffer());
      const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      const payload = await new Response(stream).json();
      const amud = payload.amudim?.["2a"];
      return {
        status: response.status,
        isGzip,
        schema: payload.schema_version,
        slug: payload.slug,
        amudId: amud?.id,
        gemaraSegments: amud?.gemara?.length ?? 0,
        elapsedMs: Date.now() - started,
      };
    })()`, true);
    report.result = result;
    report.passed = Boolean(
      result.status === 200
      && result.isGzip
      && result.schema === 3
      && result.slug === "Berakhot"
      && result.gemaraSegments > 0
    );
  } catch (error) {
    report.error = error?.stack || error?.message || String(error);
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    if (process.env.ELECTRON_E2E_EXIT === "1") app.quit();
  }
}

function createWindow() {
  traceE2E("create-window");
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

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    logElectron("did-fail-load", { code, desc, url });
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    logElectron("render-process-gone", details);
  });
  // Register all diagnostics and E2E listeners before navigation starts.
  // localhost can finish loading quickly enough that attaching afterwards
  // intermittently misses did-finish-load and produces no test report.
  if (isDev) {
    traceE2E("load-url-start", { url: DEV_URL });
    const loadPromise = mainWindow.loadURL(DEV_URL);
    if (process.env.ELECTRON_PERF_SIDEBAR_REPORT) {
      void loadPromise
        .then(() => runSidebarPerformanceBenchmark(mainWindow))
        .catch((error) => logElectron("sidebar-perf-load-failed", { message: error?.message || String(error) }));
    } else if (process.env.ELECTRON_E2E_HOME_REPORT) {
      void loadPromise
        .then(() => {
          traceE2E("load-url-complete");
          return runHomeNavigationE2E(mainWindow);
        })
        .catch((error) => logElectron("e2e-load-failed", { message: error?.message || String(error) }));
    } else if (process.env.ELECTRON_E2E_SHAS_REPORT) {
      void loadPromise
        .then(() => runShasStorageE2E(mainWindow))
        .catch((error) => logElectron("shas-e2e-load-failed", { message: error?.message || String(error) }));
    }
    // A detached DevTools window is convenient for manual development, but
    // automated CDP checks do not need a second window.
    if (!process.env.ELECTRON_DEBUG_PORT && !automatedReportPath && process.env.ELECTRON_NO_DEVTOOLS !== "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    // Web build is emitted to ../dist relative to this file
    const loadPromise = mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    if (process.env.ELECTRON_PERF_SIDEBAR_REPORT) {
      void loadPromise
        .then(() => runSidebarPerformanceBenchmark(mainWindow))
        .catch((error) => logElectron("sidebar-perf-load-failed", { message: error?.message || String(error) }));
    } else if (process.env.ELECTRON_E2E_HOME_REPORT) {
      void loadPromise
        .then(() => runHomeNavigationE2E(mainWindow))
        .catch((error) => logElectron("e2e-load-failed", { message: error?.message || String(error) }));
    } else if (process.env.ELECTRON_E2E_SHAS_REPORT) {
      void loadPromise
        .then(() => runShasStorageE2E(mainWindow))
        .catch((error) => logElectron("shas-e2e-load-failed", { message: error?.message || String(error) }));
    }
    if (process.env.ELECTRON_DEBUG === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  }

  // Hard guard: never allow the renderer to navigate away from our local file.
  // Any external URL (http/https) opens in the system browser instead, which
  // prevents OAuth or stray links from turning the window black.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const isInternal = url.startsWith("file://") || (isDev && url.startsWith(DEV_URL));
    if (!isInternal) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!automatedReportPath) mainWindow?.show();
  });

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
// Automated checks run hidden and must not steal focus from, or require
// closing, a user's installed copy of the application.
const gotLock = automatedReportPath ? true : app.requestSingleInstanceLock();
traceE2E("single-instance-lock", { gotLock });
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
    traceE2E("app-ready");
    registerShasProtocol();
    configureInstallationTracking();
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
