# NIP.md — Birdstar

Birdstar merges two prior apps — **Birdsong Spotter** (a bird-by-ear
checklist) and **Starpoint** (an interactive sky map with community
constellations). Each app defined its own custom Nostr event kind.
Both are preserved here unchanged; they remain interoperable with
their original standalone clients.

---

## Kind 2473 — Bird Detection (from Birdsong Spotter)

A regular event representing a single identified bird observation. Regular
events (1000 ≤ kind < 10000) are stored permanently by relays and are not
deduplicated.

The schema deliberately relies on existing NIPs (NIP-31 `alt`, NIP-73 `i`/`k`)
rather than inventing parallel vocabulary, so that non-birding clients can
still display and aggregate detections usefully.

### Rationale

A bird detection is an **observation log entry**: a timestamped, immutable
record that "species X was heard at time T", optionally annotated with a
free-form human note.

We reviewed existing NIPs before introducing a new kind:

- **NIP-52 (Calendar Events)** models *planned* events at specific future
  times, not observation logs. RSVPs and addressability make no sense for a
  detection.
- **NIP-32 (Labeling)** labels *another* event — it has no standalone meaning.
  A detection is a primary artifact, not a label applied to something else.
- **Kind 1 text notes** can contain "I heard a robin!" but provide no
  structured data, so other clients cannot aggregate or filter by species.
- The unofficial **Geocaching** kinds (7516/7517) follow a similar
  observation-log pattern but are tightly coupled to geocache listings.

No existing kind covers a structured, standalone observation log, so we define
a new regular event kind.

### `content`

Free-form human-readable note about the detection. MAY be empty.

Examples: `""`, `"Heard from my balcony near the oak tree."`

Structured data MUST be placed in tags, not in `content`.

### Tags

#### Required

- `alt` (NIP-31) — human-readable summary, e.g.
  `"Bird detection: American Robin (Turdus migratorius)"`. Lets clients that
  don't implement this NIP still render something meaningful.

- `i` + `k` (NIP-73) — a `web`-type external ID pointing at the species'
  **Wikidata entity URI**. This is the canonical identity of the species,
  the primary aggregation key, and the only species identifier in the
  event:

  ```jsonc
  ["i", "https://www.wikidata.org/entity/Q26825"],
  ["k", "web"]
  ```

  Wikidata is language-neutral: a single Q-id designates the species across
  every Wikipedia edition, taxonomy database, and localized common name. A
  client rendering the event in any language can follow the entity URI to
  get labels, images, and the sitelink to its preferred Wikipedia edition.

  Requirements:

  - The URL MUST match `https://www.wikidata.org/entity/Q<digits>` exactly:
    `https` scheme, host `www.wikidata.org`, path `/entity/Q<digits>`, no
    fragment, no query string, no trailing slash.
  - The Q-id SHOULD resolve to a taxon-like entity (a species, subspecies,
    or similarly specific rank). Publishers SHOULD NOT emit a detection
    with a Q-id that has no corresponding taxon.

#### Optional

_(None currently defined.)_

Publishers SHOULD NOT attach a per-event numeric confidence to a detection.
Publishing a kind 2473 event IS the publisher's confidence signal: the act
of authoring and signing the event asserts that the observation was
reliable enough to commit to the record.

### Example

```jsonc
{
  "kind": 2473,
  "content": "Heard from my balcony around 7am — very clear song.",
  "tags": [
    ["alt", "Bird detection: American Robin (Turdus migratorius)"],
    ["i", "https://www.wikidata.org/entity/Q26825"],
    ["k", "web"]
  ]
}
```

### Query Patterns

All detections of a given species across the network:

```jsonc
{
  "kinds": [2473],
  "#i": ["https://www.wikidata.org/entity/Q26825"]
}
```

Dropping the `kinds` filter broadens this to *all* Nostr content about the
species — bird detections, comments, long-form posts, etc. — since the
Wikidata entity URI is a shared NIP-73 identifier:

```jsonc
{ "#i": ["https://www.wikidata.org/entity/Q26825"] }
```

All detections by a specific observer:

```jsonc
{ "kinds": [2473], "authors": ["<hex-pubkey>"], "limit": 50 }
```

### Validation

Clients SHOULD ignore an event as a bird detection if:

- `kind !== 2473`
- No `i` tag with a normalized `https://www.wikidata.org/entity/Q<digits>`
  URL is present (paired with a `k` tag of `web`)

### Publishing

Birdstar publishes detections automatically for logged-in users as birds
are identified, so that a user's sightings are preserved across sessions
and devices via their own Nostr relays.

