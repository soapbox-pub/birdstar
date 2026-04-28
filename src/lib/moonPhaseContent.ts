// Bundled, local descriptions of the six intermediate lunar phases.
//
// Why this exists: the six intermediate phases (both crescents, both
// quarters, both gibbous phases) have no dedicated English Wikipedia
// article — they all redirect to the general "Lunar phase" page. We
// don't want "Lunar phase" to appear anywhere in the UI (phase-
// specific content is what the user asked for), so we vendor the
// relevant facts from Wikipedia's "Principal and intermediate phases
// of the Moon" table directly into the codebase. New moon and full
// moon get their own dedicated Wikipedia articles and are handled
// separately — they don't appear in this file.
//
// Source: Wikipedia, "Lunar phase", section "Principal and
// intermediate phases of the Moon" — and the "Waxing and waning"
// prose for the descriptive paragraphs. Content is licensed under
// CC BY-SA 4.0; see the ATTRIBUTION constant below for the
// acknowledgement string rendered in the UI.
//
// If Wikipedia's content meaningfully improves, refresh this file
// and bump the ATTRIBUTION date. The URL is kept here so reviewers
// can diff against upstream at a glance.

/** The key matches PhaseKey in MoonDetailSheet.tsx, minus new/full. */
export type IntermediatePhaseKey =
  | "waxing-crescent"
  | "first-quarter"
  | "waxing-gibbous"
  | "waning-gibbous"
  | "last-quarter"
  | "waning-crescent";

export interface PhaseContent {
  /**
   * Multi-paragraph description of the phase. Derived from Wikipedia's
   * "Lunar phase" article — specifically the "Waxing and waning" prose
   * intro and the per-row details of the "Principal and intermediate
   * phases of the Moon" table. Written as plain text; no HTML.
   */
  description: string[];
  /** Short label for the illuminated portion (e.g. "50% lit, right side"). */
  illuminated: string;
  /** When in the day/night the phase is typically visible. */
  visibility: string;
  /** Average moonrise time (local, N. Hemisphere convention). */
  moonriseTime: string;
  /** Culmination (highest point) time. */
  culminationTime: string;
  /** Average moonset time. */
  moonsetTime: string;
}

/** Attribution string shown in the UI. CC BY-SA 4.0 per Wikipedia. */
export const WIKIPEDIA_ATTRIBUTION = {
  text: "Adapted from Wikipedia",
  license: "CC BY-SA 4.0",
  sourceUrl:
    "https://en.wikipedia.org/wiki/Lunar_phase#Principal_and_intermediate_phases_of_the_Moon",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
};

export const INTERMEDIATE_PHASE_CONTENT: Record<
  IntermediatePhaseKey,
  PhaseContent
> = {
  "waxing-crescent": {
    description: [
      "The Moon is between new and first quarter. As seen from the northern hemisphere, less than half of the disc is lit on the right-hand side; from the southern hemisphere the lit portion is on the left. The illuminated fraction grows each night.",
      "Because the Moon is only slightly east of the Sun in the sky, it's visible low in the west in the hours just after sunset, then sets within a few hours. When the crescent is thin, the unlit portion of the disc often shows a soft glow known as earthshine — sunlight reflected from Earth's oceans and clouds, bouncing back off the lunar surface.",
    ],
    illuminated: "1–49% lit (right side, Northern Hemisphere)",
    visibility: "Late morning to post-dusk; prominent just after sunset",
    moonriseTime: "~09:00",
    culminationTime: "~15:00",
    moonsetTime: "~21:00",
  },
  "first-quarter": {
    description: [
      "One quarter of the way around its orbit since new moon, the Moon shows exactly half of its disc illuminated — the right-hand half from the northern hemisphere, the left-hand half from the southern. The term \"quarter\" refers to the position in the lunar cycle, not the shape; the silhouette is a half moon.",
      "The first-quarter Moon rises around noon and sets around midnight, placing it high in the southern sky (northern hemisphere) at sunset — the most convenient phase for early-evening observing without late nights.",
    ],
    illuminated: "50% lit (right side, Northern Hemisphere)",
    visibility: "Afternoon and early night",
    moonriseTime: "~12:00",
    culminationTime: "~18:00",
    moonsetTime: "~00:00",
  },
  "waxing-gibbous": {
    description: [
      "Between first quarter and full. More than half of the disc is illuminated and the lit area grows each night, bulging outward — the word \"gibbous\" comes from the Latin gibbōsus, \"humped\". Viewed geometrically, the boundary between light and shadow (the terminator) is now a convex ellipse rather than the concave ellipse of a crescent.",
      "The waxing gibbous Moon rises in the afternoon and is still high in the sky late at night, so it dominates most of the evening. Its brightness washes out all but the brightest stars and is the reason astronomers avoid the days leading up to a full moon for deep-sky observing.",
    ],
    illuminated: "51–99% lit (right side, Northern Hemisphere)",
    visibility: "Late afternoon and most of the night",
    moonriseTime: "~15:00",
    culminationTime: "~21:00",
    moonsetTime: "~03:00",
  },
  "waning-gibbous": {
    description: [
      "Just past full moon and beginning its return toward new. The terminator has crossed over and is now eating into the disc from the left (Northern Hemisphere) — the same gibbous bulge as before, but mirrored, and the illuminated fraction decreases each night.",
      "Rising in the late evening, the waning gibbous Moon is at its highest around 3 a.m. and still up in the morning sky, making it the classic phase seen by anyone awake well before dawn.",
    ],
    illuminated: "99–51% lit (left side, Northern Hemisphere)",
    visibility: "Most of night and early morning",
    moonriseTime: "~21:00",
    culminationTime: "~03:00",
    moonsetTime: "~09:00",
  },
  "last-quarter": {
    description: [
      "Three-quarters of the way around its orbit since new moon. Like the first quarter, exactly half of the disc is illuminated — but this time it's the left-hand half as seen from the northern hemisphere. Also called the third quarter; \"last\" refers to the position in the lunar cycle, not that any part of the Moon is disappearing.",
      "The last-quarter Moon rises around midnight and is high in the south at sunrise. For early risers it's a familiar morning companion, often seen fading against the brightening daytime sky.",
    ],
    illuminated: "50% lit (left side, Northern Hemisphere)",
    visibility: "Late night and morning",
    moonriseTime: "~00:00",
    culminationTime: "~06:00",
    moonsetTime: "~12:00",
  },
  "waning-crescent": {
    description: [
      "The final phase of the lunar cycle before returning to new. Less than half of the disc is lit and the illuminated sliver — on the left (Northern Hemisphere) or right (Southern) — shrinks each night. This is the \"old moon\" of folk tradition: once it's too close to the Sun to be visible, it will emerge a few days later on the opposite side of the Sun as a new waxing crescent.",
      "Visible low in the east in the hours before dawn. As with the waxing crescent, earthshine often makes the unlit portion of the disc glow faintly — most striking against a twilight sky when the Moon and the rising Sun compete for the horizon.",
    ],
    illuminated: "49–1% lit (left side, Northern Hemisphere)",
    visibility: "Pre-dawn to early afternoon",
    moonriseTime: "~03:00",
    culminationTime: "~09:00",
    moonsetTime: "~15:00",
  },
};
