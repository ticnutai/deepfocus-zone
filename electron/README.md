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

# Produce a Windows installer in release/ and publish a GitHub Release.
# This command automatically increments the patch version first
# (for example 2.6.6 -> 2.6.7). If the build fails, it restores 2.6.6.
npm run electron:dist

# Retry publishing the already-built current version without rebuilding.
npm run electron:publish

# Show the next installer version without changing files or building
npm run electron:version:next
```

`electron:dist` is the canonical installer command. It updates both
`package.json` and `package-lock.json`, so the application badge, installer
file name and automatic-update metadata always use the same unique version.
After a successful build it creates (or repairs) the matching public GitHub
Release in `ticnutai/deepfocus-zone` and uploads the installer, blockmap and
`latest.yml`. GitHub CLI must be installed and authenticated (`gh auth login`).

If publishing fails after the installer was created, the new version and local
artifacts are deliberately kept. Restore internet/authentication and run
`npm run electron:publish` to retry the upload without incrementing the version.
For a deliberately local-only installer, run
`node scripts/build-electron-installer.mjs --no-publish`.

The web app (`npm run dev` / `npm run build`) is **not** affected by any of the above.
