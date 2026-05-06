import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { MapPin, Settings2 } from 'lucide-react';
import { type Detection } from '@/components/BirdCard';
import {
  BirdInfoDialog,
  type BirdSubject,
} from '@/components/BirdInfoDialog';
import { SpeciesCell } from '@/components/SpeciesCell';
import { LoginArea as LoginAreaRaw } from '@/components/auth/LoginArea';
import { LocationHelpDialog } from '@/components/LocationHelpDialog';
import { CopyrightDialog } from '@/components/CopyrightDialog';
import { LocationDisabledIndicator } from '@/components/LocationDisabledIndicator';
import { LiferCelebration } from '@/components/LiferCelebration';
import { ModeSelector } from '@/components/ModeSelector';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { PlayerBar, type PlayerMode } from '@/components/PlayerBar';
import type { BirdLabel } from '@/lib/birdnet/labels';
import {
  placeSetFor,
  type RegionCode,
  type UserPlaceSet,
} from '@/lib/geo/continent';
import { useBirdNet } from '@/hooks/useBirdNet';
import { useBirdLabels } from '@/hooks/useBirdLabels';
import { useBirdGlowPublisher } from '@/hooks/useBirdGlow';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { SongPlaybackProvider } from '@/components/SongPlaybackProvider';
import { BirdSoundboardProvider } from '@/components/BirdSoundboardProvider';
import { BirdGlowProvider } from '@/components/BirdGlowProvider';
import { useBirdHistory } from '@/hooks/useBirdHistory';
import { useAutoPublishDetection } from '@/hooks/useAutoPublishDetection';
import { useBirdexEvent } from '@/hooks/useBirdexEvent';
import { useDeleteBirdDetection } from '@/hooks/useDeleteBirdDetection';
import {
  useDetectionAccumulator,
  MIN_RAW_CONFIDENCE,
  OUT_OF_REGION_MULTIPLIER,
  type PendingLeader,
} from '@/hooks/useDetectionAccumulator';
import { useUserRegion } from '@/hooks/useUserRegion';
import { useSpeciesRegions } from '@/hooks/useSpeciesRegions';
import { useBirdex, type BirdexEntry } from '@/hooks/useBirdex';
import { useEncounteredSpecies } from '@/hooks/useEncounteredSpecies';
import { useLiferCelebration } from '@/hooks/useLiferCelebration';
import { useLocalSpeciesBands } from '@/hooks/useLocalSpeciesBands';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useNearestObservation } from '@/hooks/useNearestObservation';
import { isSpeciesInRegion } from '@/lib/birdnet/speciesRegions';
import {
  BAND_TO_DAMPING,
  LOCAL_RADII_KM,
  interpolateDamping,
  lookupLocal,
} from '@/lib/inat/localSpecies';
import { fetchInatTaxonId } from '@/hooks/useInatTaxonId';
import { cn } from '@/lib/utils';

// Memoized wrapper around the stock LoginArea component. LoginArea owns
// its own dialog-open state internally; wrapping with memo prevents
// parent-driven re-renders on every ambient tick.
const LoginArea = memo(LoginAreaRaw);

// Manual-picker localStorage key. Stores a UserPlaceSet minus its runtime
// `places` Set (we reconstruct the Set on load via placeSetFor).
const MANUAL_LOCATION_KEY = 'birdsong.manualLocation.v2';

// Settings: opt-in toggle that controls whether auto-published kind 2473
// bird detections carry a NIP-52 `g` tag (coarse geohash). Off by
// default — see Privacy.tsx and NIP.md §"Kind 2473 → Optional → g".
const PUBLISH_LOCATION_KEY = 'birdsong.settings.publishLocation';

// The eight coarse continents the user can choose from as a last-resort
// fallback. MARINE excluded because a user's "location" is never the
// open ocean.
const CONTINENTS: { code: RegionCode; label: string }[] = [
  { code: 'NA', label: 'North America' },
  { code: 'SA', label: 'South America' },
  { code: 'EU', label: 'Europe' },
  { code: 'AF', label: 'Africa' },
  { code: 'AS', label: 'Asia' },
  { code: 'OC', label: 'Oceania' },
  { code: 'AN', label: 'Antarctica' },
];

// Countries the scraper assigns first-class country codes to. Users
// in these countries can narrow their birdex from continent to country.
// Keep in sync with the PLACE_TO_CODES table in
// `scripts/build-species-regions.ts`.
const COUNTRIES: {
  code: string;
  label: string;
  continent: RegionCode;
}[] = [
  // North America
  { code: 'US', label: 'United States', continent: 'NA' },
  { code: 'CA', label: 'Canada', continent: 'NA' },
  { code: 'MX', label: 'Mexico', continent: 'NA' },
  { code: 'GT', label: 'Guatemala', continent: 'NA' },
  { code: 'CR', label: 'Costa Rica', continent: 'NA' },
  { code: 'PA', label: 'Panama', continent: 'NA' },
  { code: 'CU', label: 'Cuba', continent: 'NA' },
  // South America
  { code: 'AR', label: 'Argentina', continent: 'SA' },
  { code: 'BO', label: 'Bolivia', continent: 'SA' },
  { code: 'BR', label: 'Brazil', continent: 'SA' },
  { code: 'CL', label: 'Chile', continent: 'SA' },
  { code: 'CO', label: 'Colombia', continent: 'SA' },
  { code: 'EC', label: 'Ecuador', continent: 'SA' },
  { code: 'PE', label: 'Peru', continent: 'SA' },
  { code: 'UY', label: 'Uruguay', continent: 'SA' },
  { code: 'VE', label: 'Venezuela', continent: 'SA' },
  // Europe
  { code: 'AT', label: 'Austria', continent: 'EU' },
  { code: 'BE', label: 'Belgium', continent: 'EU' },
  { code: 'BG', label: 'Bulgaria', continent: 'EU' },
  { code: 'CH', label: 'Switzerland', continent: 'EU' },
  { code: 'CZ', label: 'Czechia', continent: 'EU' },
  { code: 'DE', label: 'Germany', continent: 'EU' },
  { code: 'DK', label: 'Denmark', continent: 'EU' },
  { code: 'ES', label: 'Spain', continent: 'EU' },
  { code: 'FI', label: 'Finland', continent: 'EU' },
  { code: 'FR', label: 'France', continent: 'EU' },
  { code: 'GB', label: 'United Kingdom', continent: 'EU' },
  { code: 'GR', label: 'Greece', continent: 'EU' },
  { code: 'HU', label: 'Hungary', continent: 'EU' },
  { code: 'IE', label: 'Ireland', continent: 'EU' },
  { code: 'IS', label: 'Iceland', continent: 'EU' },
  { code: 'IT', label: 'Italy', continent: 'EU' },
  { code: 'NL', label: 'Netherlands', continent: 'EU' },
  { code: 'NO', label: 'Norway', continent: 'EU' },
  { code: 'PL', label: 'Poland', continent: 'EU' },
  { code: 'PT', label: 'Portugal', continent: 'EU' },
  { code: 'RO', label: 'Romania', continent: 'EU' },
  { code: 'SE', label: 'Sweden', continent: 'EU' },
  { code: 'UA', label: 'Ukraine', continent: 'EU' },
  // Africa
  { code: 'EG', label: 'Egypt', continent: 'AF' },
  { code: 'KE', label: 'Kenya', continent: 'AF' },
  { code: 'MA', label: 'Morocco', continent: 'AF' },
  { code: 'NG', label: 'Nigeria', continent: 'AF' },
  { code: 'TZ', label: 'Tanzania', continent: 'AF' },
  { code: 'ZA', label: 'South Africa', continent: 'AF' },
  // Asia
  { code: 'CN', label: 'China', continent: 'AS' },
  { code: 'ID', label: 'Indonesia', continent: 'AS' },
  { code: 'IL', label: 'Israel', continent: 'AS' },
  { code: 'IN', label: 'India', continent: 'AS' },
  { code: 'IR', label: 'Iran', continent: 'AS' },
  { code: 'JP', label: 'Japan', continent: 'AS' },
  { code: 'KR', label: 'South Korea', continent: 'AS' },
  { code: 'PH', label: 'Philippines', continent: 'AS' },
  { code: 'PK', label: 'Pakistan', continent: 'AS' },
  { code: 'TH', label: 'Thailand', continent: 'AS' },
  { code: 'TR', label: 'Turkey', continent: 'AS' },
  { code: 'VN', label: 'Vietnam', continent: 'AS' },
  // Oceania
  { code: 'AU', label: 'Australia', continent: 'OC' },
  { code: 'NZ', label: 'New Zealand', continent: 'OC' },
  { code: 'PG', label: 'Papua New Guinea', continent: 'OC' },
];

