// Resolves a bird's scientific name to an iNaturalist numeric taxon id.
//
// iNat keys all of its data — observations, sound recordings, tile
// overlays — by numeric taxon id. Both the reference-song lookup
// (useBirdSound) and the observation-density map (ObservationMap) need
// to start from the same place: turn "Mimus polyglottos" into the
// integer iNat uses for it.
//
// Extracting this as its own hook lets both features share a single
// cached lookup. TanStack Query dedupes by queryKey, so opening a
// species dialog only makes one /v1/taxa request regardless of how
// many downstream consumers call this hook. The 24-hour staleTime
// matches useBirdSound's — taxon ids are effectively immutable so
// aggressive caching is safe.
//
// Returns null when the species can't be resolved (typically for
// obscure tropical species iNat hasn't cataloged, or genus-level
// BirdNET labels that don't map to a single species). Callers should
// hide any iNat-powered UI in that case rather than erroring.
import { useQuery } from '@tanstack/react-query';

interface InatTaxon {
  id: number;
  rank: string;
  /** iNat uses numeric ids for "iconic taxa"; 3 = Aves. Checking the
   * name string is more forgiving than the id (the field is optional
   * on some records). */
  iconic_taxon_name?: string;
}

/**
 * Look up `scientificName` on iNat's /v1/taxa endpoint and return
 * the first bird-class species match, or null. Shared between
 * useBirdSound and the observation-density map so we don't double up
 * on requests when both features open at the same time.
 */
export async function fetchInatTaxonId(
  scientificName: string,
): Promise<number | null> {
  // `q` is fuzzy; pairing it with `rank=species` and the Aves iconic
  // taxon filter keeps us from matching plants/insects with similar
  // Latin names. `is_active=true` drops historical synonyms.
  const url = new URL('https://api.inaturalist.org/v1/taxa');
  url.searchParams.set('q', scientificName);
  url.searchParams.set('rank', 'species');
  url.searchParams.set('is_active', 'true');
  url.searchParams.set('per_page', '5');

  const res = await fetch(url.toString(), {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: InatTaxon[] };
  const results = data.results ?? [];

  // Prefer an Aves match; fall back to the first species result if
  // iNat didn't tag one (rare for named species). Not all results have
  // iconic_taxon_name populated, so we don't hard-require it.
  const aves = results.find(
    (r) => r.rank === 'species' && r.iconic_taxon_name === 'Aves',
  );
  const firstSpecies = results.find((r) => r.rank === 'species');
  return aves?.id ?? firstSpecies?.id ?? null;
}

export function useInatTaxonId(scientificName: string | null) {
  return useQuery<number | null>({
    queryKey: ['inat-taxon-id', scientificName],
    enabled: Boolean(scientificName),
    // Taxon ids never change. Hard caching also means a dialog open
    // for the same species moments after a previous open is instant,
    // with no network round-trip.
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
    queryFn: async () => {
      if (!scientificName) return null;
      return fetchInatTaxonId(scientificName);
    },
  });
}
