import { useMemo, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type BrowserKey = 'chrome' | 'firefox' | 'safari' | 'edge' | 'generic';
type Platform = 'desktop' | 'ios' | 'android';

interface DetectedEnv {
  browser: BrowserKey;
  platform: Platform;
  label: string;
}

/**
 * Best-effort user-agent sniff. We're not trying to be perfect — we just want
 * to lead with the most likely instructions. Users on other browsers still
 * see a generic fallback.
 */
function detectEnv(): DetectedEnv {
  if (typeof navigator === 'undefined') {
    return { browser: 'generic', platform: 'desktop', label: 'your browser' };
  }
  const ua = navigator.userAgent;
  const platform: Platform = /iPhone|iPad|iPod/.test(ua)
    ? 'ios'
    : /Android/.test(ua)
      ? 'android'
      : 'desktop';

  // Order matters: Edge and Chrome both contain "Chrome" in their UA.
  let browser: BrowserKey = 'generic';
  let label = 'your browser';
  if (/Edg\//.test(ua)) {
    browser = 'edge';
    label = 'Edge';
  } else if (/Firefox\//.test(ua)) {
    browser = 'firefox';
    label = 'Firefox';
  } else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) {
    browser = 'chrome';
    label = 'Chrome';
  } else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) {
    browser = 'safari';
    label = 'Safari';
  }

  // iOS is always WebKit under the hood regardless of app branding, so the
  // Safari / iOS Settings path is the right guidance.
  if (platform === 'ios') {
    browser = 'safari';
    label = 'Safari (iOS)';
  }

  return { browser, platform, label };
}

interface Instructions {
  title: string;
  steps: ReactNode[];
}

function getInstructions(env: DetectedEnv): Instructions {
  const origin = typeof window !== 'undefined' ? window.location.host : 'this site';

  if (env.platform === 'ios') {
    return {
      title: 'iOS (Safari)',
      steps: [
        <>Open the <strong>Settings</strong> app on your iPhone or iPad.</>,
        <>Scroll down and tap <strong>Safari</strong>.</>,
        <>Tap <strong>Location</strong>, then set it to <strong>Ask</strong> or <strong>Allow</strong>.</>,
        <>Return to this page and reload it.</>,
      ],
    };
  }

  if (env.platform === 'android') {
    return {
      title: 'Android (Chrome)',
      steps: [
        <>Tap the <strong>lock icon</strong> in the address bar.</>,
        <>Tap <strong>Permissions</strong> (or <strong>Site settings</strong>).</>,
        <>Set <strong>Location</strong> to <strong>Allow</strong>.</>,
        <>Reload the page.</>,
      ],
    };
  }

  switch (env.browser) {
    case 'chrome':
    case 'edge':
      return {
        title: env.browser === 'edge' ? 'Edge (desktop)' : 'Chrome (desktop)',
        steps: [
          <>Click the <strong>site info icon</strong> (a padlock or small sliders icon) at the left of the address bar.</>,
          <>Find <strong>Location</strong> in the permissions list.</>,
          <>Switch it to <strong>Allow</strong>.</>,
          <>Reload the page.</>,
        ],
      };
    case 'firefox':
      return {
        title: 'Firefox (desktop)',
        steps: [
          <>Click the <strong>location</strong> icon (with the red slash) at the left of the address bar.</>,
          <>Click the <strong>×</strong> next to "Blocked temporarily" or "Blocked" to clear the setting.</>,
          <>Reload the page. When prompted again, choose <strong>Allow</strong>.</>,
        ],
      };
    case 'safari':
      return {
        title: 'Safari (macOS)',
        steps: [
          <>Open <strong>Safari → Settings</strong> from the menu bar.</>,
          <>Go to the <strong>Websites</strong> tab, then pick <strong>Location</strong> on the left.</>,
          <>Find <strong>{origin}</strong> in the list and set it to <strong>Allow</strong>.</>,
          <>Reload this page.</>,
        ],
      };
    default:
      return {
        title: 'Most browsers',
        steps: [
          <>Look for a <strong>lock</strong> or <strong>location</strong> icon near the address bar.</>,
          <>Open site permissions and set <strong>Location</strong> to <strong>Allow</strong>.</>,
          <>Reload the page.</>,
        ],
      };
  }
}

export interface LocationHelpDialogProps {
  trigger: ReactNode;
}

export function LocationHelpDialog({ trigger }: LocationHelpDialogProps) {
  const env = useMemo(() => detectEnv(), []);
  const primary = useMemo(() => getInstructions(env), [env]);

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enable location access</DialogTitle>
          <DialogDescription>
            Birdstar uses your location to narrow the bird list to species that
            live near you. Your coordinates stay on this device — they're never
            uploaded or published to Nostr.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <section>
            <h3 className="mb-2 font-medium text-stone-900 dark:text-stone-100">
              {primary.title}
            </h3>
            <ol className="list-decimal space-y-1.5 pl-5 text-stone-700 dark:text-stone-300">
              {primary.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </section>

          <p className="text-xs text-stone-500 dark:text-stone-400">
            Using a different browser? The steps are similar: look for a lock or
            location icon near the address bar, open site permissions, and
            switch location to <strong>Allow</strong>.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