// Ecoregions and subdivisions the scraper + resolver know about. Grouped
// by country so the manual picker can nest them as an optional second step.
// For the US specifically these are ecoregion codes — "Birds of Texas" etc.
// aren't real Wikipedia categories, but the ecoregion categories are, and
// they give a meaningfully finer split than country-level (Texas users
// in El Paso see different birds than Texas users in Houston).
const SUBDIVISIONS: {
  code: string;
  label: string;
  country: string;
}[] = [
  // US ecoregions
  { code: 'US-E',     label: 'Eastern US (general)',            country: 'US' },
  { code: 'US-NE',    label: 'Northeast (New England + Mid-Atlantic)', country: 'US' },
  { code: 'US-SE',    label: 'Southeast (Gulf + Southern Appalachia)', country: 'US' },
  { code: 'US-MW',    label: 'Plains / Midwest',               country: 'US' },
  { code: 'US-W',     label: 'Western US (general)',           country: 'US' },
  { code: 'US-NW',    label: 'Northwest (inland)',             country: 'US' },
  { code: 'US-WC',    label: 'West Coast',                     country: 'US' },
  { code: 'US-SW',    label: 'Southwest / Desert',             country: 'US' },
  { code: 'US-RM',    label: 'Rocky Mountains',                country: 'US' },
  { code: 'US-TX-RG', label: 'South Texas / Rio Grande valleys', country: 'US' },
  { code: 'US-TX-CD', label: 'Chihuahuan Desert (West Texas)',  country: 'US' },
  { code: 'US-HI',    label: 'Hawaii',                         country: 'US' },
  { code: 'US-AK',    label: 'Alaska',                         country: 'US' },
  // Canadian ecoregions
  { code: 'CA-E',     label: 'Eastern Canada',                 country: 'CA' },
  { code: 'CA-W',     label: 'Western Canada',                 country: 'CA' },
  { code: 'CA-PR',    label: 'Canadian Prairies',              country: 'CA' },
  // Mexican ecoregions
  { code: 'MX-NW',    label: 'Baja California',                country: 'MX' },
  { code: 'MX-NE',    label: 'Northeast Mexico',               country: 'MX' },
  { code: 'MX-W',     label: 'Western Mexico',                 country: 'MX' },
  { code: 'MX-E',     label: 'Eastern Mexico (Gulf)',          country: 'MX' },
  { code: 'MX-C',     label: 'Central Mexico',                 country: 'MX' },
  { code: 'MX-S',     label: 'Southern Mexico / Yucatán',      country: 'MX' },
  // Australian states
  { code: 'AU-ACT', label: 'Australian Capital Territory', country: 'AU' },
  { code: 'AU-NSW', label: 'New South Wales', country: 'AU' },
  { code: 'AU-NT', label: 'Northern Territory', country: 'AU' },
  { code: 'AU-QLD', label: 'Queensland', country: 'AU' },
  { code: 'AU-SA', label: 'South Australia', country: 'AU' },
  { code: 'AU-TAS', label: 'Tasmania', country: 'AU' },
  { code: 'AU-VIC', label: 'Victoria', country: 'AU' },
  { code: 'AU-WA', label: 'Western Australia', country: 'AU' },
  // Indian states
  { code: 'IN-AP', label: 'Andhra Pradesh & Telangana', country: 'IN' },
  { code: 'IN-AS', label: 'Assam', country: 'IN' },
  { code: 'IN-BR', label: 'Bihar', country: 'IN' },
  { code: 'IN-GJ', label: 'Gujarat', country: 'IN' },
  { code: 'IN-HP', label: 'Himachal Pradesh', country: 'IN' },
  { code: 'IN-JK', label: 'Jammu & Kashmir / Ladakh', country: 'IN' },
  { code: 'IN-KA', label: 'Karnataka', country: 'IN' },
  { code: 'IN-KL', label: 'Kerala', country: 'IN' },
  { code: 'IN-MH', label: 'Maharashtra', country: 'IN' },
  { code: 'IN-MP', label: 'Madhya Pradesh', country: 'IN' },
  { code: 'IN-OR', label: 'Odisha', country: 'IN' },
  { code: 'IN-PB', label: 'Punjab', country: 'IN' },
  { code: 'IN-RJ', label: 'Rajasthan', country: 'IN' },
  { code: 'IN-TN', label: 'Tamil Nadu', country: 'IN' },
  { code: 'IN-UP', label: 'Uttar Pradesh', country: 'IN' },
  { code: 'IN-UT', label: 'Uttarakhand', country: 'IN' },
  { code: 'IN-WB', label: 'West Bengal', country: 'IN' },
  // Brazilian states
  { code: 'BR-AM', label: 'Amazonas', country: 'BR' },
  { code: 'BR-BA', label: 'Bahia', country: 'BR' },
  { code: 'BR-MG', label: 'Minas Gerais', country: 'BR' },
  { code: 'BR-PA', label: 'Pará', country: 'BR' },
  { code: 'BR-RJ', label: 'Rio de Janeiro', country: 'BR' },
  { code: 'BR-RS', label: 'Rio Grande do Sul', country: 'BR' },
  { code: 'BR-SP', label: 'São Paulo', country: 'BR' },
];