To avoid spamming relays when the same bird is heard repeatedly, publishers
SHOULD apply a per-species cooldown: once a detection event has been
published for a given `i` tag, no new event for that same URL should be
published by the same author for at least 10 minutes.

Detections from logged-out users are never published.

### Deletion

Users can retract a previously published detection by issuing a standard
**NIP-09** deletion request (kind 5) referencing the detection's event id:

```jsonc
{
  "kind": 5,
  "tags": [
    ["e", "<kind-2473-event-id>"],
    ["k", "2473"]
  ],
  "content": ""
}
```

Birdstar hides any detection whose id appears in an `e` tag of a kind 5
event authored by the same pubkey.

---

## Kind 30621 — Custom Constellation (from Starpoint)

An **addressable** event (kind `30621`) representing a single constellation
drawn by a user. Because it is addressable, the author may edit/replace it
by republishing with the same `d` tag.

### Tags

| Tag     | Value                            | Required | Notes                                                                                                            |
| ------- | -------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `d`     | slug identifier                  | yes      | Stable identifier for this constellation (per author).                                                           |
| `title` | human-readable name              | yes      | Short display name (e.g. "The Winter Cat").                                                                      |
| `edge`  | `<from_star>`, `<to_star>`       | 1+       | One edge of the figure. Exactly three elements: `["edge", from, to]`. Each endpoint is a Hipparcos catalog number encoded as a decimal string (e.g. `"32349"` for Sirius). See **Star references** below. |
| `alt`   | human-readable description       | yes      | NIP-31 fallback for non-supporting clients.                                                                      |

The `content` field is a freeform plaintext description / story / legend
for the constellation (may be empty).

### Star references

Stars are identified by their **Hipparcos catalog number** (HIP), not by
name. The wire format is the HIP integer encoded as a decimal string with
no prefix, no padding, and no whitespace (e.g. `"32349"` for Sirius, not
`"HIP 32349"` or `" 32349 "`).

HIP numbers are used instead of names because traditional star names
collide (e.g. "Algenib" historically referred to both γ Pegasi and α
Persei, "Gienah" to both ε Cygni and γ Corvi), are localized, and get
renamed by the IAU. HIP numbers were frozen in 1997, are unambiguous,
and cover every naked-eye star.

### Example

```jsonc
{
  "kind": 30621,
  "content": "Two bright eyes watching over the winter sky.",
  "tags": [
    ["d", "winter-cat"],
    ["title", "The Winter Cat"],
    ["alt", "A custom Birdstar constellation: The Winter Cat"],
    ["edge", "32349", "37279"],   // Sirius → Procyon
    ["edge", "37279", "37826"],   // Procyon → Pollux
    ["edge", "37826", "36850"],   // Pollux → Castor
    ["edge", "36850", "24608"],   // Castor → Capella
    ["edge", "24608", "21421"],   // Capella → Aldebaran
    ["edge", "21421", "24436"],   // Aldebaran → Rigel
    ["edge", "24436", "32349"]    // Rigel → Sirius
  ]
}
```

### Validation

A client receiving a `30621` event should:

1. Verify that `d` and `title` tags exist and are non-empty strings.
2. Collect all `edge` tags. A valid edge tag has exactly three elements —
   `["edge", from, to]` — where `from` and `to` each match `/^\d+$/` and
   parse as a positive integer. Tags not matching this shape are ignored.
3. Resolve each edge's HIP numbers against the local star catalog. Edges
   referencing HIP numbers not in the local catalog are silently dropped
   rather than failing the whole constellation.
4. Ignore the event entirely if it has zero resolvable edges after
   validation.

### Rationale

- **Why not `e` tags?** The single-letter `e` tag is a reserved core Nostr
  tag meaning "event reference" (see NIP-01, NIP-10). Overloading it with
  star references would pollute relay indexes and mislead any generic
  client or tool that inspects the event. `edge` is an unambiguous
  multi-letter tag whose meaning is local to this kind.
- **Why an edge list (not a single polyline)?** Real figures branch and
  loop — Orion has a belt with legs and shoulders, the Big Dipper is a
  cycle with a handle. A single ordered path cannot express branching
  without duplicating stars. An edge list is the natural representation
  for arbitrary figure topology (trees, cycles, disconnected components).
- **Why Hipparcos numbers, not star names?** Traditional names are
  ambiguous, localized, and subject to IAU renaming. HIP numbers are
  unique, permanent, and recognized across every astronomy catalog.
- **Why addressable?** Authors can iterate on a drawing over time without
  creating duplicate events.
