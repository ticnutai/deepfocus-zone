const { existsSync, readdirSync, rmSync } = require("node:fs");
const { join } = require("node:path");

/**
 * Keep the packaged desktop application lean without removing Chromium's
 * graphics fallback. The latter is important on VMs and older Windows PCs.
 */
module.exports = async function afterPack(context) {
  const appRoot = context.appOutDir;
  const localesRoot = join(appRoot, "locales");
  const allowedLocales = new Set(["he.pak", "en-US.pak", "en-GB.pak"]);

  // electronLanguages already filters these. This second pass makes the
  // result deterministic across electron-builder/Electron upgrades.
  if (existsSync(localesRoot)) {
    for (const entry of readdirSync(localesRoot)) {
      if (!allowedLocales.has(entry)) {
        rmSync(join(localesRoot, entry), { force: true });
      }
    }
  }

  // Chromium graphics, software-rendering and media DLLs are intentionally
  // retained. Packaged smoke tests showed that removing FFmpeg can stall the
  // first BrowserWindow load even when the app has no explicit media feature.
};