type Mode = PlayerMode;

interface StoredManualLocation {
  continent: RegionCode;
  country?: string;
  subdivision?: string;
}

function readManualLocation(): StoredManualLocation | null {
  try {
    const raw = localStorage.getItem(MANUAL_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredManualLocation>;
    if (
      typeof parsed?.continent !== 'string' ||
      !CONTINENTS.some((c) => c.code === parsed.continent)
    ) {
      return null;
    }
    return {
      continent: parsed.continent as RegionCode,
      country: typeof parsed.country === 'string' ? parsed.country : undefined,
      subdivision:
        typeof parsed.subdivision === 'string' ? parsed.subdivision : undefined,
    };
  } catch {
    return null;
  }
}

function writeManualLocation(loc: StoredManualLocation | null): void {
  try {
    if (loc) {
      localStorage.setItem(MANUAL_LOCATION_KEY, JSON.stringify(loc));
    } else {
      localStorage.removeItem(MANUAL_LOCATION_KEY);
    }
  } catch {
    // ignore
  }
}

/** Stable key for merging session + history detections. */
function speciesKey(d: { scientificName: string; commonName: string }): string {
  return `${d.scientificName}|${d.commonName}`;
}

const IndexInner = () => {
  useSeoMeta({
    title: 'Birdstar — Go outside. Find the birds. Draw the stars.',
    description:
      'Listen for birds near you. Every species plausibly found where you are shows up as a checklist; hear one and it lights up.',
  });

  const labelsQuery = useBirdLabels();
  const labels = labelsQuery.data;

  const { status, load, predict } = useBirdNet();

  const history = useBirdHistory();
  const birdexEvent = useBirdexEvent();

  // Settings: "Publish location" toggle (off by default). When on,
  // kind 2473 detections get a coarse NIP-52 `g` tag. Persisted so the
  // user's choice survives reloads; the `useAutoPublishDetection` hook
  // picks up changes via refs, so flipping this mid-session only
  // affects subsequent detections.
  const [publishLocation, setPublishLocation] = useLocalStorage<boolean>(
    PUBLISH_LOCATION_KEY,
    false,
  );

  // Location: geolocation wins; manual pick is the fallback; if the
  // user declined geolocation outright we fall back to a continent-
  // level North America default so the birdex still renders. The
  // `LocationDisabledIndicator` mounted at the app root surfaces the
  // denial to the user.
  const {
    placeSet: geoPlaceSet,
    fallbackPlaceSet: geoFallbackPlaceSet,
    coarse,
    status: regionStatus,
    hasDecided: regionHasDecided,
    request: requestRegion,
  } = useUserRegion();

  const { consider: considerPublish } = useAutoPublishDetection({
    lastPublishedAt: history.lastPublishedAt,
    birdexEntries: birdexEvent.entries,
    publishLocation,
    coarse,
  });

  const [manualLocation, setManualLocation] = useState<StoredManualLocation | null>(
    () => readManualLocation(),
  );

  const manualPlaceSet = useMemo<UserPlaceSet | null>(() => {
    if (!manualLocation) return null;
    return placeSetFor(
      manualLocation.continent,
      manualLocation.country,
      manualLocation.subdivision,
    );
  }, [manualLocation]);

  // Resolution order: real geolocation → explicit manual pick →
  // continent-level NA fallback. The fallback is populated from the
  // moment the page mounts (even while geolocation is still
  // prompting), so the birdex renders immediately against a North
  // American default and transparently swaps to the user's actual
  // region once the browser resolves the prompt.
  const placeSet: UserPlaceSet | null =
    geoPlaceSet ?? manualPlaceSet ?? geoFallbackPlaceSet;
  const usingManual = !geoPlaceSet && !!manualPlaceSet;

  const commitManualLocation = useCallback(
    (next: StoredManualLocation | null) => {
      setManualLocation(next);
      writeManualLocation(next);
    },
    [],
  );

  // Controls the rehome overlay shown when a geo-fallback user wants
  // to pick a specific region instead of the continent-level NA
  // default. Mirrors the behavior of manual-pick users clicking
  // their existing location pill.
  const [showRehomeGate, setShowRehomeGate] = useState(false);

  const { data: speciesRegions } = useSpeciesRegions();

  // iNat local-observation signal. Only active when geolocation is
  // granted (useLocalSpeciesBands returns a null map for manual-picker
  // users). This is additive: the birdex and damper both fall back to
  // the .bin-only behavior when the map isn't available.
  const { map: localSpeciesMap } = useLocalSpeciesBands(coarse);

  // Durable record of every species the user has ever heard a
  // qualifying (>= MIN_RAW_CONFIDENCE) prediction for. Drives the
  // birdex's "unconfirmed" bucket — species that produced at least
  // one hit but never accumulated enough evidence to be promoted.
  // The imperative `record` callback is stable across renders; we
  // fire it from the accumulator's per-hit hook below.
  const { encountered, record: recordEncountered } = useEncounteredSpecies();

  // "NEW BIRD DISCOVERED" overlay driver. The hook snapshots the
  // user's known species set (device encountered + logged-in Nostr
  // Birdex) the first time both are ready, then fanfares any
  // confirmed species that wasn't in that baseline. See
  // useLiferCelebration.ts for the full sync-safety argument.
  const {
    consider: considerCelebrate,
    current: liferItem,
    next: dismissLifer,
  } = useLiferCelebration({ encountered });

  // Lazy per-species nearest-observation resolver. Calls `resolve`
  // warm the cache; the damper uses `peek` to read synchronously on
  // the hot path.
  const nearest = useNearestObservation(coarse);

  // In-memory memo of scientific name → iNat taxon id so we only
  // resolve each species once per session (the answer is effectively
  // immutable). Populated asynchronously as species are heard.
  //
  // Value encoding:
  //   number → resolved taxon id
  //   null   → resolved as "iNat has no taxon for this species"
  //   absent → not yet resolved (or resolution failed / in-flight)
  const taxonIdCacheRef = useRef<Map<string, number | null>>(new Map());
  const taxonIdInFlightRef = useRef<Set<string>>(new Set());

  // Graded confidence damper.
  //
  // Priority ladder:
  //   1. Precise distance (km) resolved by nearest.peek(taxonId) —
  //      interpolated damping on a continuous scale. Strongest
  //      signal; available after the lazy /observations call for
  //      this species has completed at least once.
  //   2. Coarse band from the bulk local-species map (25/50/100/
  //      200/500 km). Available after the initial 5-radii fan-out
  //      completes; covers every species observed within 500 km
  //      in the lookback window.
  //   3. .bin ecoregion binary (today's behavior): 1.0× if the
  //      species is in the user's ecoregion, OUT_OF_REGION_MULTIPLIER
  //      otherwise. Never disagrees with iNat — only fills in where
  //      iNat has no data for this species.
  //
  // Absence from iNat is NEVER treated as a penalty beyond what the
  // .bin already says. iNat coverage gaps in rural areas /
  // Global South would otherwise make real birds impossible to
  // confirm.
  const locationAdjuster = useCallback(
    (labelIndex: number, label: BirdLabel) => {
      const inBin = (() => {
        if (!placeSet || !speciesRegions || !speciesRegions.loaded) return true;
        return isSpeciesInRegion(labelIndex, placeSet.places, speciesRegions);
      })();
      const binMultiplier = inBin ? 1 : OUT_OF_REGION_MULTIPLIER;

      if (!localSpeciesMap) return binMultiplier;

      const local = lookupLocal(localSpeciesMap, label.scientificName);
      if (!local || local.band === null) {
        // Species isn't in the iNat bulk map at all — no refinement
        // possible. Use the .bin signal as the last word.
        return binMultiplier;
      }

      // Try for a precise distance from the lazy resolver cache first.
      // If not yet resolved, use the coarse band.
      const taxonId = taxonIdCacheRef.current.get(
        label.scientificName.toLowerCase(),
      );
      if (typeof taxonId === 'number') {
        const preciseKm = nearest.peek(taxonId);
        if (typeof preciseKm === 'number') {
          // Interpolate within the 5-band table for smoother damping
          // than the bulk bands alone could provide.
          return interpolateDamping(preciseKm);
        }
      }

      // Fall back to the bulk band.
      return BAND_TO_DAMPING[local.band];
    },
    [placeSet, speciesRegions, localSpeciesMap, nearest],
  );

  // Warm caches for species the user is actively hearing. Fires from
  // useDetectionAccumulator's ingest on every floored prediction;
  // deduped via the in-flight set + memory caches so repeat hits are
  // effectively free.
  //
  // NOTE: this deliberately does NOT record encounters any more —
  // recording lives on `handleEncounterQualified` below, which fires
  // only once a species' rolling-window sum crosses 60% of the
  // confirmation threshold. Cache-warming stays eager (we want the
  // nearest-observation resolver ready for the NEXT ingest) while
  // "populate the birdex unconfirmed bucket" stays tight.
  const handleSpeciesHit = useCallback(
    (label: BirdLabel) => {
      if (!coarse) return;
      if (!localSpeciesMap) return;
      // Don't bother refining if this species wasn't seen near the
      // user in the bulk survey — nearest observation is > 500 km by
      // construction and the .bin signal is doing the work anyway.
      const local = lookupLocal(localSpeciesMap, label.scientificName);
      if (!local || local.band === null) return;

      // Already at the tightest band — a precise distance can't
      // improve damping (would still map to band 25 → 1.0×).
      if (local.band === LOCAL_RADII_KM[0]) return;

      const key = label.scientificName.toLowerCase();
      const cachedTaxonId = taxonIdCacheRef.current.get(key);
      if (cachedTaxonId === null) return; // known-unresolvable
      if (typeof cachedTaxonId === 'number') {
        // Taxon id known; kick off / rely on the nearest-observation
        // resolver to populate the in-memory cache used by the
        // damper on subsequent ingests.
        if (nearest.peek(cachedTaxonId) !== undefined) return;
        void nearest.resolve(cachedTaxonId);
        return;
      }

      // Resolve taxon id first, then chain into nearest.resolve.
      if (taxonIdInFlightRef.current.has(key)) return;
      taxonIdInFlightRef.current.add(key);
      void fetchInatTaxonId(label.scientificName)
        .then((taxonId) => {
          taxonIdCacheRef.current.set(key, taxonId);
          if (typeof taxonId === 'number') {
            return nearest.resolve(taxonId);
          }
          return null;
        })
        .catch(() => {
          // Don't permanently blacklist on transient errors — just
          // let the next hit retry.
          taxonIdCacheRef.current.delete(key);
        })
        .finally(() => {
          taxonIdInFlightRef.current.delete(key);
        });
    },
    [coarse, localSpeciesMap, nearest],
  );

  // Record a species in the durable encountered-species store that
  // feeds the birdex's "unconfirmed" bucket. Fires only when the
  // accumulator's rolling-window sum for this species crosses
  // ENCOUNTER_QUALIFY_SUM (60% of the confirmation threshold), so
  // the dex's unconfirmed row stays reserved for species that
  // genuinely came close to being confirmed. The store is idempotent
  // + optimistic so repeat crossings cost effectively nothing.
  const handleEncounterQualified = useCallback(
    (
      info: { scientificName: string; commonName: string },
      timestamp: number,
    ) => {
      recordEncountered({
        scientificName: info.scientificName,
        commonName: info.commonName,
        timestamp,
      });
    },
    [recordEncountered],
  );

  const { ingest, confirmedSightings, forgetConfirmed, pendingLeader, latestHit } =
    useDetectionAccumulator({
      onConfirm: (detection) => {
        considerPublish(detection);
        considerCelebrate(detection);
      },
      locationAdjuster,
      onSpeciesHit: handleSpeciesHit,
      onEncounterQualified: handleEncounterQualified,
    });

  const { deleteDetection, pendingIds: deletingIds } = useDeleteBirdDetection();

  const [selectedSubject, setSelectedSubject] = useState<BirdSubject | null>(
    null,
  );

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) setSelectedSubject(null);
  }, []);

  // Keep a live `progress` value flowing into an open pending-subject
  // dialog while the same species keeps accumulating. The dialog
  // doesn't surface the exact percentage anymore (the copy was
  // simplified to just "possible false positive"), but progress is
  // still the value that flips the dialog from "confirmed" styling
  // to the amber "unconfirmed" row, and PlayerBar/other consumers
  // still read it. If the leader switches to a *different* species
  // or clears entirely we leave the dialog alone -- auto-closing or
  // auto-swapping the subject would yank the dialog out from under
  // the user mid-read.
  //
  // Done as an in-render state adjustment keyed on `pendingLeader`
  // identity rather than a setState-in-effect, so we don't eat the
  // react-hooks/set-state-in-effect warning and so the dialog's
  // progress is always consistent with the just-rendered
  // `pendingLeader` (no one-frame lag).
  const [prevLeader, setPrevLeader] = useState<PendingLeader | null>(null);
  if (prevLeader !== pendingLeader) {
    setPrevLeader(pendingLeader);
    if (pendingLeader) {
      setSelectedSubject((prev) => {
        if (prev?.kind !== 'pending') return prev;
        if (prev.label.scientificName !== pendingLeader.scientificName) {
          return prev;
        }
        if (prev.progress === pendingLeader.progress) return prev;
        return { ...prev, progress: pendingLeader.progress };
      });
    }
  }

  const mergedDetections = useMemo<Detection[]>(() => {
    const byKey = new Map<string, Detection>();
    for (const d of history.detections) {
      byKey.set(speciesKey(d), d);
    }
    for (const d of confirmedSightings.values()) {
      const key = speciesKey(d);
      const prior = byKey.get(key);
      if (!prior || d.timestamp >= prior.timestamp) {
        byKey.set(key, { ...d, eventId: d.eventId ?? prior?.eventId });
      }
    }
    return Array.from(byKey.values());
  }, [history.detections, confirmedSightings]);

  const birdex = useBirdex({
    placeSet,
    detections: mergedDetections,
    encountered,
    localSpeciesMap,
  });

  // Minimal (scientificName, commonName) projection of every heard
  // cell in the birdex, for the player bar's Play-all button. Rare
  // (out-of-region) birds are included — per the design, they join
  // the chorus like any other heard bird, differing only in the
  // colour of their per-cell play button. Memoized on birdex.visible
  // so the PlayerBar memo keeps its reference-equality-based skip
  // on idle re-renders (the visible list is itself memoized inside
  // useBirdex).
  const heardTargets = useMemo(
    () =>
      birdex.visible
        .filter((entry) => entry.heard)
        .map((entry) => ({
          scientificName: entry.label.scientificName,
          commonName: entry.label.commonName,
        })),
    [birdex.visible],
  );

  // Selecting a cell opens the info dialog. Unheard cells surface as
  // either plain starter entries or "unconfirmed" (encountered but
  // never promoted). The entry carries its own rare/unconfirmed
  // flags so the dialog can theme itself appropriately without us
  // re-deriving them from range classification.
  const handleSelectBirdex = useCallback((entry: BirdexEntry) => {
    if (entry.detection) {
      setSelectedSubject({ kind: 'detection', detection: entry.detection });
    } else {
      setSelectedSubject({
        kind: 'label',
        label: entry.label,
        isRare: entry.isRare || undefined,
      });
    }
    // Note: `entry.isUnconfirmed` is not threaded into the dialog
    // today — the dialog already treats "label kind, not heard" as
    // its unheard state, which is visually appropriate. If we ever
    // want dedicated copy for encountered-but-unconfirmed birds on
    // the dialog, this is the seam.
  }, []);

  const handleDelete = useCallback(
    async (detection: Detection) => {
      setSelectedSubject(null);
      forgetConfirmed(detection);
      try {
        await deleteDetection(detection);
      } catch {
        // toast handled inside the hook
      }
    },
    [deleteDetection, forgetConfirmed],
  );

  const selectedDetection =
    selectedSubject?.kind === 'detection' ? selectedSubject.detection : null;
  const selectedIsDeleting = Boolean(
    selectedDetection?.eventId && deletingIds.has(selectedDetection.eventId),
  );

  const publishGlow = useBirdGlowPublisher();

  const handleChunk = useCallback(
    async (samples: Float32Array) => {
      if (!labels) return;
      const preds = await predict(samples, 5);
      if (preds.length === 0) return;
      const now = Date.now();

      // Broadcast raw scores to the dex-glow store BEFORE the
      // accumulator filter. We want every bird the user hears
      // (even rare / out-of-region ones) to light up its cell —
      // the cell is already the source of truth for whether it
      // IS in the user's dex, so unmatched species just have no
      // subscriber. Use the same MIN_RAW_CONFIDENCE floor the
      // accumulator uses so the glow only reflects readings the
      // detection system considers plausible.
      const glowBatch: { scientificName: string; score: number }[] = [];
      for (const pred of preds) {
        const label = labels[pred.index];
        if (!label || !label.isBird) continue;
        if (pred.score < MIN_RAW_CONFIDENCE) continue;
        glowBatch.push({
          scientificName: label.scientificName,
          score: pred.score,
        });
      }
      if (glowBatch.length > 0) publishGlow(glowBatch);

      for (const pred of preds) {
        const label = labels[pred.index];
        if (!label || !label.isBird) continue;
        if (pred.score < MIN_RAW_CONFIDENCE) continue;
        ingest(pred, label, now);
      }
    },
    [labels, predict, ingest, publishGlow],
  );

  const recorder = useAudioRecorder({ onChunk: handleChunk, predictEveryMs: 2000 });

  const [userPaused, setUserPaused] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  // Clear the "starting" spinner once the recorder actually starts
  // (or reports an error). Done as an in-render adjustment keyed on
  // the recorder status, rather than a setState-in-effect — it's a
  // pure state clear conditional on prop values, so it fits React's
  // "adjust state during render" pattern precisely.
  if (isStarting && (recorder.isRecording || recorder.error)) {
    setIsStarting(false);
  }

  const mode: Mode = useMemo(() => {
    if (status.state === 'error' || recorder.error) return 'error';
    if (status.state === 'loading') return 'loading';
    if (recorder.isRecording || isStarting) return 'listening';
    if (status.state === 'ready' && userPaused) return 'paused';
    if (status.state === 'ready') return 'ready-idle';
    return 'idle';
  }, [status, recorder.error, recorder.isRecording, userPaused, isStarting]);

  useEffect(() => {
    load();
  }, [load]);

  const hasAutoStartedRef = useRef(false);
  useEffect(() => {
    if (
      status.state === 'ready' &&
      !recorder.isRecording &&
      !recorder.error &&
      !userPaused &&
      !hasAutoStartedRef.current
    ) {
      hasAutoStartedRef.current = true;
      setIsStarting(true);
      void recorder.start();
    }
  }, [status.state, recorder, userPaused]);

  const handlePause = useCallback(() => {
    setUserPaused(true);
    setIsStarting(false);
    recorder.stop();
  }, [recorder]);

  const handleResume = useCallback(() => {
    setUserPaused(false);
    if (status.state === 'ready' && !recorder.isRecording) {
      setIsStarting(true);
      void recorder.start();
    }
  }, [status.state, recorder]);

  const handleRetry = useCallback(() => {
    hasAutoStartedRef.current = false;
    setUserPaused(false);
    if (status.state === 'error') {
      load();
    } else if (status.state === 'ready' && !recorder.isRecording) {
      setIsStarting(true);
      void recorder.start();
    }
  }, [status.state, recorder, load]);

  const loadingPct =
    status.state === 'loading' ? Math.round(status.fraction * 100) : 0;

  const latestDetection = useMemo<Detection | null>(() => {
    let latest: Detection | null = null;
    for (const d of confirmedSightings.values()) {
      if (!latest || d.timestamp > latest.timestamp) latest = d;
    }
    return latest;
  }, [confirmedSightings]);

  const handleSelectLatest = useCallback(
    (d: Detection) => {
      const hydrated =
        mergedDetections.find((m) => speciesKey(m) === speciesKey(d)) ?? d;
      setSelectedSubject({ kind: 'detection', detection: hydrated });
    },
    [mergedDetections],
  );

  // Opens the info dialog for a species currently accumulating toward
  // confirmation (tapped from the PlayerBar album art's pending state).
  // We resolve the scientific name back to a BirdLabel here rather
  // than threading labels into PlayerBar -- the bar already knows
  // nothing about the BirdNET class table and we'd like to keep it
  // that way. If resolution fails (shouldn't happen in practice since
  // the pending leader originated from a BirdNET prediction), we
  // silently no-op so a spurious click can't crash the dialog.
  const handleSelectPending = useCallback(
    (scientificName: string, progress: number) => {
      if (!labels) return;
      const label = labels.find((l) => l.scientificName === scientificName);
      if (!label) return;
      setSelectedSubject({ kind: 'pending', label, progress });
    },
    [labels],
  );

  const playerErrorMessage = useMemo(
    () => (status.state === 'error' ? status.error : (recorder.error ?? null)),
    [status, recorder.error],
  );
  const playerErrorKind = status.state === 'error' ? null : recorder.errorKind;

  const showLocationOptIn =
    !regionHasDecided && regionStatus !== 'resolving' && !placeSet;

  return (
    // Light mode paints a fully opaque daytime gradient (sky → emerald
    // → amber). Dark mode uses the same indigo / violet / dusty-purple
    // palette but at reduced alpha so the shared `SkyBackdrop` (rendered
    // behind everything by `Index.tsx`) shows through as a real
    // starfield. See `src/pages/Index.tsx` for the orchestration.
    <div className="relative min-h-screen bg-linear-to-b from-sky-50 via-emerald-50/70 to-amber-50 text-stone-900 dark:bg-linear-to-b dark:from-[#0d1230]/80 dark:via-[#1a1740]/60 dark:to-[#3b2a3f]/80 dark:text-stone-100">
      {/* Full-page-width top HUD: mode selector on the left, optional
          manual-location pill + LoginArea on the right. Absolutely
          positioned (rather than tucked inside the max-w-6xl main) so
          the nav hugs the viewport edges on any screen, matching the
          edge-to-edge HUD in Stars mode. `pointer-events-none` on the
          strip + `pointer-events-auto` on each child keeps the area
          between the two groups click-through to the birdex. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 p-4">
        <div className="pointer-events-auto">
          <ModeSelector />
        </div>
        <div className="pointer-events-auto flex flex-1 items-center justify-end gap-2">
          {/* Manual-location users need a way to re-open the picker; it
              used to live inside BirdexHeader. Tucked next to the
              LoginArea as a compact pill so manual users can rehome
              themselves without clearing localStorage. Geo users never
              see this — their location is re-resolved automatically.
              Geo-fallback users (denied → NA default) also see a pill so
              they can pick a specific region instead of the continent
              default. */}
          {placeSet && usingManual ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => commitManualLocation(null)}
              className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {formatPlaceSet(placeSet)}
            </Button>
          ) : null}
          <LoginArea className="max-w-60" />
          <SettingsSheet
            publishLocation={publishLocation}
            setPublishLocation={setPublishLocation}
            hasCoarse={!!coarse}
          />
        </div>
      </div>

      <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-32 pt-16 sm:pb-36">
        <div className="mt-6 sm:mt-8">
          <Header />
        </div>

        <section className="mt-8 w-full">
          {!labels ? (
            <BirdexLoadingShimmer />
          ) : showRehomeGate ? (
            // Geo-fallback user asked to rehome: render the full
            // picker inline. Committing a manual pick clears the
            // rehome flag; the new placeSet then comes through
            // `manualPlaceSet` and wins over the NA fallback.
            <LocationGate
              regionStatus={regionStatus}
              onRequestLocation={() => {
                setShowRehomeGate(false);
                requestRegion();
              }}
              onCommitManual={(loc) => {
                commitManualLocation(loc);
                setShowRehomeGate(false);
              }}
            />
          ) : !placeSet ? (
            // Extremely rare: `useUserRegion` now populates a
            // continent-level NA fallback from mount, so `placeSet` is
            // non-null in every normal code path (pending, granted,
            // denied, unavailable, manual pick). This branch only
            // fires if someone constructs a code path that produces
            // neither a geo fix nor a manual pick nor the NA fallback
            // (e.g. the resolver explicitly returns null for a valid
            // coordinate). Render the full `LocationGate` so the user
            // has a way to recover rather than a blank page.
            <LocationGate
              regionStatus={regionStatus}
              onRequestLocation={requestRegion}
              onCommitManual={commitManualLocation}
            />
          ) : (
            <>
              {/* Fallback notice when we're running against the NA
                  default because the user denied or the browser is
                  unavailable. Self-hides when location is granted. */}
              <LocationDisabledIndicator variant="inline" className="mb-4" />
              <BirdexGrid
                visible={birdex.visible}
                onSelect={handleSelectBirdex}
              />
            </>
          )}
        </section>
      </main>

      <PlayerBar
        mode={mode}
        loadingPct={loadingPct}
        errorMessage={playerErrorMessage}
        errorKind={playerErrorKind}
        latestDetection={latestDetection}
        latestHit={latestHit}
        getAnalyser={recorder.getAnalyser}
        onPause={handlePause}
        onResume={handleResume}
        onRetry={handleRetry}
        onSelectLatest={handleSelectLatest}
        onSelectPending={handleSelectPending}
        showLocationOptIn={showLocationOptIn}
        onRequestLocation={requestRegion}
        heardTargets={heardTargets}
      />

      <BirdInfoDialog
        subject={selectedSubject}
        open={selectedSubject !== null}
        onOpenChange={handleDialogOpenChange}
        onDelete={handleDelete}
        isDeleting={selectedIsDeleting}
      />

      <LiferCelebration item={liferItem} onDismiss={dismissLifer} />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                              Sub-components                                */
