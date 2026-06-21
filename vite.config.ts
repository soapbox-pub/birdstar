import { execSync } from "node:child_process";
import path from "node:path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

function getCommitHash(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

// https://vitejs.dev/config/
export default defineConfig(() => ({
  define: {
    __COMMIT_HASH__: JSON.stringify(getCommitHash()),
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt", // the user opts in via the PWAUpdatePrompt pill
      // Use the existing static public/manifest.webmanifest instead of
      // generating one.
      manifest: false,
      // Precache the bundled app plus the static assets both modes need
      // offline: the BirdNET TFJS model weights (model.json + .bin shards,
      // ~49 MB total, downloaded into public/birdnet/model/ at build time),
      // the species/label data (.txt/.bin), the wikidata map (.json), and
      // audio assets (.m4a).
      includeAssets: [
        "favicon.png",
        "birdstar.png",
        "bird-icon.png",
        "whale.png",
        "whale.m4a",
        "birdnet/**/*",
      ],
      workbox: {
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,webp,woff,woff2,wasm,m4a,mp3,bin,txt,json}",
        ],
        // BirdNET weight shards are ~4 MB each; the per-file ceiling just
        // needs headroom above that. There's no cap on total precache size,
        // so the full ~49 MB model is precached for offline inference.
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024, // 15 MB per file
        cleanupOutdatedCaches: true,
        // Runtime cache for Wikimedia media (bird/celestial photos and the
        // Commons-hosted reference recordings shown in the detail sheets).
        // CacheFirst because this content is effectively immutable — a
        // species photo or song recording never changes — so once fetched
        // it's served from cache forever, and works offline. Keeps these
        // bytes out of the install precache (they'd bloat it) while still
        // making repeat and offline views instant. The CSP already allows
        // img-src/media-src https:, so no policy change is needed.
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) =>
              url.hostname === "upload.wikimedia.org",
            handler: "CacheFirst",
            options: {
              cacheName: "wikimedia-media",
              expiration: {
                maxEntries: 2000,
                maxAgeSeconds: 60 * 60 * 24 * 60, // 60 days
                purgeOnQuotaError: true,
              },
              cacheableResponse: {
                // 0 covers opaque responses, 200 the normal CORS case.
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
        type: "module",
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/{vite,eslint}.config.*',
      '.agents/**',
    ],
    onConsoleLog(log) {
      return !log.includes("React Router Future Flag Warning");
    },
    env: {
      DEBUG_PRINT_LIMIT: '0', // Suppress DOM output that exceeds AI context windows
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));