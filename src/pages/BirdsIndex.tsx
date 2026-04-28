import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { Lock, MapPin, Sparkles } from 'lucide-react';
import { type Detection } from '@/components/BirdCard';
import {
  BirdInfoDialog,
  type BirdSubject,
} from '@/components/BirdInfoDialog';
import { SpeciesCell } from '@/components/SpeciesCell';
import { LoginArea as LoginAreaRaw } from '@/components/auth/LoginArea';
import { ModeSelector } from '@/components/ModeSelector';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlayerBar, type PlayerMode } from '@/components/PlayerBar';
import type { BirdLabel } from '@/lib/birdnet/labels';
import {
  placeSetFor,
  type RegionCode,
  type UserPlaceSet,
} from '@/lib/geo/continent';
import { useBirdNet } from '@/hooks/useBirdNet';
import { useBirdLabels } from '@/hooks/useBirdLabels';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { SongPlaybackProvider } from '@/components/SongPlaybackProvider';
import { useBirdHistory } from '@/hooks/useBirdHistory';
import { useAutoPublishDetection } from '@/hooks/useAutoPublishDetection';
import { useDeleteBirdDetection } from '@/hooks/useDeleteBirdDetection';
import {
  useDetectionAccumulator,
  MIN_RAW_CONFIDENCE,
  OUT_OF_REGION_MULTIPLIER,
} from '@/hooks/useDetectionAccumulator';
import { useUserRegion } from '@/hooks/useUserRegion';
import { useSpeciesRegions } from '@/hooks/useSpeciesRegions';
import { useRoster, type RosterEntry, ROSTER_TIERS } from '@/hooks/useRoster';
import { useLocalSpeciesBands } from '@/hooks/useLocalSpeciesBands';
import { useNearestObservation } from '@/hooks/useNearestObservation';
import { isSpeciesInRegion } from '@/lib/birdnet/speciesRegions';
import {
  BAND_TO_DAMPING,
  LOCAL_RADII_KM,
  interpolateDamping,
  lookupLocal,
} from '@/lib/inat/localSpecies';
import { fetchInatTaxonId } from '@/hooks/useInatTaxonId';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

// Memoized wrapper around the stock LoginArea component. LoginArea owns
// its own dialog-open state internally; wrapping with memo prevents
// parent-driven re-renders on every ambient tick.
const LoginArea = memo(LoginAreaRaw);

// LocalStorage flag so we only show the "first-time download" note once.
const MODEL_CACHED_KEY = 'birdsong.modelCached';