/* -------------------------------------------------------------------------- */

const Header = memo(function Header() {
  return (
    <header className="flex flex-col items-center gap-4 text-center">
      <h1 className="font-serif text-4xl font-semibold leading-[1.02] tracking-tight text-stone-900 sm:text-6xl dark:text-stone-50">
        Birdstar
      </h1>
      <p className="max-w-xl text-balance text-sm text-stone-600 sm:text-base dark:text-stone-300/90">
        Go outside. Find the birds. Draw the stars.
      </p>
    </header>
  );
});

/** Format a UserPlaceSet into a human-readable "Texas · United States" strip. */
function formatPlaceSet(placeSet: UserPlaceSet): string {
  const parts: string[] = [];
  if (placeSet.subdivision) {
    const sub = SUBDIVISIONS.find((s) => s.code === placeSet.subdivision);
    if (sub) parts.push(sub.label);
  }
  if (placeSet.country) {
    const c = COUNTRIES.find((c) => c.code === placeSet.country);
    if (c) parts.push(c.label);
  }
  if (parts.length === 0) {
    const cont = CONTINENTS.find((c) => c.code === placeSet.continent);
    if (cont) parts.push(cont.label);
  }
  return parts.join(' · ');
}

/** The main birdex grid. Renders a flat list of confirmed, unconfirmed,
 * and starter-set cells in that order. Confirmed cells may carry the
 * "rare" badge (out-of-region sighting). Unconfirmed cells render
 * identically to plain unheard cells — grayed out with no badge — so
 * the grid reads as a simple heard/not-heard checklist; the detail
 * dialog is where "possibly heard" gets surfaced. There is no tier
 * gating — the grid grows as the user hears more birds, one at a
 * time. A passive "+Many Unheard" tile closes the layout. */
