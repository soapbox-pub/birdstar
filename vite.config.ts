import path from "node:path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

// https://vitejs.dev/config/
export default defineConfig(() => ({
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
      // offline: BirdNET model data (.bin/.txt), the wikidata label map
      // (.json), and audio assets (.m4a).
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
        // BirdNET's TensorFlow.js wasm/model chunks are large; raise the
        // per-file precache ceiling so they're available offline.
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024, // 15 MB
        cleanupOutdatedCaches: true,
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