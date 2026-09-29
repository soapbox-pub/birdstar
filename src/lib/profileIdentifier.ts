import { nip19 } from 'nostr-tools';

/**
 * What a string typed or pasted into the account search box points at,
 * beyond a plain name search:
 *
 * - `pubkey` — an `npub1…`, `nprofile1…` (optionally `nostr:`-prefixed),
 *   or a raw 64-char hex key. Resolves to a pubkey synchronously.
 * - `nip05` — `name@domain.tld` (or a bare `domain.tld`, meaning `_@`),
 *   which has to be looked up over HTTP.
 */
export type ProfileIdentifier =
  | { type: 'pubkey'; pubkey: string }
  | { type: 'nip05'; address: string };

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;

/** Parse a search query as a profile identifier, or `null` for a name search. */
export function parseProfileIdentifier(input: string): ProfileIdentifier | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  const value = trimmed.startsWith('nostr:') ? trimmed.slice(6) : trimmed;

  if (value.startsWith('npub1') || value.startsWith('nprofile1')) {
    try {
      const decoded = nip19.decode(value);
      if (decoded.type === 'npub') return { type: 'pubkey', pubkey: decoded.data };
      if (decoded.type === 'nprofile') return { type: 'pubkey', pubkey: decoded.data.pubkey };
    } catch {
      // Half-pasted or mistyped — fall through to a name search.
    }
    return null;
  }

  if (HEX_PUBKEY.test(value)) {
    return { type: 'pubkey', pubkey: value.toLowerCase() };
  }

  const address = value.startsWith('@') ? value.slice(1) : value;
  const at = address.indexOf('@');
  const domain = at === -1 ? address : address.slice(at + 1);
  // Needs a dotted domain with text on both sides of the dot, and a
  // non-empty local part when there is an `@`.
  if (at !== 0 && /^[^.@/]+(\.[^.@/]+)+$/.test(domain)) {
    return { type: 'nip05', address };
  }

  return null;
}
