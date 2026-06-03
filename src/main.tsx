import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { registerAppServiceWorker } from "./lib/pwa/registerSW";

// On native Android: push WebView below the status bar so content is never hidden behind it
if (Capacitor.isNativePlatform()) {
  StatusBar.setOverlaysWebView({ overlay: false });
  StatusBar.setStyle({ style: Style.Dark });
  StatusBar.setBackgroundColor({ color: "#0f172a" });
}

createRoot(document.getElementById("root")!).render(<App />);

// Full offline support: register the generated service worker in production only
// (guarded against Lovable preview, dev, iframes, and `?sw=off`).
if (!Capacitor.isNativePlatform()) {
  registerAppServiceWorker();
}
