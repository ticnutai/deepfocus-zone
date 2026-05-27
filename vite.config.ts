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
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ["**/*.{js,css,html,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/hgjfpwdugvvtrfhycejv\.supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-api",
              expiration: { maxEntries: 50, maxAgeSeconds: 86400 },
              networkTimeoutSeconds: 10,
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 31536000 },
              cacheableResponse: { statuses: [0, 200] },
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
