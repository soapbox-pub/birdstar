import { useNostr } from '@nostrify/react';
import { useNostrLogin } from '@nostrify/react/login';
import { useQuery } from '@tanstack/react-query';
import { NSchema as n, NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { useNostrStorage } from '@/hooks/useNostrStorage';

export interface Account {
  id: string;
  pubkey: string;
  event?: NostrEvent;
  metadata: NostrMetadata;
}

/** Parse a kind-0 event's content into metadata, or {} on failure. */
function parseMetadata(event: NostrEvent | undefined): NostrMetadata {
  try {
    return n.json().pipe(n.metadata()).parse(event?.content);
  } catch {
    return {};
  }
}

export function useLoggedInAccounts() {
  const { nostr } = useNostr();
  const { store } = useNostrStorage();
  const { logins, setLogin, removeLogin } = useNostrLogin();

  const { data: authors = [] } = useQuery({
    queryKey: ['nostr', 'logins', logins.map((l) => l.id).join(';')],
    queryFn: async ({ signal }) => {
      const pubkeys = logins.map((l) => l.pubkey);

      const events = await nostr.query(
        [{ kinds: [0], authors: pubkeys }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]) },
      );

      // Persist fresh events to the local store (fire-and-forget) so they're
      // available cache-first on the next load.
      for (const event of events) {
        void store.event(event);
      }

      // For any login the relay didn't return a profile for, fall back to the
      // locally cached kind 0. A relay miss (or the 1500ms timeout firing
      // before a slow relay responds) is almost always transient — without
      // this fallback the avatar/name blanks out even though we already have
      // the profile in IndexedDB.
      const byPubkey = new Map<string, NostrEvent>();
      for (const event of events) {
        byPubkey.set(event.pubkey, event);
      }
      await Promise.all(
        pubkeys.map(async (pubkey) => {
          if (byPubkey.has(pubkey)) return;
          const [cached] = await store.query([{ kinds: [0], authors: [pubkey] }]);
          if (cached) byPubkey.set(pubkey, cached);
        }),
      );

      return logins.map(({ id, pubkey }): Account => {
        const event = byPubkey.get(pubkey);
        return { id, pubkey, metadata: parseMetadata(event), event };
      });
    },
    retry: 3,
  });

  // Current user is the first login
  const currentUser: Account | undefined = (() => {
    const login = logins[0];
    if (!login) return undefined;
    const author = authors.find((a) => a.id === login.id);
    return { metadata: {}, ...author, id: login.id, pubkey: login.pubkey };
  })();

  // Other users are all logins except the current one
  const otherUsers = (authors || []).slice(1) as Account[];

  return {
    authors,
    currentUser,
    otherUsers,
    setLogin,
    removeLogin,
  };
}
