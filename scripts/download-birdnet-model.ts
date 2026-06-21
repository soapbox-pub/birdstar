#!/usr/bin/env tsx
// Download the BirdNET V2.4 TFJS model into public/birdnet/model/ so it
// can be served same-origin and precached by the service worker for
// fully-offline use.
//
// Why: the model weights (~49 MB across model.json + 13 weight shards)
// were previously hotlinked from jsDelivr at runtime. That works online
// and caches into IndexedDB after the first visit, but it can't be
// precached by Workbox (cross-origin) and leaves first-run / offline-
// first installs unable to identify birds without a network round-trip
// to a third-party CDN. Shipping the weights in our own dist makes the
// model part of the precache, so an installed PWA can run BirdNET fully
// offline.
//
// Source + licensing: the weights were converted to TFJS format by the
// Chirpity project (MIT-licensed source, CC-BY-NC-SA-4.0 weights —
// non-commercial use only). We mirror the exact files jsDelivr serves.
//
// Run: `npm run fetch:birdnet-model`
//
// Output: public/birdnet/model/{model.json,group1-shard*.bin} — NOT
// committed to git (see .gitignore); the build downloads them on demand.
//
// Idempotent: re-running skips any file already present with the
// expected size, so the build step is cheap on warm checkouts. Pass
// `--force` to re-download everything.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUTPUT_DIR = resolve(REPO_ROOT, 'public/birdnet/model');

// Pin to the same jsDelivr-served Chirpity export the app loaded at
// runtime before. When bumping to an incompatible upstream model, also
// bump the service-worker precache (it keys on file contents, so changed
// shards are re-fetched automatically) and clear any stale legacy
// IndexedDB copy via clearBirdNetCache in src/lib/birdnet/model.ts.
const MODEL_BASE_URL =
  'https://cdn.jsdelivr.net/gh/Mattk70/Chirpity-Electron@master/BirdNET_GLOBAL_6K_V2.4_Model_TFJS/static/model';

const FORCE = process.argv.includes('--force');

interface WeightsManifestEntry {
  paths: string[];
}
interface ModelJson {
  weightsManifest?: WeightsManifestEntry[];
}

async function fetchToFile(url: string, dest: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return buf.byteLength;
}

/** True if the file exists and (when known) matches the expected size. */
function isPresent(dest: string, expectedBytes?: number): boolean {
  if (FORCE || !existsSync(dest)) return false;
  if (expectedBytes === undefined) return true;
  return statSync(dest).size === expectedBytes;
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. model.json — always (re)fetch when missing; it's small and tells
  //    us which weight shards to pull. When it's already present we read
  //    the local copy so we don't hit the network on warm builds.
  const modelJsonPath = resolve(OUTPUT_DIR, 'model.json');
  if (!isPresent(modelJsonPath)) {
    const bytes = await fetchToFile(`${MODEL_BASE_URL}/model.json`, modelJsonPath);
    console.log(`Downloaded model.json (${(bytes / 1024).toFixed(0)} KB)`);
  } else {
    console.log('model.json already present, skipping');
  }

  const model = JSON.parse(readFileSync(modelJsonPath, 'utf-8')) as ModelJson;
  const shards = (model.weightsManifest ?? []).flatMap((g) => g.paths);
  if (shards.length === 0) {
    throw new Error('model.json has no weightsManifest paths — refusing to continue');
  }

  // 2. Weight shards. Sizes aren't known up-front (the manifest lists
  //    names, not byte counts), so presence-only check unless --force.
  let downloaded = 0;
  for (const shard of shards) {
    const dest = resolve(OUTPUT_DIR, shard);
    if (isPresent(dest)) {
      continue;
    }
    const bytes = await fetchToFile(`${MODEL_BASE_URL}/${shard}`, dest);
    downloaded++;
    console.log(`Downloaded ${shard} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  }

  if (downloaded === 0) {
    console.log(`All ${shards.length} weight shards already present.`);
  }
  console.log(`BirdNET model ready in ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
