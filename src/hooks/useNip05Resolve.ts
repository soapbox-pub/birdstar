import { useQuery } from '@tanstack/react-query';

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;

/**
 * Resolve a NIP-05 address (`name@domain`, or a bare `domain` meaning
 * `_@domain`) to a hex pubkey via `/.well-known/nostr.json`.
 *
 * Returns `null` when the domain answers but doesn't list the name, and
 * errors when the domain can't be reached (most often a missing CORS
 * header), so callers can tell "no such account" from "couldn't check".
 */
export function useNip05Resolve(address: string | undefined) {
  return useQuery<string | null>({
    queryKey: ['nip05-resolve', address?.toLowerCase() ?? ''],
    queryFn: async ({ signal }) => {
      if (!address) return null;

      const at = address.indexOf('@');
      const name = at === -1 ? '_' : address.slice(0, at);
      const domain = at === -1 ? address : address.slice(at + 1);

      const url = new URL('/.well-known/nostr.json', `https://${domain}`);
      url.searchParams.set('name', name);

      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
      });
      if (!response.ok) throw new Error(`NIP-05 lookup failed (${response.status})`);

      const data: unknown = await response.json();
      if (!data || typeof data !== 'object') return null;
      const names = (data as { names?: unknown }).names;
      if (!names || typeof names !== 'object') return null;

      // Names are case-insensitive in practice even though the spec asks
      // for lowercase, so fall back to a case-insensitive match.
      const record = names as Record<string, unknown>;
      const pubkey =
        record[name] ??
        Object.entries(record).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

      return typeof pubkey === 'string' && HEX_PUBKEY.test(pubkey)
        ? pubkey.toLowerCase()
        : null;
    },
    enabled: !!address,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}

/**
 * The NIP-05 address to display for `pubkey`, or `undefined` until the
 * address has been checked and really does resolve to that pubkey.
 * Anyone can put any address in their profile, so an unverified one is
 * never shown (it would make impersonation trivial). A leading `_@` is
 * dropped, as clients conventionally do.
 */
export function useVerifiedNip05(
  nip05: string | undefined,
  pubkey: string,
): string | undefined {
  const { data } = useNip05Resolve(nip05);
  if (!nip05 || data !== pubkey) return undefined;
  return nip05.replace(/^_@/, '');
}
