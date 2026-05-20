# Electron Desktop App

This folder contains **only** the desktop wrapper. The web app stays unchanged.

## Layout

| Path | Purpose |
| --- | --- |
| `electron/main.cjs` | Electron main process (window, lifecycle) |
| `electron/preload.cjs` | Safe bridge exposed as `window.desktop` |
| `electron-builder.json` | Installer config (output → `release/`) |
| `dist/` | Web build output (used by both web and desktop) |
| `release/` | Desktop installers — gitignored |

## Scripts

```powershell
# Run desktop app against the live Vite dev server (hot reload)
npm run electron:dev

# Build the web bundle then launch Electron pointing at it (offline test)
npm run electron:preview

# Produce a Windows installer in release/
npm run electron:dist
```

The web app (`npm run dev` / `npm run build`) is **not** affected by any of the above.
