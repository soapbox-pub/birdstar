// Durable "species encountered ever" map for the birdex.
//
// A species gets recorded the first time BirdNET produces a prediction
// for it that clears MIN_RAW_CONFIDENCE (the same floor the rolling-
// window accumulator uses to gate hits into birdHitStore). Unlike the
// raw hit log, this store is never pruned — encountered species show
// up in the birdex's "unconfirmed" section forever, even after the
// raw hits that produced them rotate out of the 24h log.
//
// The hook hydrates once at mount from encounteredSpeciesStore, then
// returns:
//
//   - an in-memory `Map<scientificNameLower, EncounteredSpecies>` the
//     birdex consumes on every render,
//   - a stable `record()` callback that writes through to IndexedDB
//     and optimistically updates the map so a fresh encounter lands
//     in the birdex grid on the very next render (no round-trip).
//
// Writes are idempotent — record() may be called multiple times per
// second on the same species when BirdNET is actively hearing it;
// only `lastSeenAt` moves after the first insert, so the in-memory
// map never churns its identity for species we've already seen.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAllEncountered,
  recordEncounter,
  type EncounteredSpecies,
} from '@/lib/encounteredSpeciesStore';

export interface EncounteredSpeciesApi {
  /**
   * Map keyed by lower-cased scientific name. Identity is stable
   * across renders that only touch `lastSeenAt` on an existing entry,
   * so memoizing on this reference is safe for "set of species"
   * consumers (the birdex) but callers that care about timestamp
   * updates should read through the map each render.
   *
   * Null while the IndexedDB hydrate is in flight, so consumers can
   * distinguish "we don't know yet" from "we know it's empty".
   */
  encountered: Map<string, EncounteredSpecies> | null;

  /**
   * Record (or touch) an encounter. Stable identity across renders
   * so it's safe to stash in a ref inside the accumulator without
   * destabilising the ingest callback.
   */
  record: (input: {
    scientificName: string;
    commonName: string;
    timestamp: number;
  }) => void;
}

export function useEncounteredSpecies(): EncounteredSpeciesApi {
  const [encountered, setEncountered] = useState<
    Map<string, EncounteredSpecies> | null
  >(null);

  // Mirror of `encountered` so the stable `record` callback can read
  // the latest map synchronously without taking it as a dep (which
  // would re-identify record on every encounter and thrash the
  // accumulator's refs).
  const mapRef = useRef<Map<string, EncounteredSpecies> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await getAllEncountered();
      if (cancelled) return;
      const map = new Map<string, EncounteredSpecies>();
      for (const row of rows) {
        map.set(row.scientificName, row);
      }
      mapRef.current = map;
      setEncountered(map);
    })().catch((err) => {
      console.warn('[useEncounteredSpecies] hydrate failed', err);
      if (!cancelled) {
        // Fall back to an empty map so the birdex can still render
        // its starter set rather than sitting forever in "loading".
        const empty = new Map<string, EncounteredSpecies>();
        mapRef.current = empty;
        setEncountered(empty);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const record = useCallback<EncounteredSpeciesApi['record']>(
    ({ scientificName, commonName, timestamp }) => {
      const key = scientificName.toLowerCase();

      // Optimistic in-memory update. The IndexedDB write below is
      // fire-and-forget; we don't want to wait a round-trip before
      // the birdex reflects a fresh encounter.
      setEncountered((prev) => {
        const base =
          prev ??
          mapRef.current ??
          new Map<string, EncounteredSpecies>();
        const existing = base.get(key);
        if (existing) {
          // Only spawn a new Map (and trigger a render) when
          // `lastSeenAt` actually moves forward — repeat hits
          // within the same millisecond are a no-op.
          if (existing.lastSeenAt >= timestamp) {
            mapRef.current = base;
            return base;
          }
          const next = new Map(base);
          next.set(key, { ...existing, lastSeenAt: timestamp });
          mapRef.current = next;
          return next;
        }
        const next = new Map(base);
        next.set(key, {
          scientificName: key,
          scientificNameDisplay: scientificName,
          commonName,
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
        });
        mapRef.current = next;
        return next;
      });

      void recordEncounter({ scientificName, commonName, timestamp });
    },
    [],
  );

  return { encountered, record };
}
