import { createRoot } from 'react-dom/client';

// Import polyfills first
import './lib/polyfills.ts';

// Fonts for the bird-mode display pairing (Inter for UI, Fraunces for
// the serif headings on the roster page). Stars mode sticks with the
// system/Inter sans stack.
import '@fontsource-variable/inter/index.css';
import '@fontsource/fraunces/400.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/fraunces/700.css';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
