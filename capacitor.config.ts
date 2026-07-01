import type { CapacitorConfig } from '@capacitor/cli';

// ── Birdstar native identity ─────────────────────────────────────────────────
// The appId is the reverse-DNS of the birdstar.app domain plus the app name.
// It CANNOT be changed later without re-registering the app with the stores.

const config: CapacitorConfig = {
  appId: 'app.birdstar.app',
  appName: 'Birdstar',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  android: {
    // Disallow loading mixed-content (http:// inside https://).
    allowMixedContent: false,
    // Background color shown behind the web view before first paint.
    // Matches the app's dark background so the splash feels seamless.
    backgroundColor: '#05070f',
  },
  ios: {
    backgroundColor: '#05070f',
    // `never` prevents WKWebView from inset-adjusting scroll content — the
    // app handles safe-area insets itself in CSS via env(safe-area-inset-*).
    contentInset: 'never',
    // Custom URL scheme for deep-links (e.g. `birdstar://…`) — Capacitor
    // registers this in Info.plist's CFBundleURLSchemes on `npx cap sync`.
    scheme: 'birdstar',
  },
  plugins: {
    SystemBars: {
      // Inject --safe-area-inset-* CSS variables on Android to work around
      // a Chromium bug (<140) where env(safe-area-inset-*) reports 0.
      insetsHandling: 'css',
    },
  },
};

export default config;
