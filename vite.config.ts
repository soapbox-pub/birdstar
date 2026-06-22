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
        // Runtime caches for the third-party content both modes pull in:
        // the Wikimedia media bytes (bird/celestial photos, Commons
        // recordings) and the Wikipedia/Wikidata API responses that tell us
        // which media URLs to fetch. All CacheFirst because the content is
        // effectively immutable — a species photo, recording, or its
        // canonical Wikipedia/Wikidata mapping doesn't change — so once
        // fetched it serves from cache and works offline. Kept out of the
        // install precache (it'd bloat it) while still making repeat and
        // offline views instant. The CSP already allows img-src/media-src
        // https: and connect-src the wiki API hosts, so no policy change is
        // needed.
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
          {
            // The Wikipedia/Wikidata API responses that resolve a species to
            // its image, sound, and Wikidata entity URLs. Without caching
            // these, offline Birdex entries never learn the
            // upload.wikimedia.org URL of their photo (the bytes are cached
            // above, but the URL pointing at them isn't known), so the image
            // can't render. Covers:
            //   - en.wikipedia.org/api/rest_v1/page/summary/*  (Birdex image
            //     + extract, useBirdInfo / useWikipediaSummary)
            //   - en.wikipedia.org/api/rest_v1/page/media-list/* (bird sound
            //     discovery, useWikipediaSound)
            //   - en.wikipedia.org/w/api.php?...                (videoinfo
            //     sound URL resolution, useWikipediaSound)
            //   - query.wikidata.org/sparql?...                 (entity URI
            //     resolution, wikidata.ts)
            // CacheFirst because these resolutions are effectively immutable —
            // a species' canonical Wikipedia article and Wikidata entity don't
            // meaningfully change — so once fetched they serve from cache and
            // work offline. Like the media cache, this stays out of the
            // install precache.
            urlPattern: ({ url }: { url: URL }) =>
              (url.hostname === "en.wikipedia.org" &&
                (url.pathname.startsWith("/api/rest_v1/") ||
                  url.pathname === "/w/api.php")) ||
              url.hostname === "query.wikidata.org",
            handler: "CacheFirst",
            options: {
              cacheName: "wiki-api",
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