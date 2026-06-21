import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Sparkles, X } from 'lucide-react';

/**
 * Floating pill that appears when a new service worker is waiting.
 * Clicking it activates the update and reloads the page. This component
 * is also where the service worker gets registered (via `useRegisterSW`),
 * so it must be mounted once, globally.
 */
export function PWAUpdatePrompt() {
  const [dismissed, setDismissed] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      console.log('[PWA] Service worker registered:', swUrl);

      // Check for updates periodically (every hour)
      if (registration) {
        const intervalId = setInterval(async () => {
          try {
            await registration.update();
          } catch (error) {
            // Registration may no longer be valid, clear the interval
            console.warn('[PWA] Failed to check for updates:', error);
            clearInterval(intervalId);
          }
        }, 60 * 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('[PWA] Service worker registration error:', error);
    },
  });

  useEffect(() => {
    if (offlineReady) {
      console.log('[PWA] App ready to work offline');
    }
  }, [offlineReady]);

  const handleUpdate = () => {
    setIsUpdating(true);
    updateServiceWorker(true);
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed(true);
  };

  // Derived directly from `needRefresh` so we don't sync state inside an
  // effect. Re-showing after a fresh `needRefresh` would require resetting
  // `dismissed`, but a waiting SW is a one-shot per page load anyway.
  if (!needRefresh || dismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 md:top-4 md:right-4 md:bottom-auto md:left-auto md:translate-x-0 z-50 motion-safe:animate-in motion-safe:slide-in-from-bottom-4 md:motion-safe:slide-in-from-top-4 duration-500 max-w-full">
      <div className="relative group">
        <button
          onClick={handleUpdate}
          disabled={isUpdating}
          className={`relative flex items-center gap-2 px-4 py-2.5 ${!isUpdating ? 'pr-10' : ''} bg-gradient-to-r from-amber-100 to-yellow-100 dark:from-amber-900 dark:to-yellow-900 border border-amber-300 dark:border-amber-700 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:hover:scale-100 max-w-full truncate`}
        >
          <Sparkles className={`h-4 w-4 text-amber-600 dark:text-amber-400 ${isUpdating ? 'motion-safe:animate-spin' : 'motion-safe:group-hover:rotate-12 transition-transform duration-300'}`} />
          <span className="text-sm font-medium whitespace-nowrap max-w-full truncate text-amber-900 dark:text-amber-100">
            {isUpdating ? 'Updating…' : 'Update available — Click to refresh'}
          </span>
        </button>
        {!isUpdating && (
          <button
            onClick={handleDismiss}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-amber-200 dark:hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 transition-colors duration-200"
            aria-label="Dismiss update notification"
          >
            <X className="h-4 w-4 text-amber-700 dark:text-amber-300" />
          </button>
        )}
      </div>
    </div>
  );
}
