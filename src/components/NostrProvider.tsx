import React, { useEffect, useMemo, useRef } from 'react';
import { type NostrSigner, NostrEvent, NostrFilter, NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { NUser, useNostrLogin } from '@nostrify/react/login';
import { useQueryClient } from '@tanstack/react-query';
import { type IDBPDatabase, openDB } from 'idb';
import { useAppContext } from '@/hooks/useAppContext';
import { AppPool } from '@/lib/AppPool';
import { type EventsDB, EVENTS_STORE, INDEX, NIndexedDB } from '@/lib/NIndexedDB';
import { NostrStorageContext } from '@/contexts/NostrStorageContext';

/*
 * The pool, IndexedDB event store, and AppPool are created exactly once and
 * held in refs as lazy singletons (`ref.current ??= …`). This deliberately
 * reads/writes `ref.current` during render — the standard pattern for a
 * one-time, render-stable instance — so `react-hooks/refs` is disabled for the
 * file. The instances never change after first render, and the refs that the
 * pool callbacks close over (signer, relay metadata) are kept current via the
 * effects below.
 */
/* eslint-disable react-hooks/refs */

interface NostrProviderProps {
  children: React.ReactNode;
}

const NostrProvider: React.FC<NostrProviderProps> = (props) => {
  const { children } = props;
  const { config } = useAppContext();
  const { logins } = useNostrLogin();

  const queryClient = useQueryClient();

  // Use refs so the pool callbacks always see the latest data without
  // recreating the pool. The refs are written from effects (never during
  // render) to satisfy React's purity rules.
  const relayMetadataRef = useRef(config.relayMetadata);

  // Stable ref to the current user's signer for NIP-42 AUTH.
  // The `open()` callback reads from this ref when a relay sends an AUTH
  // challenge, so it always uses the latest signer without recreating the pool.
  const signerRef = useRef<NostrSigner | undefined>(undefined);

  // Open the IndexedDB event store once. It's shared two ways: the AppPool
  // writes the events worth keeping into it (cache-first reads elsewhere), and
  // it's provided through NostrStorageContext so hooks can read it directly.
  // The connection may still be opening — NIndexedDB awaits it internally and
  // degrades to a no-op if IndexedDB is unavailable. The cache is append-only;
  // it is never automatically pruned.
  const eventStore = useRef<NIndexedDB | undefined>(undefined);
  eventStore.current ??= new NIndexedDB(openNostrStorage());

  // Create the NPool only once. Reading the refs above inside its callbacks is
  // safe: the pool is created lazily on the first render and the refs are kept
  // current via the effects below.
  const pool = useRef<NPool | undefined>(undefined);
  pool.current ??= new NPool({
    open(url: string) {
      return new NRelay1(url, {
        // NIP-42: Respond to relay AUTH challenges by signing a kind
        // 22242 ephemeral event with the current user's signer.
        auth: async (challenge: string) => {
          const signer = signerRef.current;
          if (!signer) {
            throw new Error('AUTH failed: no signer available (user not logged in)');
          }
          return signer.signEvent({
            kind: 22242,
            content: '',
            tags: [
              ['relay', url],
              ['challenge', challenge],
            ],
            created_at: Math.floor(Date.now() / 1000),
          });
        },
      });
    },
    reqRouter(filters: NostrFilter[]) {
      const routes = new Map<string, NostrFilter[]>();

      // Route to all read relays
      const readRelays = relayMetadataRef.current.relays
        .filter(r => r.read)
        .map(r => r.url);

      for (const url of readRelays) {
        routes.set(url, filters);
      }

      return routes;
    },
    eventRouter(_event: NostrEvent) {
      // Get write relays from metadata
      const writeRelays = relayMetadataRef.current.relays
        .filter(r => r.write)
        .map(r => r.url);

      const allRelays = new Set<string>(writeRelays);

      return [...allRelays];
    },
    eoseTimeout: 200,
  });

  // Wrap the pool in our app-specific AppPool. It has the same interface as
  // NPool but layers on local caching and transparent request batching:
  // `.query()` calls are intercepted to automatically combine batchable filter
  // patterns (profiles, events by ID, reactions, d-tag lookups) into single
  // REQs, and the events worth keeping are mirrored into the local cache. All
  // other methods pass through directly to the underlying pool.
  const appPool = useRef<AppPool | undefined>(undefined);
  if (!appPool.current && pool.current) {
    appPool.current = new AppPool(pool.current, eventStore.current);
    appPool.current.setLoggedInPubkeys(logins.map((l) => l.pubkey));
  }

  // Keep the AppPool's notion of "who is logged in" current. It uses this to
  // decide which events are worth caching: everything from a logged-in account,
  // plus replaceable events from people those accounts follow.
  useEffect(() => {
    appPool.current?.setLoggedInPubkeys(logins.map((l) => l.pubkey));
  }, [logins]);

  // Derive the current signer from the active login. This mirrors the
  // logic in useCurrentUser but avoids a circular dependency (useCurrentUser
  // depends on NostrContext which we are providing here).
  const currentLogin = logins[0];
  const currentSigner = useMemo(() => {
    if (!currentLogin) return undefined;
    try {
      switch (currentLogin.type) {
        case 'nsec':
          return NUser.fromNsecLogin(currentLogin).signer;
        case 'bunker':
          // pool.current is guaranteed to exist here: it's created
          // synchronously during the first render (above), and useMemo runs
          // after the render body has executed.
          return NUser.fromBunkerLogin(currentLogin, pool.current!).signer;
        case 'extension':
          return NUser.fromExtensionLogin(currentLogin).signer;
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }, [currentLogin]);

  // Keep the ref in sync so the AUTH callback always sees the latest signer.
  // Writing refs from an effect (not during render) satisfies purity rules.
  useEffect(() => {
    signerRef.current = currentSigner;
  }, [currentSigner]);

  // Invalidate Nostr queries when relay metadata changes.
  useEffect(() => {
    relayMetadataRef.current = config.relayMetadata;
    queryClient.invalidateQueries({ queryKey: ['nostr'] });
  }, [config.relayMetadata, queryClient]);

  // Provide the AppPool as the `nostr` object. It has the same interface
  // as NPool, so hooks using `useNostr()` get transparent caching and batching.
  // The `as unknown as NPool` cast is safe because AppPool exposes all the same
  // methods hooks use: query, event, req, relay, group, close.
  const contextValue = useMemo(
    () => ({ nostr: (appPool.current ?? pool.current) as unknown as NPool }),
    [],
  );

  return (
    <NostrContext.Provider value={contextValue}>
      <NostrStorageContext.Provider value={eventStore.current}>
        {children}
      </NostrStorageContext.Provider>
    </NostrContext.Provider>
  );
};

export default NostrProvider;

/**
 * Open (or create) the events cache database. Resolves to the connection, or
 * `null` if IndexedDB is unavailable — passed straight into the `NIndexedDB`
 * constructor, which awaits it internally and degrades to a no-op on `null`.
 */
async function openNostrStorage(): Promise<IDBPDatabase<EventsDB> | null> {
  try {
    return await openDB<EventsDB>('nostr-events', 1, {
      upgrade(db) {
        // Drop any stores from a previous schema and start fresh — the store
        // is a disposable cache (everything re-fetches from relays).
        for (const existing of Array.from(db.objectStoreNames) as string[]) {
          db.deleteObjectStore(existing as typeof EVENTS_STORE);
        }

        const store = db.createObjectStore(EVENTS_STORE, { keyPath: 'id' });
        store.createIndex(INDEX.createdAt, 'created_at');
        store.createIndex(INDEX.pubkey, ['pubkey', 'created_at']);
        store.createIndex(INDEX.kind, ['kind', 'created_at']);
        store.createIndex(INDEX.pubkeyKind, ['pubkey', 'kind', 'created_at']);
        store.createIndex(INDEX.tag, '_tagsCreated', { multiEntry: true });
      },
    });
  } catch {
    // IndexedDB unavailable — degrade to a no-op store.
    return null;
  }
}
