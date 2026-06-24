// NOTE: This file should normally not be modified unless you are adding a new provider.
// To add new routes, edit the AppRouter.tsx file.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHead, UnheadProvider } from '@unhead/react/client';
import { InferSeoMetaPlugin } from 'unhead/plugins';
import { Suspense } from 'react';
import NostrProvider from '@/components/NostrProvider';
import { NostrSync } from '@/components/NostrSync';
import { BirdNetProvider } from '@/components/BirdNetProvider';
import { PWAUpdatePrompt } from '@/components/PWAUpdatePrompt';
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NostrLoginProvider } from '@nostrify/react/login';
import { AppProvider } from '@/components/AppProvider';
import { AppConfig } from '@/contexts/AppContext';
import AppRouter from './AppRouter';

const head = createHead({
  plugins: [
    InferSeoMetaPlugin(),
  ],
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60000, // 1 minute
      gcTime: Infinity,
    },
  },
});

const defaultConfig: AppConfig = {
  // "system" so birds mode respects the OS-level light/dark preference
  // out of the box. Stars mode always forces dark while mounted via
  // `ForceDarkTheme`, regardless of this setting.
  theme: "system",
  relayMetadata: {
    relays: [
      { url: 'wss://relay.ditto.pub/', read: true, write: true },
      { url: 'wss://relay.dreamith.to/', read: true, write: true },
      { url: 'wss://relay.damus.io/', read: false, write: true },
      { url: 'wss://relay.primal.net/', read: false, write: true },
    ],
    updatedAt: 0,
  },
};

export function App() {
  return (
    <UnheadProvider head={head}>
      <AppProvider storageKey="nostr:app-config" defaultConfig={defaultConfig}>
        <QueryClientProvider client={queryClient}>
          <NostrLoginProvider storageKey='nostr:login'>
            <NostrProvider>
              <NostrSync />
              <TooltipProvider>
                <Toaster />
                {/* Prompts the user to reload when a new service worker
                    is available; also registers the service worker for
                    offline support. */}
                <PWAUpdatePrompt />
                <Suspense>
                  {/* BirdNetProvider owns the BirdNET worker + model for
                      the lifetime of the page, so flipping between Birds
                      and Stars mode doesn't tear the worker down and force
                      a model reload on every return to Birds. The worker
                      is still spawned lazily on the first `load()` call,
                      so Stars-only sessions pay nothing. */}
                  <BirdNetProvider>
                    <AppRouter />
                  </BirdNetProvider>
                </Suspense>
              </TooltipProvider>
            </NostrProvider>
          </NostrLoginProvider>
        </QueryClientProvider>
      </AppProvider>
    </UnheadProvider>
  );
}

export default App;
