// Minimal, safe preload bridge. Expand only when the renderer needs OS APIs.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isElectron: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  installation: {
    getPendingEvents: () => ipcRenderer.invoke("installation:get-pending"),
    acknowledge: (eventId) => ipcRenderer.invoke("installation:ack", eventId),
  },
  updates: {
    getVersion: () => ipcRenderer.invoke("updater:get-version"),
    check: () => ipcRenderer.invoke("updater:check"),
    download: () => ipcRenderer.invoke("updater:download"),
    install: () => ipcRenderer.invoke("updater:install"),
    onStatus: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on("updater:status", listener);
      return () => ipcRenderer.removeListener("updater:status", listener);
    },
  },
});
