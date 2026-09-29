import { Capacitor } from '@capacitor/core';

/** Public web origin, for links that have to open outside the native app. */
const PUBLIC_ORIGIN = 'https://birdstar.app';

/**
 * Origin to put in links people share (invite links, profile QR codes).
 * On the web it's wherever the app is served from; in the native apps the
 * WebView's origin (`https://localhost`) means nothing to anyone else, so
 * it's the public site instead.
 */
export function shareOrigin(): string {
  if (Capacitor.isNativePlatform() || typeof window === 'undefined') {
    return PUBLIC_ORIGIN;
  }
  return window.location.origin;
}