const BirdexGrid = memo(function BirdexGrid({
  visible,
  onSelect,
}: {
  visible: BirdexEntry[];
  onSelect: (entry: BirdexEntry) => void;
}) {
  if (visible.length === 0) {
    return (
      <Card className="mt-8 border-dashed bg-white/40 dark:bg-indigo-950/30">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-stone-500 dark:text-stone-400">
            No birds in your region yet. Try again once the range data has
            loaded.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div
      className={cn(
        'mt-6 grid gap-3 sm:gap-4',
        'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
      )}
    >
      {visible.map((entry) => (
        <SpeciesCell
          key={entry.label.index}
          entry={entry}
          onSelect={onSelect}
        />
      ))}
      <BirdexFooterTile />
    </div>
  );
});

/**
 * Passive end-of-grid tile. Shares shape (aspect-square, rounded-2xl,
 * dashed border) with SpeciesCell so it slots into the grid cleanly,
 * but without an image layer, badge, icon, or click target — just
 * a copy block. Replaces the old LockedTile without any of its
 * unlock-count mechanics.
 *
 * Deliberately non-numeric: an exact "+6,482" count reads as a
 * gamified completionist target, which is the opposite of the
 * "world feels small, grown one bird at a time" tone we're going
 * for. "Many" keeps the suggestion that the catalog is deep
 * without turning it into a score.
 */
const BirdexFooterTile = memo(function BirdexFooterTile() {
  return (
    <div
      aria-label="Many more bird species not yet heard"
      className={cn(
        'flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl',
        'border border-dashed border-stone-300/80 bg-white/40 p-3 text-center',
        'dark:border-indigo-800/40 dark:bg-indigo-950/30',
      )}
    >
      <p className="font-serif text-2xl font-semibold leading-none text-stone-700 dark:text-stone-200">
        +Many
      </p>
      <p className="text-[10px] uppercase tracking-[0.15em] text-stone-400 dark:text-stone-500">
        Unheard
      </p>
    </div>
  );
});

/**
 * Empty state for when we don't know the user's location yet. Offers the
 * native geolocation prompt (primary CTA) and a country/subdivision
 * manual picker for users who prefer not to share location.
 *
 * The manual picker is a three-step narrowing:
 *   continent → country (optional) → subdivision (optional).
 * Picking just a continent is valid and commits immediately.
 */
function LocationGate({
  regionStatus,
  onRequestLocation,
  onCommitManual,
}: {
  regionStatus: ReturnType<typeof useUserRegion>['status'];
  onRequestLocation: () => void;
  onCommitManual: (loc: StoredManualLocation) => void;
}) {
  const isResolving = regionStatus === 'resolving';
  const wasDenied = regionStatus === 'denied';
  const wasUnavailable = regionStatus === 'unavailable';

  const [pickedContinent, setPickedContinent] = useState<RegionCode | null>(null);
  const [pickedCountry, setPickedCountry] = useState<string | null>(null);

  const countriesOnContinent = useMemo(() => {
    if (!pickedContinent) return [];
    return COUNTRIES.filter((c) => c.continent === pickedContinent).sort(
      (a, b) => a.label.localeCompare(b.label),
    );
  }, [pickedContinent]);

  const subdivisionsInCountry = useMemo(() => {
    if (!pickedCountry) return [];
    return SUBDIVISIONS.filter((s) => s.country === pickedCountry).sort(
      (a, b) => a.label.localeCompare(b.label),
    );
  }, [pickedCountry]);

  const commit = (
    continent: RegionCode,
    country?: string,
    subdivision?: string,
  ) => {
    onCommitManual({ continent, country, subdivision });
  };

  return (
    <Card className="mx-auto mt-8 max-w-xl overflow-hidden border-dashed border-stone-300/70 bg-white/60 shadow-sm backdrop-blur dark:border-indigo-900/60 dark:bg-indigo-950/40">
      <CardContent className="space-y-5 p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-amber-900/40 dark:text-amber-300">
          <MapPin className="h-6 w-6" aria-hidden />
        </div>

        <div className="space-y-2">
          <h2 className="font-serif text-xl font-semibold text-stone-900 dark:text-stone-50">
            Which birds are near you?
          </h2>
        </div>

        <div className="flex flex-col items-stretch gap-3">
          {wasDenied ? (
            <LocationHelpDialog
              trigger={
                <Button
                  type="button"
                  className={cn(
                    'mx-auto w-full max-w-sm gap-2',
                    'bg-emerald-600 text-white hover:bg-emerald-700',
                    'dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300',
                  )}
                >
                  <MapPin className="h-4 w-4" aria-hidden />
                  Use my location
                </Button>
              }
            />
          ) : (
            <Button
              type="button"
              onClick={onRequestLocation}
              disabled={isResolving}
              className={cn(
                'mx-auto w-full max-w-sm gap-2',
                'bg-emerald-600 text-white hover:bg-emerald-700',
                'dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300',
              )}
            >
              <MapPin className="h-4 w-4" aria-hidden />
              {isResolving ? 'Locating…' : 'Use my location'}
            </Button>
          )}

          {/* Manual narrowing: continent → country → subdivision. */}
          <div className="mx-auto flex w-full max-w-sm flex-col items-stretch gap-2">
            {(wasDenied || wasUnavailable) && pickedContinent !== 'NA' ? (
              <Button
                type="button"
                variant="link"
                className="justify-center px-0 text-emerald-700 hover:text-emerald-800 dark:text-amber-300 dark:hover:text-amber-200"
                onClick={() => {
                  setPickedContinent('NA');
                  setPickedCountry(null);
                  // Auto-commit on continent pick; the country / subdivision
                  // dropdowns below let the user narrow further but aren't
                  // required. They can stop at the continent level.
                  commit('NA');
                }}
              >
                North America →
              </Button>
            ) : null}

            {pickedContinent && countriesOnContinent.length > 0 ? (
              <Select
                value={pickedCountry ?? ''}
                onValueChange={(v) => {
                  setPickedCountry(v);
                  commit(pickedContinent, v);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Country (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {countriesOnContinent.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {pickedCountry && subdivisionsInCountry.length > 0 ? (
              <Select
                onValueChange={(v) => {
                  commit(pickedContinent!, pickedCountry, v);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="State / province (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {subdivisionsInCountry.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Initial shimmer while labels are loading. */
function BirdexLoadingShimmer() {
  return (
    <div
      className={cn(
        'mt-16 grid gap-3 sm:gap-4',
        'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
      )}
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="aspect-square animate-pulse rounded-2xl border border-stone-200/70 bg-white/40 dark:border-indigo-900/40 dark:bg-indigo-950/30"
          style={{ animationDelay: `${i * 40}ms` }}
        />
      ))}
    </div>
  );
}

/**
 * Top-right Birds-mode settings sheet. Mirrors the Stars-mode
 * `SettingsSheet` pattern (see StarsIndex.tsx) but uses the default
 * shadcn theming so it respects light/dark/system instead of pinning
 * dark — Birds mode honors AppConfig.theme.
 *
 * Currently exposes a single toggle — "Publish location" — which
 * controls whether auto-published kind 2473 bird detections carry an
 * optional NIP-52 `g` tag (length-3 geohash, ~150 km). Off by default.
 * See NIP.md §"Kind 2473 → Optional → g" and Privacy.tsx for the
 * contract we promise users.
 */
function SettingsSheet({
  publishLocation,
  setPublishLocation,
  hasCoarse,
}: {
  publishLocation: boolean;
  setPublishLocation: (v: boolean) => void;
  /** True when a coarse lat/lon is available. Surfaced as a hint
   * beneath the toggle so users who enabled publishing but haven't
   * granted geolocation understand why the `g` tag may be absent
   * on their detections. */
  hasCoarse: boolean;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Settings"
          className="rounded-full text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Customize what Birdstar publishes on your behalf.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-6 mt-6 px-4 pb-4">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Privacy
            </h3>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <Label
                  htmlFor="publish-location-toggle"
                  className="text-sm cursor-pointer"
                >
                  Publish location
                </Label>
                <p className="text-xs text-muted-foreground leading-snug">
                  Attach a coarse geohash (~150 km) to each published bird
                  detection so others can see the region it came from.
                  Off by default.
                </p>
                {publishLocation && !hasCoarse ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400 leading-snug">
                    Your location isn't available yet — detections will
                    publish without a geohash until geolocation resolves.
                  </p>
                ) : null}
              </div>
              <Switch
                id="publish-location-toggle"
                checked={publishLocation}
                onCheckedChange={setPublishLocation}
              />
            </div>
          </section>

          <div className="pt-4 border-t flex justify-center">
            <CopyrightDialog
              trigger={
                <button
                  type="button"
                  className="rounded-sm text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  License &amp; Credits
                </button>
              }
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Wrapper that provides the SongPlaybackContext (mic-feedback
// counter), BirdSoundboardContext (per-species playback registry
// used by the cell play buttons, dialog play button, and bar-level
// Play all / Stop all) and BirdGlowContext (live per-species
// BirdNET confidence feed that drives the dex glow) to the whole
// page tree.
//
// Split out from the main component body because
// useAudioRecorder (called inside IndexInner) needs to read the
// SongPlayback counter, and the SoundboardProvider registers
// with that counter -- so both have to be ancestors of
// IndexInner, in that order. BirdGlowProvider is independent of
// both but lives alongside them so SpeciesCell (rendered deep
// inside IndexInner) can subscribe.
//
// See src/contexts/SongPlaybackContext.ts,
// src/contexts/BirdSoundboardContext.ts, and
// src/contexts/BirdGlowContext.ts for the motivations.
const Index = () => (
  <SongPlaybackProvider>
    <BirdSoundboardProvider>
      <BirdGlowProvider>
        <IndexInner />
      </BirdGlowProvider>
    </BirdSoundboardProvider>
  </SongPlaybackProvider>
);

export default Index;
