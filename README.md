# Birdstar

**Birds by day, stars by night** — a Nostr client that blends two
previously standalone apps into one viewport:

- **Birdsong Spotter**, a bird-by-ear checklist. Runs BirdNET in your
  browser via TensorFlow.js, listens through the microphone, and checks
  off every species it plausibly hears where you are. Logged-in users
  publish **kind 1007** detection events so their checklist survives
  across sessions and devices.
- **Starpoint**, an interactive sky map. Point your phone at the sky to
  identify stars, planets, the sun, the moon, and the 12 zodiac signs.
  Draw your own constellations, publish them as **kind 30621**
  addressable events, and browse figures drawn by anyone you follow on
  Nostr.

A floating dropdown on the top-left lets you choose:

- **Auto** (default) — birds while the sun is above the horizon at
  your location, stars after it sets. The switch uses the same sun
  position math that drives the sky map, so day/night means real
  astronomical day/night, not a clock-based heuristic.
- **Birds** — force bird mode.
- **Stars** — force star mode.

Auto is rendered as a bare circle with a down-chevron in the top-left;
Birds and Stars widen into a labelled pill.

## Custom event kinds

Both kinds are preserved unchanged from the original apps, so Birdstar
stays interoperable with any other client that implements them.

- `1007` — bird detection (regular event)
- `30621` — custom constellation (addressable event)

See [`NIP.md`](./NIP.md) for the full schemas, rationale, and example
events.

## Tech stack

React 19 · TypeScript · TailwindCSS 4 · Vite · shadcn/ui · Nostrify ·
TanStack Query · TensorFlow.js (birds) · d3-celestial + custom sky math
(stars).

## Development

```bash
npm run dev   # Vite dev server on :8080
npm test      # tsc --noEmit + eslint + vitest + production build
npm run build # production build
```

## Credits

Both sub-apps were vibed with [Shakespeare](https://shakespeare.diy).
BirdNET weights are used under CC-BY-NC-SA 4.0 (non-commercial).
Wikipedia provides bird range data, species articles, and star/planet
summaries. iNaturalist provides nearest-observation distance data for
the bird damper. d3-celestial supplies the Hipparcos star catalog.
