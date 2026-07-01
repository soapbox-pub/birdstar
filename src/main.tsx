import { createRoot } from 'react-dom/client';

// Import polyfills first
import './lib/polyfills.ts';

// Fonts for the bird-mode display pairing (Inter for UI, Fraunces for
// the serif headings on the birdex page). Stars mode sticks with the
// system/Inter sans stack.
import '@fontsource-variable/inter/index.css';
import '@fontsource/fraunces/400.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/fraunces/700.css';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { bootstrapNative } from '@/lib/nativeBootstrap';
import App from './App.tsx';
import './index.css';

// Configure native system chrome (status-bar icons, iOS keyboard bar) before
// React mounts so the bars are themed at first paint. No-op on web.
bootstrapNative();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
