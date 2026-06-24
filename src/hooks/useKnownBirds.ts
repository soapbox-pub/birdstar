import { useQuery } from '@tanstack/react-query';

import { readAllKnownBirds, type KnownBird } from '@/lib/wiki/knownBirdsStore';

/**
 * Load the local IndexedDB index of birds the user has confirmed or
 * interacted with (heard species, Birdex additions, Wikipedia birds they
 * opened or searched up). Used by `useBirdSearch` as an instant,
 * offline-capable search source that supplements the BirdNET label scan —
 * so a non-BirdNET bird the user confirmed once stays findable without
 * re-hitting the network.
 *
 * Backed by TanStack Query so a single in-memory copy is shared across
 * the app; writers (`rememberKnownBirds`) invalidate the `['known-birds']`
 * query so newly-remembered birds appear in results promptly.
 */
export function useKnownBirds() {
  return useQuery<KnownBird[]>({
    queryKey: ['known-birds'],
    staleTime: 1000 * 30,
    gcTime: Infinity,
    queryFn: () => readAllKnownBirds(),
  });
}
