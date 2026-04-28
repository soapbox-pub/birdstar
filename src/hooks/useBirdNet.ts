// Thin `useContext` wrapper around `BirdNetContext`. The actual worker and
// model lifecycle live in `<BirdNetProvider>` (mounted at the app root), so
// the worker persists across Birds/Stars mode flips and consumers only pay
// the model-load cost once per page load.
//
// History: the worker ownership used to live in this hook. Chrome perf
// traces originally showed main-thread tfjs inference stalling rendering
// for ~156 ms every 2 seconds, so the work was moved into a dedicated Web
// Worker (spawnable natively by Vite via
// `new Worker(new URL(..., import.meta.url))`). That fixed the frame drops
// but introduced a second problem: because the hook lived inside
// `BirdsIndex`, unmounting Birds (e.g. flipping to Stars) terminated the
// worker, so returning to Birds forced a full worker respawn + weight
// deserialization + shader warm-up — about a second of "loading…" per flip.
// Hoisting the worker to a top-level provider fixed that; this hook is
// now just the public API for reading its state.
import { useContext } from 'react';
import { BirdNetContext } from '@/contexts/BirdNetContext';

export function useBirdNet() {
  const ctx = useContext(BirdNetContext);
  if (!ctx) {
    throw new Error('useBirdNet must be used within a <BirdNetProvider>');
  }
  return ctx;
}
