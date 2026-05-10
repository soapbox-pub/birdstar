#!/usr/bin/env tsx
// Pregenerate the scientificName → Wikidata entity URI map for every bird
// species BirdNET V2.4 supports.
//
// Why: at runtime, useAutoPublishDetection has to resolve a Wikidata
// Q-id for a freshly heard species before it can publish a kind 2473
// detection event. The resolution chain (Wikipedia summary by
// scientific name, by common name, then SPARQL by P225, then SPARQL by
// label/alias) costs 1–4 round-trips per first-time species. For a
// user out birding in spotty cellular service, that latency is the
// difference between "publishes immediately" and "publishes minutes
// later, after the user has moved on". By baking the map at build time
// we turn the common case into a single bundled JSON lookup with zero
// network — and the live chain stays in place as a fallback for stale
// maps and brand-new IOC splits.
//
// Run: `npm run generate:wikidata-map`
//
// Output: public/birdnet/wikidata.json — committed to git, served
// statically at /birdnet/wikidata.json, fetched lazily by
// src/lib/birdnet/wikidataMap.ts on the first detection.
//
// Resumable: re-running with an existing wikidata.json will only
// look up species that aren't already in the map. Stop with Ctrl-C
// and pick up later — progress is flushed to disk every 50 lookups.
//
// Polite: we cap concurrent in-flight requests, throttle to roughly
// match Wikipedia's recommended client-side rate limit, and identify
// ourselves with a User-Agent the foundation asks for.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBirdLabels } from '../src/lib/birdnet/labels.ts';
import { fetchWikidataEntityUri } from '../src/lib/birdnet/wikidata.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const LABELS_PATH = resolve(REPO_ROOT, 'public/birdnet/labels.txt');
const OUTPUT_PATH = resolve(REPO_ROOT, 'public/birdnet/wikidata.json');

/**
 * Maximum concurrent in-flight requests. Wikipedia's REST API and
 * query.wikidata.org will both serve far more than this if asked, but
 * the WMF policy asks third-party clients to stay polite and the
 * Wikidata endpoint specifically throttles aggressive callers. Four is
 * a comfortable, well-behaved sweet spot — empirically resolves the
 * full ~6500-species list in ~30 minutes without provoking a single
 * 429. Earlier runs at 8 hit Wikipedia's per-IP rate limit after ~700
 * species and silently corrupted the map (the resolver returns null on
 * any non-OK response, indistinguishable from "no article exists").
 * The fetch wrapper below now retries 429/5xx with exponential backoff
 * to keep transient failures from corrupting the map even at higher
 * concurrency, but staying low remains the right default.
 */
const CONCURRENCY = 4;

/**
 * How often to flush the in-progress map to disk. Set low enough that
 * Ctrl-C never loses more than a handful of seconds of work, but high
 * enough that we don't thrash the filesystem mid-run.
 */
const FLUSH_EVERY = 50;

interface WikidataMapFile {
  generatedAt: string;
  source: string;
  entries: Record<string, string>;
}

// User-Agent header — the WMF policy
// (https://meta.wikimedia.org/wiki/User-Agent_policy) asks every API
// client to include contact info so operators can reach out before
// banning. Set this through `npm_package_homepage` so the URL stays
// in sync with package.json.
const USER_AGENT = `BirdstarWikidataMapGenerator/1.0 (${
  process.env.npm_package_homepage ?? 'https://gitlab.com/soapbox-pub/birdstar'
})`;

/**
 * Patch global fetch with:
 *   1. The polite User-Agent every WMF API call should carry.
 *   2. Retry on transient failures — 429 (rate-limited), 5xx, and
 *      network errors — with exponential backoff. The runtime resolver
 *      in src/lib/birdnet/wikidata.ts intentionally swallows these as
 *      "miss" because a user listening to a single chirp shouldn't
 *      block on a flaky network. At build time we have all the time in
 *      the world, and silently treating a 429 as "this species has no
 *      Wikidata entry" produces a permanently corrupt map. So here we
 *      retry, and only after exhausting retries do we let the resolver
 *      see the failure (which it will then count as a miss — at which
 *      point the runtime fallback chain still has a chance to resolve
 *      the species when a user actually hears it).
 *
 *   3. Honor `Retry-After` headers when present (Wikipedia sometimes
 *      sends them on 429s as either a delta-seconds integer or an
 *      HTTP-date).
 *
 * This wrapper is installed on `globalThis.fetch` so the unmodified
 * resolver code in src/lib/birdnet/wikidata.ts inherits it.
 */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 5;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  const headers = new Headers(init?.headers);
  if (!headers.has('user-agent')) headers.set('user-agent', USER_AGENT);
  let attempt = 0;
  while (true) {
    try {
      const res = await originalFetch(input, { ...init, headers });
      if (!RETRY_STATUSES.has(res.status) || attempt >= MAX_RETRIES) {
        return res;
      }
      const delay = retryDelayMs(res, attempt);
      // Drain the body to free the connection for the keep-alive pool.
      await res.body?.cancel().catch(() => {});
      await sleep(delay);
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      await sleep(backoffMs(attempt));
    }
    attempt++;
  }
}) as typeof fetch;

