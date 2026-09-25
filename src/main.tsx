import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { Capacitor } from "@capacitor/core";
import { startNativeThemeBars } from "./lib/nativeThemeBars";
import { registerAppServiceWorker } from "./lib/pwa/registerSW";
import { startupCheckpoint } from './lib/debug/startupDiagnostics';

// On native Android: push WebView below the status bar so content is never hidden behind it
if (Capacitor.isNativePlatform()) {
  startupCheckpoint('native:theme-bars:start', 'start');
  startNativeThemeBars();
  startupCheckpoint('native:theme-bars:scheduled');
}

createRoot(document.getElementById("root")!).render(<App />);
startupCheckpoint('react:render-scheduled');

// Full offline support: register the generated service worker in production only
// (guarded against Lovable preview, dev, iframes, and `?sw=off`).
if (!Capacitor.isNativePlatform()) {
  registerAppServiceWorker();
}
