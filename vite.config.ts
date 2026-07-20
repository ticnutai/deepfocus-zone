import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
// When BUILD_TARGET=electron, emit relative asset paths so the bundle works
// when loaded via file:// inside the desktop app. Web builds stay absolute.
export default defineConfig(({ mode }) => ({
  base: process.env.BUILD_TARGET === "electron" ? "./" : "/",
  server: {
    host: "::",
    port: 5000,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    process.env.BUILD_TARGET !== "electron" && mode === "production" && VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      devOptions: { enabled: false },
      filename: "sw.js",
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//],
        globPatterns: ["**/*.{js,css,html,woff2,svg,png,ico,json}"],
        globIgnores: ["**/data/reports/full_shas_qna_report.json"],
        // Includes the generated shared question library so the installed PWA
        // can start from a completely cold cache without a network connection.
        maximumFileSizeToCacheInBytes: 80 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // HTML navigations → network first so new deploys land fast.
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "html-pages",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 30, maxAgeSeconds: 86400 },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-api",
              expiration: { maxEntries: 200, maxAgeSeconds: 86400 * 7 },
              networkTimeoutSeconds: 8,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 31536000 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-css" },
          },
          {
            urlPattern: ({ request }) => ["image", "style", "script", "font"].includes(request.destination),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "assets",
              expiration: { maxEntries: 300, maxAgeSeconds: 86400 * 30 },
            },
          },
        ],
      },
      manifest: {
        name: "מעקב למידה",
        short_name: "פשש",
        description: "מערכת לימוד וחזרות",
        theme_color: "#1a1f2e",
        background_color: "#1a1f2e",
        display: "standalone",
        start_url: "/",
        lang: "he",
        dir: "rtl",
        icons: [
          { src: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          const normalized = id.replace(/\\/g, "/");
          // Match only true React core packages (not @radix-ui/react-*, react-router, etc.)
          if (/node_modules\/(react|react-dom|scheduler|react\/jsx-runtime|react\/jsx-dev-runtime)\//.test(normalized)) {
            return "vendor-react";
          }
          if (normalized.includes("@supabase")) return "vendor-supabase";
          if (normalized.includes("@dnd-kit")) return "vendor-dnd";
          if (normalized.includes("date-fns")) return "vendor-date";
          const marker = "node_modules/";
          const idx = normalized.lastIndexOf(marker);
          if (idx === -1) return "vendor-misc";
          const remainder = normalized.slice(idx + marker.length);
          if (!remainder) return "vendor-misc";
          const parts = remainder.split("/");
          const pkg = parts[0].startsWith("@") ? `${parts[0]}-${parts[1] ?? "pkg"}` : parts[0];
          return `vendor-${pkg.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
        },
      },
    },
  },
}));