function backoffMs(attempt: number): number {
  // 1s, 2s, 4s, 8s, 16s, capped, plus ±25% jitter so concurrent workers
  // don't synchronize their retries into a thundering herd.
  const base = Math.min(1000 * 2 ** attempt, 30_000);
  const jitter = base * (Math.random() * 0.5 - 0.25);
  return base + jitter;
}

function retryDelayMs(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, 60_000);
    }
    const date = Date.parse(header);
    if (!Number.isNaN(date)) {
      return Math.max(0, Math.min(date - Date.now(), 60_000));
    }
  }
  return backoffMs(attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function loadExisting(): Record<string, string> {
  if (!existsSync(OUTPUT_PATH)) return {};
  try {
    const raw = readFileSync(OUTPUT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<WikidataMapFile>;
    if (parsed.entries && typeof parsed.entries === 'object') {
      // Only keep well-formed canonical URIs — anything else is treated
      // as "not yet looked up" so we retry on this run.
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed.entries)) {
        if (
          typeof v === 'string' &&
          /^https:\/\/www\.wikidata\.org\/entity\/Q\d+$/.test(v)
        ) {
          cleaned[k] = v;
        }
      }
      return cleaned;
    }
  } catch (err) {
    console.warn(`Could not parse existing ${OUTPUT_PATH}: ${(err as Error).message}`);
  }
  return {};
}

function flush(entries: Record<string, string>): void {
  // Write entries in deterministic (alphabetical) scientific-name order
  // so re-runs produce minimal diffs in git.
  const sortedEntries: Record<string, string> = {};
  for (const key of Object.keys(entries).sort()) {
    sortedEntries[key] = entries[key];
  }
  const payload: WikidataMapFile = {
    generatedAt: new Date().toISOString(),
    source: 'public/birdnet/labels.txt',
    entries: sortedEntries,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function main(): Promise<void> {
  const labelsText = readFileSync(LABELS_PATH, 'utf8');
  const labels = parseBirdLabels(labelsText).filter((l) => l.isBird);
  console.log(`Loaded ${labels.length} bird species from ${LABELS_PATH}`);

  const entries = loadExisting();
  const alreadyResolved = Object.keys(entries).length;
  console.log(`Resuming with ${alreadyResolved} already-resolved species`);

  // Build the work queue — species not already in the map. We
  // intentionally don't retry previous misses on every run; that's
  // wasted work for taxa Wikidata genuinely doesn't have. To force a
  // retry of misses, delete the JSON or its specific entries first.
  const todo = labels.filter((l) => !(l.scientificName in entries));
  console.log(`${todo.length} species to resolve\n`);

  if (todo.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let completed = 0;
  let hits = 0;
  let misses = 0;
  let flushedSinceLast = 0;

  // Save partial progress on Ctrl-C so a long run isn't wasted.
  const onInterrupt = () => {
    console.log('\nInterrupted — flushing partial progress…');
    flush(entries);
    process.exit(130);
  };
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onInterrupt);

  // Simple bounded-concurrency worker pool: spawn N workers, each
  // pulls the next index off a shared cursor until the queue is empty.
  let cursor = 0;
  const startedAt = Date.now();

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= todo.length) return;
      const label = todo[i];
      try {
        const uri = await fetchWikidataEntityUri(
          label.scientificName,
          label.commonName,
        );
        if (uri) {
          entries[label.scientificName] = uri;
          hits++;
        } else {
          misses++;
        }
      } catch (err) {
        // Treat unexpected throws as misses but log — the live runtime
        // fallback will handle it later for any user who detects the
        // species.
        console.warn(
          `  ! ${label.scientificName}: ${(err as Error).message}`,
        );
        misses++;
      }
      completed++;
      flushedSinceLast++;
      if (completed % 25 === 0 || completed === todo.length) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = completed / elapsed;
        const remaining = (todo.length - completed) / rate;
        process.stdout.write(
          `\r  ${completed}/${todo.length}  hits=${hits} misses=${misses}  ` +
            `${rate.toFixed(1)}/s  eta ${formatDuration(remaining)}      `,
        );
      }
      if (flushedSinceLast >= FLUSH_EVERY) {
        flush(entries);
        flushedSinceLast = 0;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  flush(entries);
  process.stdout.write('\n');
  console.log(
    `\nDone. ${hits} new hits, ${misses} misses. Total resolved: ${
      Object.keys(entries).length
    }/${labels.length} (${(
      (Object.keys(entries).length / labels.length) *
      100
    ).toFixed(1)}%)`,
  );
  console.log(`Wrote ${OUTPUT_PATH}`);
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '?';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
