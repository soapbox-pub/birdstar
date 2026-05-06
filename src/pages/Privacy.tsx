import { useSeoMeta } from "@unhead/react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

/**
 * Privacy policy page. Mounted at `/privacy` by `AppRouter`.
 *
 * Content intent: describe — factually and concretely — every network
 * destination the app talks to, what data leaves the device, and what
 * data stays on the device. Keep this in sync with the actual code.
 * If you add or remove a third-party call, update this page.
 *
 * Structure:
 *   1. Summary ("what Birdstar does and doesn't do")
 *   2. On-device data (localStorage + ML inference)
 *   3. Third parties — one subsection each:
 *        - Nostr relays
 *        - iNaturalist
 *        - Wikipedia / Wikimedia Commons
 *        - Wikidata
 *        - Map tiles
 *   4. Geolocation (cross-cutting)
 *   5. Microphone audio
 *   6. Your choices
 *   7. Contact / updates
 */
const Privacy = () => {
  useSeoMeta({
    title: "Privacy Policy | Birdstar",
    description:
      "How Birdstar handles your location, audio, Nostr keys, and third-party requests to Nostr relays, iNaturalist, Wikipedia, and Wikidata.",
  });

  return (
    <div className="min-h-screen bg-background px-4 py-12 text-foreground">
      <article className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Birdstar
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">Last updated: May 2026</p>
        </header>

        <section className="space-y-3 text-base leading-relaxed">
          <p>
            Birdstar is a browser-based Nostr client with two modes: a
            bird-by-ear checklist (Birds) and an interactive sky map with
            community constellations (Stars). It runs entirely in your
            browser. There is no Birdstar backend server — the app is a
            static site and the data it needs comes from third parties.
          </p>
          <p>
            This page describes, for each third party Birdstar talks to,
            what data leaves your device and what stays on it.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. What stays on your device</h2>
          <p className="text-base leading-relaxed">
            Most of what Birdstar remembers is kept in your browser's{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-sm">localStorage</code>{" "}
            and never uploaded anywhere:
          </p>
          <ul className="list-disc space-y-2 pl-6 text-base leading-relaxed">
            <li>
              <strong>Mode preference</strong> (Birds or Stars).
            </li>
            <li>
              <strong>Theme preference</strong> (light / dark / system) and the
              list of Nostr relays you've configured.
            </li>
            <li>
              <strong>Your resolved region</strong> — continent, and where
              available country and sub-division (US state, Canadian province,
              etc.), plus a <em>coarse</em> latitude/longitude rounded to the
              nearest whole degree (≈ 100 km). The raw, higher-precision
              coordinate the browser returns is never persisted and never sent
              to a server at full precision.
            </li>
            <li>
              <strong>Your Birdex</strong> — the running list of species your
              device has heard and how confident the recognizer is in each.
            </li>
            <li>
              <strong>Your Nostr login</strong>. If you sign in with an{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-sm">nsec</code>{" "}
              private key, it is stored unencrypted in{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-sm">localStorage</code>,
              which is the unavoidable trade-off of a browser-only Nostr
              client. If you sign in with a browser extension (NIP-07) or a
              remote signer (NIP-46), your key never enters Birdstar's
              storage. Anyone with JavaScript access to this origin can read{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-sm">localStorage</code>
              , so do not paste an{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-sm">nsec</code>{" "}
              into a browser you don't trust.
            </li>
            <li>
              <strong>Bird identification</strong> is performed locally by{" "}
              BirdNET running in a Web Worker with TensorFlow.js. Audio
              recorded from your microphone is processed in-browser and is{" "}
              <em>not</em> uploaded.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. Nostr relays</h2>
          <p className="text-base leading-relaxed">
            Birdstar is a Nostr client. Nostr is an open protocol in which
            signed events are published to a set of independent relay servers
            over WebSocket. The relays Birdstar uses come from, in order:
          </p>
          <ol className="list-decimal space-y-2 pl-6 text-base leading-relaxed">
            <li>
              Your published NIP-65 relay list (kind 10002), if you are
              signed in.
            </li>
            <li>
              The defaults shipped with the app:{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-sm">wss://relay.ditto.pub</code>
              ,{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-sm">wss://relay.primal.net</code>
              , and{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-sm">wss://relay.damus.io</code>
              .
            </li>
          </ol>
          <p className="text-base leading-relaxed">
            Every relay you connect to can see your IP address, which is
            inherent to any direct WebSocket connection. To read public Nostr
            content (other people's notes, profiles, constellations) Birdstar
            must read from relays, so these connections happen as soon as the
            app loads.
          </p>
          <p className="text-base leading-relaxed">
            When you <em>publish</em> to Nostr (a bird detection, a custom
            constellation, a comment, a profile edit), the event is signed on
            your device and sent to the relays you've configured. Every relay
            that accepts the event receives a permanent, public copy.
          </p>
          <p className="text-base leading-relaxed">
            <strong>What Birdstar publishes:</strong> profile metadata (kind
            0), deletion requests (kind 5), comments (kind 1111), bird
            detections (kind 2473), your Birdex index (kind 12473), and
            custom constellations (kind 30621). Birdstar auto-adds a{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-sm">client</code>{" "}
            tag with the app's hostname.
          </p>
          <p className="text-base leading-relaxed">
            <strong>What Birdstar does not put in those events by default:</strong>{" "}
            your location. Kinds 2473, 12473, and 30621 each carry only the
            species or star identifiers they describe, plus a human-readable
            label. They contain no latitude, longitude, country, or IP address.
          </p>
          <p className="text-base leading-relaxed">
            <strong>Optional: publishing location on bird detections.</strong>{" "}
            Birds mode → Settings (top-right gear) has a{" "}
            <em>Publish location</em> toggle that is <strong>off by default</strong>.
            When you turn it on, each bird detection (kind 2473) you publish
            carries a{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-sm">g</code>{" "}
            tag holding a length-3 geohash (~150 km cells) derived from the
            1°-rounded coarse lat/lon Birdstar already uses to pick your
            regional bird list. Finer coordinates are never attached. The
            toggle only affects events published <em>after</em> you change
            it; detections already on relays are unchanged. The full schema
            is documented in{" "}
            <a
              href="https://gitlab.com/soapbox-pub/birdstar/-/blob/main/NIP.md"
              className="underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
            >
              NIP.md
            </a>
            . A bird detection's free-form note field{" "}
            <em>could</em> contain anything you type into it — if you write
            "Heard from my back porch at 123 Main St" there, that is what
            gets published. Auto-published detections from the checklist set
            this field to an empty string.
          </p>
          <p className="text-base leading-relaxed">
            Nostr events, once accepted by a relay, should be treated as
            permanent and public. Deletion requests (NIP-09) are an{" "}
            <em>asks-nicely</em> mechanism: relays are not required to honor
            them and copies may persist on relays that do not.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. iNaturalist</h2>
          <p className="text-base leading-relaxed">
            Birdstar queries the iNaturalist API at{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-sm">api.inaturalist.org</code>{" "}
            (v1) to power the Birds experience. These are unauthenticated
            public requests; Birdstar does not log you into iNaturalist.
          </p>
          <ul className="list-disc space-y-2 pl-6 text-base leading-relaxed">
            <li>
              <strong>Local species density</strong> —{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-sm">/v1/observations/species_counts</code>
              , sent with your <em>coarse</em> (1°-rounded) latitude and
              longitude and a search radius, to find which birds have been
              observed near you recently.
            </li>
            <li>
              <strong>Nearest observation lookup</strong> —{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-sm">/v1/observations</code>
              , sent with your coarse coordinates and a taxon id, to find
              the closest sighting of a given species so the app can dampen
              obvious false positives.
            </li>
            <li>
              <strong>Species metadata</strong> —{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-sm">/v1/taxa</code>
              , sent with a scientific name only, to look up iNaturalist's
              numeric taxon id.
            </li>
            <li>
              <strong>Bird sound clips</strong> —{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-sm">/v1/observations?sounds=true</code>
              , sent with a taxon id only, to find research-grade sound
              recordings for a species. Clips stream directly from
              iNaturalist's CDN.
            </li>
            <li>
              <strong>Observation density tiles</strong> —{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-sm">/v1/grid/&#123;z&#125;/&#123;x&#125;/&#123;y&#125;.png</code>
              , used to draw the observation heat-map inside the bird
              details dialog. Tile coordinates are derived from your coarse
              location.
            </li>
          </ul>
          <p className="text-base leading-relaxed">
            iNaturalist sees your IP address and the contents of the URL for
            each of these calls, subject to its own{" "}
            <a
              href="https://www.inaturalist.org/pages/privacy"
              className="underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
            >
              privacy policy
            </a>
            . Observation content returned by iNaturalist is contributed by
            its user community and is generally made available under Creative
            Commons or public-domain licenses; Birdstar displays iNaturalist
            observation links and thumbnails where credit is due.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            4. Wikipedia and Wikimedia Commons
          </h2>
          <p className="text-base leading-relaxed">
            Birdstar pulls species summaries, photographs, and some bird-call
            audio from the Wikimedia Foundation's public APIs:
          </p>
          <ul className="list-disc space-y-2 pl-6 text-base leading-relaxed">
            <li>
              <code className="rounded bg-muted px-1 py-0.5 text-sm">en.wikipedia.org/api/rest_v1/page/summary/&#123;title&#125;</code>{" "}
              — a short intro paragraph and lead image for a species page.
            </li>
            <li>
              <code className="rounded bg-muted px-1 py-0.5 text-sm">en.wikipedia.org/api/rest_v1/page/media-list/&#123;title&#125;</code>{" "}
              — the list of media files on a species page.
            </li>
            <li>
              <code className="rounded bg-muted px-1 py-0.5 text-sm">en.wikipedia.org/w/api.php?action=query&amp;prop=videoinfo</code>{" "}
              — metadata for individual audio files on Wikimedia Commons.
            </li>
          </ul>
          <p className="text-base leading-relaxed">
            Requests contain only a species name (or a media file title); no
            location, no Nostr keys, no audio, no account identifiers. The
            Wikimedia Foundation receives your IP address and User-Agent for
            each request, subject to its{" "}
            <a
              href="https://foundation.wikimedia.org/wiki/Policy:Privacy_policy"
              className="underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
            >
              privacy policy
            </a>
            . Wikipedia article text is licensed under CC BY-SA; media on
            Wikimedia Commons is under the license declared on each file's
            page.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. Wikidata</h2>
          <p className="text-base leading-relaxed">
            When Wikipedia has no summary for a species, Birdstar falls back
            to Wikidata's SPARQL endpoint at{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-sm">query.wikidata.org/sparql</code>
            . The query contains only the species' scientific or English
            name; it does not include your location or identity. The
            Wikimedia Foundation runs Wikidata and the same{" "}
            <a
              href="https://foundation.wikimedia.org/wiki/Policy:Privacy_policy"
              className="underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
            >
              privacy policy
            </a>{" "}
            applies. Wikidata data is released under CC0.
          </p>
          <p className="text-base leading-relaxed">
            Birdstar also uses Wikidata entity URIs (e.g.{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-sm">https://www.wikidata.org/entity/Q26825</code>
            ) as the canonical identity of each bird species inside the
            Nostr events it publishes. The URI itself is public; publishing
            it reveals which species your device identified, nothing more.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. Map tiles</h2>
          <p className="text-base leading-relaxed">
            The bird observation map uses CARTO's public raster tiles as a
            basemap. Each tile request reveals the tile coordinates (which
            encode your map's center and zoom) and your IP address to CARTO.
            The map is centered on your coarse, 1°-rounded location, not on
            your raw GPS fix.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. Geolocation</h2>
          <p className="text-base leading-relaxed">
            Birdstar asks the browser for your location to make both modes
            useful: Birds needs to know which species live near you; Stars
            needs your latitude and longitude to draw the correct sky.
          </p>
          <p className="text-base leading-relaxed">
            If you deny the prompt or your browser can't resolve a fix,
            Birdstar falls back to a continent-level{" "}
            <strong>North America</strong> default. You will see a "Location
            disabled" indicator at the bottom of the screen in that case.
            You can still use the app; some features (local-species
            counts, nearest-observation lookups, horoscopes with a local
            sunset) will be less accurate.
          </p>
          <p className="text-base leading-relaxed">
            When location is granted, Birdstar rounds your latitude and
            longitude to the nearest whole degree (≈ 100 km) before doing
            anything else. That rounded value is what gets stored in{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-sm">localStorage</code>{" "}
            and what gets sent to iNaturalist. The Stars mode, because it
            draws the sky as seen from an exact position, uses the full
            precision locally but does not send it to any server. Your
            coarse location is never attached to any Nostr event.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">8. Microphone audio</h2>
          <p className="text-base leading-relaxed">
            Birds mode asks for microphone access to identify birdsong.
            Audio captured from your microphone is piped through a local
            TensorFlow.js instance of the BirdNET model and discarded as soon
            as the 3-second analysis window slides past. Audio is never
            written to disk, uploaded to a server, or attached to Nostr
            events. If you revoke microphone permission, bird identification
            stops; everything else in the app keeps working.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">9. Your choices</h2>
          <ul className="list-disc space-y-2 pl-6 text-base leading-relaxed">
            <li>
              <strong>Location:</strong> grant, deny, or change your mind at
              any time using your browser's site-permissions settings.
              Denying falls back to the North America default. You can also
              manually pick a continent, country, or subdivision in Birds
              mode from the rehome pill in the top bar.
            </li>
            <li>
              <strong>Microphone:</strong> same as above — revoking it
              simply stops bird identification.
            </li>
            <li>
              <strong>Nostr relays:</strong> edit your configured relay list
              from the app's settings. Your NIP-65 relay list is published
              automatically when you change it; that publication lists
              your relay URLs but contains no other personal data.
            </li>
            <li>
              <strong>Forget me:</strong> clear your browser's site data for
              this origin. That removes your local Birdex, your cached
              region, your mode and theme preferences, your Nostr key (if
              you used an <code className="rounded bg-muted px-1 py-0.5 text-sm">nsec</code> login),
              and any relay-list cache. It does{" "}
              <em>not</em> remove any Nostr events you've previously
              published; those live on the relays.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">10. Updates</h2>
          <p className="text-base leading-relaxed">
            Birdstar is open source and this document lives alongside the
            code. Material changes to which third parties the app talks to,
            or what data gets sent, will be reflected here; check the source
            history for the authoritative diff.
          </p>
        </section>

        <div className="pt-6">
          <Button asChild variant="secondary">
            <Link to="/">Back to Birdstar</Link>
          </Button>
        </div>
      </article>
    </div>
  );
};

export default Privacy;
