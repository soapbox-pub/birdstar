// Loads and parses the BirdNET V2.4 species labels file.
// Each line is "Scientific name_Common name". The file also contains a handful
// of non-bird classes (noise, dog, human, etc.) which we expose via isBird().

export interface BirdLabel {
  index: number;
  scientificName: string;
  commonName: string;
  /** True for actual bird species, false for noise / human / machinery classes. */
  isBird: boolean;
}

// Non-bird labels baked into BirdNET V2.4. These are scientificName values.
// BirdNET V2.4 ships a handful of ambient mammals, amphibians and insects
// that vocalize in bird-recording contexts (a dog barking, a frog calling,
// cicadas...); we exclude them from the birdex because the checklist is
// specifically about birds, even though the model itself will detect them.
const NON_BIRD_LABELS = new Set([
  // Synthetic / non-animal classes
  'Dog',
  'Engine',
  'Environmental',
  'Fireworks',
  'Gun',
  'Human non-vocal',
  'Human vocal',
  'Human whistle',
  'Noise',
  'Power tools',
  'Siren',
  // Mammals
  'Canis latrans',             // Coyote
  'Canis lupus',                // Gray Wolf
  'Odocoileus virginianus',     // White-tailed Deer
  'Sciurus carolinensis',       // Eastern Gray Squirrel
  'Tamiasciurus hudsonicus',    // Red Squirrel
  // Insects
  'Apis mellifera',             // Honey Bee
]);

// Non-bird GENERA baked into BirdNET V2.4 (amphibians). Matching at the
// genus level keeps the list compact and catches the ~40 frog/toad
// species without an explicit entry per species. Note: `Hylacola` (a
// real bird genus, Shy Heathwren) deliberately isn't listed — we match
// whole-token prefixes, not substrings, to avoid false positives.
const NON_BIRD_GENERA = new Set([
  'Acris',            // cricket frogs
  'Anaxyrus',          // North American toads
  'Dryophytes',        // treefrogs
  'Eleutherodactylus', // rain frogs
  'Gastrophryne',      // narrow-mouthed toads
  'Lithobates',        // true frogs (American bullfrog etc.)
  'Pseudacris',        // chorus frogs
  'Scaphiopus',        // spadefoot toads
  'Spea',              // spadefoot toads
]);

function isBirdLabel(scientificName: string): boolean {
  if (NON_BIRD_LABELS.has(scientificName)) return false;
  const genus = scientificName.split(' ')[0];
  if (genus && NON_BIRD_GENERA.has(genus)) return false;
  return true;
}

/**
 * Parse a BirdNET labels.txt file (raw text) into BirdLabel entries.
 * Exposed for build-time tooling (scripts/generate-wikidata-map.ts) that
 * needs to consume labels.txt from the filesystem rather than via fetch.
 */
export function parseBirdLabels(text: string): BirdLabel[] {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line, index) => {
      const [scientificName, commonName] = line.split('_');
      return {
        index,
        scientificName: scientificName ?? line,
        commonName: commonName ?? line,
        isBird: isBirdLabel(scientificName ?? ''),
      };
    });
}

let labelsPromise: Promise<BirdLabel[]> | null = null;

export async function loadBirdLabels(): Promise<BirdLabel[]> {
  if (!labelsPromise) {
    labelsPromise = fetch('/birdnet/labels.txt')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load labels: ${r.status}`);
        return r.text();
      })
      .then((text) => parseBirdLabels(text));
  }
  return labelsPromise;
}
