import { memo, useCallback, useState } from 'react';
import { Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { SpeciesCell } from '@/components/SpeciesCell';
import { useBirdSearch } from '@/hooks/useBirdSearch';
import type { BirdexEntry } from '@/hooks/useBirdex';
import { cn } from '@/lib/utils';

interface BirdSearchProps {
  /** The user's curated birdex list, so matches inherit real
   *  heard/rare/unconfirmed state instead of a synthetic stub. */
  visibleEntries: BirdexEntry[];
  /** Same handler the birdex grid uses — opens the detail dialog and
   *  pushes the /bird/:slug URL. Must be stable (useCallback). */
  onSelect: (entry: BirdexEntry) => void;
  /** The default birdex grid, shown whenever the search box is empty so
   *  search augments (rather than replaces) the normal experience. */
  children: React.ReactNode;
}

/**
 * Search box over the full BirdNET species list (~6k birds), rendered
 * above the birdex grid. While the box is empty it's a no-op and the
 * normal `children` (the curated birdex grid) shows through; once the
 * user types a usable query the results grid takes over, reusing
 * `SpeciesCell` so hits look and behave exactly like birdex cells —
 * including the heard checkmark / glow / play button for species the
 * user has already logged.
 */
export const BirdSearch = memo(function BirdSearch({
  visibleEntries,
  onSelect,
  children,
}: BirdSearchProps) {
  const [query, setQuery] = useState('');
  const { results, active } = useBirdSearch(query, visibleEntries);

  const clear = useCallback(() => setQuery(''), []);

  return (
    <div>
      <div className="relative mx-auto w-full max-w-md">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 z-10 size-4 -translate-y-1/2 text-stone-400 dark:text-stone-500"
          aria-hidden
        />
        <Input
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all bird species…"
          aria-label="Search bird species"
          className={cn(
            'h-11 rounded-full pl-10 pr-10 text-base',
            'border-stone-300/80 bg-white/70 backdrop-blur-sm',
            'dark:border-indigo-800/40 dark:bg-indigo-950/40',
            // Hide the browser's native search-clear control; we render
            // our own X button so the field doesn't show two of them.
            '[&::-webkit-search-cancel-button]:appearance-none',
          )}
        />
        {query ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className={cn(
              'absolute right-2.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full',
              'text-stone-500 transition-colors hover:bg-stone-200/70 hover:text-stone-700',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60',
              'dark:text-stone-400 dark:hover:bg-indigo-900/60 dark:hover:text-stone-200',
            )}
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {active ? (
        <BirdSearchResults results={results} onSelect={onSelect} />
      ) : (
        children
      )}
    </div>
  );
});

const BirdSearchResults = memo(function BirdSearchResults({
  results,
  onSelect,
}: {
  results: BirdexEntry[];
  onSelect: (entry: BirdexEntry) => void;
}) {
  if (results.length === 0) {
    return (
      <Card className="mt-6 border-dashed bg-white/40 dark:bg-indigo-950/30">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-stone-500 dark:text-stone-400">
            No species match your search. Try a common name (e.g. “robin”) or a
            scientific name.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div
      className={cn(
        'mt-6 grid gap-3 sm:gap-4',
        'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
      )}
    >
      {results.map((entry) => (
        <SpeciesCell key={entry.label.index} entry={entry} onSelect={onSelect} />
      ))}
    </div>
  );
});