// Manual-picker localStorage key. Stores a UserPlaceSet minus its runtime
// `places` Set (we reconstruct the Set on load via placeSetFor).
const MANUAL_LOCATION_KEY = 'birdsong.manualLocation.v2';

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
// in these countries can narrow their roster from continent to country.
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

  const { consider: considerPublish } = useAutoPublishDetection({
    lastPublishedAt: history.lastPublishedAt,
  });

  // Location: geolocation wins; manual pick is the fallback.
  const {
    placeSet: geoPlaceSet,
    coarse,
    status: regionStatus,
    hasDecided: regionHasDecided,
    request: requestRegion,
  } = useUserRegion();

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

  const placeSet: UserPlaceSet | null = geoPlaceSet ?? manualPlaceSet;
  const usingManual = !geoPlaceSet && !!manualPlaceSet;

  const commitManualLocation = useCallback(
    (next: StoredManualLocation | null) => {
      setManualLocation(next);
      writeManualLocation(next);
    },
    [],
  );

  const { data: speciesRegions } = useSpeciesRegions();

  // iNat local-observation signal. Only active when geolocation is
  // granted (useLocalSpeciesBands returns a null map for manual-picker
  // users). This is additive: the roster and damper both fall back to
  // the .bin-only behavior when the map isn't available.
  const { map: localSpeciesMap } = useLocalSpeciesBands(coarse);

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

  const { ingest, confirmedSightings, forgetConfirmed, pendingLeader } =
    useDetectionAccumulator({
      onConfirm: (detection) => considerPublish(detection),
      locationAdjuster,
      onSpeciesHit: handleSpeciesHit,
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
  useEffect(() => {
    if (!pendingLeader) return;
    setSelectedSubject((prev) => {
      if (prev?.kind !== 'pending') return prev;
      if (prev.label.scientificName !== pendingLeader.scientificName) {
        return prev;
      }
      if (prev.progress === pendingLeader.progress) return prev;
      return { ...prev, progress: pendingLeader.progress };
    });
  }, [pendingLeader]);

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

  const roster = useRoster({
    placeSet,
    detections: mergedDetections,
    localSpeciesMap,
  });

  // Tier-unlock toast. The tier is derived purely from roster state —
  // no persistence. On the first render for a given region we silently
  // capture the tier (so an existing user with 47 heard birds doesn't
  // get slammed with 3 replayed toasts on page load); subsequent
  // *increases* during the same session trigger a toast.
  //
  // Region-keyed: changing location resets the baseline so moving from
  // Texas to Paris doesn't spuriously toast.
  const regionKey = placeSet
    ? `${placeSet.continent}/${placeSet.country ?? ''}/${placeSet.subdivision ?? ''}`
    : '';
  const lastTierRef = useRef<{ region: string; tier: number } | null>(null);
  useEffect(() => {
    if (!roster.isRegionalized) return;
    const current = roster.tier;
    const prev = lastTierRef.current;
    // Region changed (or first ever) — silently seed the baseline.
    if (!prev || prev.region !== regionKey) {
      lastTierRef.current = { region: regionKey, tier: current };
      return;
    }
    if (current > prev.tier) {
      // Cleared one or more tiers since last render. Toast the count
      // the user just crossed (ROSTER_TIERS is 0-indexed by tier-1; we
      // toast the *previous* tier's target since that's the milestone
      // they reached). Only toast once per transition — multi-tier
      // jumps within a single session are rare but possible if
      // history arrives after initial render.
      const milestoneIdx = prev.tier - 1; // 0-indexed
      const milestone = ROSTER_TIERS[milestoneIdx];
      if (typeof milestone === 'number') {
        toast({
          title: `${milestone} birds unlocked`,
          description: 'Keep listening — more species revealed.',
        });
      }
      lastTierRef.current = { region: regionKey, tier: current };
    }
  }, [regionKey, roster.tier, roster.isRegionalized]);

  const handleSelectRoster = useCallback(
    (label: BirdLabel, detection: Detection | undefined) => {
      if (detection) {
        setSelectedSubject({ kind: 'detection', detection });
      } else {
        setSelectedSubject({ kind: 'label', label });
      }
    },
    [],
  );
  const handleSelectRare = useCallback(
    (label: BirdLabel, detection: Detection | undefined) => {
      if (detection) {
        setSelectedSubject({ kind: 'detection', detection });
      } else {
        setSelectedSubject({ kind: 'label', label, isRare: true });
      }
    },
    [],
  );

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

  const handleChunk = useCallback(
    async (samples: Float32Array) => {
      if (!labels) return;
      const preds = await predict(samples, 5);
      if (preds.length === 0) return;
      const now = Date.now();
      for (const pred of preds) {
        const label = labels[pred.index];
        if (!label || !label.isBird) continue;
        if (pred.score < MIN_RAW_CONFIDENCE) continue;
        ingest(pred, label, now);
      }
    },
    [labels, predict, ingest],
  );

  const recorder = useAudioRecorder({ onChunk: handleChunk, predictEveryMs: 2000 });

  const [userPaused, setUserPaused] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  useEffect(() => {
    if (recorder.isRecording || recorder.error) setIsStarting(false);
  }, [recorder.isRecording, recorder.error]);

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
    if (status.state === 'ready') {
      try {
        localStorage.setItem(MODEL_CACHED_KEY, '1');
      } catch {
        // ignore
      }
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

  const isFirstLoad = (() => {
    try {
      return localStorage.getItem(MODEL_CACHED_KEY) !== '1';
    } catch {
      return true;
    }
  })();

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
    <div className="relative min-h-screen bg-linear-to-b from-sky-50 via-emerald-50/70 to-amber-50 text-stone-900 dark:bg-linear-to-b dark:from-[#0d1230] dark:via-[#1a1740] dark:to-[#3b2a3f] dark:text-stone-100">
      {/* Full-page-width top HUD: mode selector on the left, optional
          manual-location pill + LoginArea on the right. Absolutely
          positioned (rather than tucked inside the max-w-6xl main) so
          the nav hugs the viewport edges on any screen, matching the
          edge-to-edge HUD in Stars mode. `pointer-events-none` on the
          strip + `pointer-events-auto` on each child keeps the area
          between the two groups click-through to the roster. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 p-4">
        <div className="pointer-events-auto">
          <ModeSelector />
        </div>
        <div className="pointer-events-auto flex flex-1 items-center justify-end gap-2">
          {/* Manual-location users need a way to re-open the picker; it
              used to live inside RosterHeader. Tucked next to the
              LoginArea as a compact pill so manual users can rehome
              themselves without clearing localStorage. Geo users never
              see this — their location is re-resolved automatically. */}
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
        </div>
      </div>

      <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-32 pt-16 sm:pb-36">
        <div className="mt-6 sm:mt-8">
          <Header />
        </div>

        <section className="mt-8 w-full">
          {!labels ? (
            <RosterLoadingShimmer />
          ) : !placeSet ? (
            // No resolved region yet. While geolocation is still
            // resolving (or hasn't fired yet on first paint), show a
            // skeleton of the location card so the page has visible
            // scaffolding instead of empty space. Once the browser
            // reports denied/unavailable, fall through to the full
            // LocationGate with its manual-region picker.
            regionStatus === 'unknown' || regionStatus === 'resolving' ? (
              <LocationGateSkeleton />
            ) : (
              <LocationGate
                regionStatus={regionStatus}
                onRequestLocation={requestRegion}
                onCommitManual={commitManualLocation}
              />
            )
          ) : (
            <>
              <RosterGrid
                visible={roster.visible}
                hidden={roster.hidden}
                tier={roster.tier}
                tierTarget={roster.tierTarget}
                heardCount={roster.heardCount}
                onSelect={handleSelectRoster}
              />
              {roster.rareFinds.length > 0 ? (
                <RareFindsSection
                  entries={roster.rareFinds}
                  onSelect={handleSelectRare}
                />
              ) : null}
            </>
          )}
        </section>

        <Footer />
      </main>

      <PlayerBar
        mode={mode}
        loadingPct={loadingPct}
        errorMessage={playerErrorMessage}
        errorKind={playerErrorKind}
        showFirstLoadNote={isFirstLoad}
        latestDetection={latestDetection}
        pendingLeader={pendingLeader}
        getAnalyser={recorder.getAnalyser}
        onPause={handlePause}
        onResume={handleResume}
        onRetry={handleRetry}
        onSelectLatest={handleSelectLatest}
        onSelectPending={handleSelectPending}
        showLocationOptIn={showLocationOptIn}
        onRequestLocation={requestRegion}
      />

      <BirdInfoDialog
        subject={selectedSubject}
        open={selectedSubject !== null}
        onOpenChange={handleDialogOpenChange}
        onDelete={handleDelete}
        isDeleting={selectedIsDeleting}
      />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                              Sub-components                                */
/* -------------------------------------------------------------------------- */

const Header = memo(function Header() {
  return (
    <header className="flex flex-col items-center gap-4 text-center">
      <h1 className="font-serif text-4xl font-semibold leading-[1.02] tracking-tight sm:text-6xl">
        <span className="text-stone-900 dark:text-stone-50">Bird</span>
        <span className="relative inline-block italic text-emerald-700 dark:text-amber-300">
          star
          <svg
            aria-hidden
            viewBox="0 0 220 14"
            className="absolute -bottom-2 left-0 h-3 w-full text-emerald-500/70 dark:text-amber-400/70"
            preserveAspectRatio="none"
          >
            <path
              d="M2 8 Q 55 2, 110 7 T 218 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>
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

/** The main roster grid. Renders the current-tier popular set plus any
 * heard birds at the top, and — if more in-region species exist beyond
 * the current tier — appends a single `LockedTile` at the end of the
 * grid as the sole discovery affordance. There is intentionally no
 * manual "show all" button; the only way to reveal rarer birds is to
 * hear more of the current tier. */
const RosterGrid = memo(function RosterGrid({
  visible,
  hidden,
  tier,
  tierTarget,
  heardCount,
  onSelect,
}: {
  visible: RosterEntry[];
  hidden: RosterEntry[];
  tier: number;
  tierTarget: number;
  heardCount: number;
  onSelect: (label: BirdLabel, detection: Detection | undefined) => void;
}) {
  if (visible.length === 0 && hidden.length === 0) {
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

  // Only show the locked tile when there are actually more species to
  // unlock. At the unlimited tier (cleared 300) `tierTarget` is
  // Infinity and `hidden` is empty — nothing left to lock.
  const showLocked = hidden.length > 0 && Number.isFinite(tierTarget);
  const remaining = Math.max(0, tierTarget - heardCount);

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
          label={entry.label}
          detection={entry.detection}
          heard={entry.heard}
          onSelect={onSelect}
        />
      ))}
      {showLocked ? (
        <LockedTile tier={tier} remaining={remaining} />
      ) : null}
    </div>
  );
});

/**
 * End-of-grid tile that stands in for the "hidden" bucket. Shaped like
 * a SpeciesCell so it slots into the same grid without breaking the
 * layout. Passive: no onClick — the only way to advance is to hear more
 * birds. The subtitle adapts to how many the user still needs.
 */
const LockedTile = memo(function LockedTile({
  tier,
  remaining,
}: {
  tier: number;
  remaining: number;
}) {
  const subtitle =
    remaining === 1
      ? 'Hear 1 more bird to unlock more'
      : `Hear ${remaining.toLocaleString()} more birds to unlock more`;

  return (
    <div
      aria-label={subtitle}
      className={cn(
        'group flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl',
        'border border-dashed border-stone-300/80 bg-white/40 p-3 text-center',
        'dark:border-indigo-800/40 dark:bg-indigo-950/30',
      )}
    >
      <div
        className={cn(
          'flex h-11 w-11 items-center justify-center rounded-full',
          'bg-stone-200/80 text-stone-500',
          'dark:bg-indigo-900/50 dark:text-stone-400',
        )}
        aria-hidden
      >
        <Lock className="h-5 w-5" />
      </div>
      <p className="text-[11px] font-medium leading-tight text-stone-600 sm:text-xs dark:text-stone-300">
        {subtitle}
      </p>
      <p className="text-[10px] uppercase tracking-[0.15em] text-stone-400 dark:text-stone-500">
        Tier {tier}
      </p>
    </div>
  );
});

const RareFindsSection = memo(function RareFindsSection({
  entries,
  onSelect,
}: {
  entries: RosterEntry[];
  onSelect: (label: BirdLabel, detection: Detection | undefined) => void;
}) {
  return (
    <section className="mt-14">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-amber-700 dark:text-amber-300">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Rare finds
          </div>
          <h2 className="font-serif text-xl font-semibold leading-tight text-stone-900 sm:text-2xl dark:text-stone-50">
            {entries.length === 1
              ? '1 bird outside your region'
              : `${entries.length} birds outside your region`}
          </h2>
          <p className="max-w-xl text-sm text-stone-500 dark:text-stone-400">
            These birds weren't expected here — maybe a vagrant, a pet, or a
            detection the model isn't sure about. They're listed separately
            so they don't crowd your regular checklist.
          </p>
        </div>
      </div>

      <div
        className={cn(
          'mt-6 grid gap-3 sm:gap-4',
          'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
        )}
      >
        {entries.map((entry) => (
          <SpeciesCell
            key={entry.label.index}
            label={entry.label}
            detection={entry.detection}
            heard={entry.heard}
            rare
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
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
          <p className="text-sm text-stone-600 dark:text-stone-300">
            Your bird list is the set of species you can plausibly hear where
            you live. Share your location to build it, or pick a region below.
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-3">
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

        <p className="text-[11px] text-stone-400 dark:text-stone-500">
          Your location stays on this device — it's never published to Nostr.
        </p>
      </CardContent>
    </Card>
  );
}

/** Initial shimmer while labels are loading. */
function RosterLoadingShimmer() {
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
 * Skeleton mirror of {@link LocationGate}. Rendered while we're waiting
 * for the browser to resolve the geolocation prompt so the page has
 * structure instead of a blank gap. Shapes (pin circle, heading,
 * two-line body, button) match the real card so the transition is a
 * cross-fade rather than a layout jump.
 */
function LocationGateSkeleton() {
  return (
    <Card
      aria-hidden
      className="mx-auto mt-8 max-w-xl overflow-hidden border-dashed border-stone-300/70 bg-white/60 shadow-sm backdrop-blur dark:border-indigo-900/60 dark:bg-indigo-950/40"
    >
      <CardContent className="space-y-5 p-8 text-center">
        <Skeleton className="mx-auto h-14 w-14 rounded-full" />
        <div className="space-y-3">
          <Skeleton className="mx-auto h-6 w-56" />
          <div className="space-y-2">
            <Skeleton className="mx-auto h-3.5 w-11/12 max-w-md" />
            <Skeleton className="mx-auto h-3.5 w-9/12 max-w-sm" />
          </div>
        </div>
        <Skeleton className="mx-auto h-10 w-full max-w-sm rounded-md" />
        <Skeleton className="mx-auto h-3 w-64" />
      </CardContent>
    </Card>
  );
}

const Footer = memo(function Footer() {
  return (
    <footer className="mt-20 flex flex-col items-center gap-1.5 text-center text-xs text-stone-400 dark:text-stone-500">
      <p>
        Powered by{' '}
        <a
          href="https://birdnet.cornell.edu"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 hover:text-stone-600 dark:hover:text-stone-300"
        >
          BirdNET
        </a>{' '}
        · bird info from{' '}
        <a
          href="https://en.wikipedia.org"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 hover:text-stone-600 dark:hover:text-stone-300"
        >
          Wikipedia
        </a>{' '}
        · vibed with{' '}
        <a
          href="https://shakespeare.diy"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 hover:text-stone-600 dark:hover:text-stone-300"
        >
          Shakespeare
        </a>
      </p>
      <p className="text-stone-400/70 dark:text-stone-600">
        BirdNET weights CC-BY-NC-SA 4.0 · non-commercial use · range data
        derived from Wikipedia
      </p>
    </footer>
  );
});

// Wrapper that provides the SongPlaybackContext to the whole
// page tree. Split out from the main component body because
// useAudioRecorder (called inside IndexInner) needs to read the
// context -- and a hook can't consume a provider its own
// component mounted. Keeping the provider one level up is the
// standard fix.
//
// See src/contexts/SongPlaybackContext.ts for the motivation
// (mic/speaker feedback loop when playing a reference song).
const Index = () => (
  <SongPlaybackProvider>
    <IndexInner />
  </SongPlaybackProvider>
);

export default Index;
