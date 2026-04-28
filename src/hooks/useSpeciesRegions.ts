import { useQuery } from '@tanstack/react-query';
import { loadSpeciesRegions, type SpeciesRegionsTable } from '@/lib/birdnet/speciesRegions';
import { useBirdLabels } from '@/hooks/useBirdLabels';

/**
 * Loads the species → continents bitmask table, keyed to the currently-loaded
 * labels file so a mismatch (e.g. bumped model version without regenerating
 * the table) falls back to an empty table rather than silently damping the
 * wrong species.
 *
 * The table is tiny (~6.5 KB) and never changes at runtime, so it's
 * staleTime/gcTime Infinity and doesn't refetch.
 */
export function useSpeciesRegions() {
  const labelsQuery = useBirdLabels();
  const labelCount = labelsQuery.data?.length ?? 0;

  return useQuery<SpeciesRegionsTable>({
    queryKey: ['birdnet-species-regions', labelCount],
    enabled: labelCount > 0,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: () => loadSpeciesRegions(labelCount),
  });
}
