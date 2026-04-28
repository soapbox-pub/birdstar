// Deterministic "bird of the day" picker.
//
// Picks a single species from the BirdNET V2.4 roster for a given
// calendar date. Same input day → same species, for every user, every
// device — the function is pure and seeded off the local date key so a
// user flipping past midnight sees a fresh bird without any network
// call or stored state.
//
// Why this lives next to the Stars/Zodiac UI:
// ─────────────────────────────────────────────────────────────────
// The two halves of Birdstar — Birds (outdoor checklist) and Stars
// (sky map + astrology) — share a user but not much else. The zodiac
// sheet already surfaces a daily horoscope; pairing it with a daily
// bird is a small cross-promotion that nudges stargazers toward the
// bird side of the app without requiring them to switch modes first.
//
// The caller supplies the labels list (via `useBirdLabels()`) and the
// date, and we return a single label drawn from the `isBird` subset
// of the roster. Non-bird classes (noise, human, frogs, etc.) are
// excluded — they're model artifacts, not something a user could go
// spot.

import type { BirdLabel } from "./birdnet/labels";
import { fnv1a, localDateKey, mulberry32 } from "./seededRandom";

/**
 * Pick the bird-of-the-day for a given calendar date.
 *
 * Pure function — same (labels, date) always returns the same label.
 * Returns `null` only when the labels list is empty or contains no
 * `isBird: true` entries; in practice that only happens mid-load when
 * `useBirdLabels()` hasn't resolved yet, and callers should render a
 * skeleton in that case.
 *
 * @param labels Full BirdNET label list from `useBirdLabels()`.
 * @param date  Normally `new Date()`; injectable for tests.
 */
export function birdOfTheDay(
  labels: readonly BirdLabel[],
  date: Date,
): BirdLabel | null {
  // Filter to real birds — BirdNET also labels non-bird classes
  // (Noise, Human vocal, frogs, squirrels) and we don't want "today's
  // bird" to turn out to be a raccoon.
  const birds = labels.filter((l) => l.isBird);
  if (birds.length === 0) return null;

  const dateKey = localDateKey(date);
  const seed = fnv1a(`bird-of-the-day:${dateKey}`);
  const rand = mulberry32(seed);
  return birds[Math.floor(rand() * birds.length)];
}
