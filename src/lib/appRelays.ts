import type { RelayMetadata } from '@/contexts/AppContext';

/**
 * App default relays. Used as the initial `relayMetadata` for new users and as
 * a fallback when the user has no NIP-65 relay list configured (e.g. during
 * nostrconnect handshakes before any user relays have been loaded).
 */
export const APP_RELAYS: RelayMetadata = {
  relays: [
    { url: 'wss://relay.ditto.pub/', read: true, write: true },
    { url: 'wss://relay.dreamith.to/', read: true, write: true },
    { url: 'wss://relay.primal.net/', read: false, write: true },
    { url: 'wss://relay.damus.io/', read: false, write: true },
  ],
  updatedAt: 0,
};

/**
 * Relay used for account search. It supports NIP-50 `search` on kind 0,
 * plus Ditto's `autocomplete:` / `sort:` extensions for typeahead. Queried
 * directly rather than through the pool, because most pool relays either
 * ignore `search` or treat it as a plain filter and return arbitrary
 * profiles.
 */
export const PROFILE_SEARCH_RELAY = 'wss://relay.ditto.pub/';
