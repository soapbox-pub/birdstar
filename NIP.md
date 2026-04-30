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

The schema deliberately relies on existing NIPs (NIP-31 `alt`, NIP-73 `i`)
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

- `i` (NIP-73) — an external ID pointing at the species' **Wikidata
  entity URI**. This is the canonical identity of the species, the
  primary aggregation key, and the only species identifier in the
  event:

  ```jsonc
  ["i", "https://www.wikidata.org/entity/Q26825"]
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

  **Deviation from NIP-73.** NIP-73 pairs every `i` tag with a `k` tag
  naming the ID kind (`"web"`, `"isbn"`, `"geo"`, etc.) so that clients
  can query "all events with any external ID of kind X". Birdstar
  deliberately omits the `k` tag: every `i` tag on a kind 2473 event is
  known by the kind contract to be a Wikidata entity URI, so a `k` tag
  would carry no information beyond what the `i` value's URL shape
  already reveals. Queries over these events filter by the specific
  Wikidata URI (or by `kinds: [2473]`), never by the generic `#k: ["web"]`
  bucket which would return every blog post, book, and podcast on the
  relay. The trade-off — Birdstar detections won't show up in generic
  NIP-73 web-content aggregators — is intentional; a species Q-id is
  not a webpage in the sense those aggregators care about.

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
    ["i", "https://www.wikidata.org/entity/Q26825"]
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
  URL is present

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

## Kind 12473 — Birdex

A **replaceable** event (kind `12473`, chosen as `1` prefixed onto the
`2473` detection kind for mnemonic kinship) representing the author's
**Birdex**: the cumulative set of every distinct bird species they
have ever published a kind 2473 detection for.

Replaceable events (10000 ≤ kind < 20000) are deduplicated by relays on
`pubkey + kind`, so each author has at most one Birdex on the network at
any time. Republishing with a newer `created_at` replaces the prior
copy.

### Rationale

Kind 2473 detections are the permanent log; the Birdex is the *index*
derived from them. The log-vs-index split is deliberate:

- **Without the Birdex**, reconstructing a user's species list requires
  paginating their entire kind 2473 history across all relays — expensive
  for clients, unreliable when some relays drop old events, and
  impossible to express as a single filter.
- **With it**, any client can fetch one replaceable event and render the
  user's full species count, first-seen ordering, and profile-page
  "lifer badges" in a single round-trip.
- A new kind (rather than a generic list via NIP-51) is warranted
  because the entries are tightly constrained (Wikidata taxon URIs only)
  and the event has domain-specific semantics (first-seen ordering, tied
  to the kind 2473 author's own detection history).

### `content`

Free-form human-readable description of the Birdex. MAY be empty.
Non-birding clients rendering this event SHOULD prefer the `alt` tag.

### Tags

#### Required

- `alt` (NIP-31) — human-readable summary, e.g.
  `"Birdex: 37 species"`. Lets clients that don't implement this NIP
  still render something meaningful.

#### Species entries

Each species on the Birdex is a single `i` tag (NIP-73) whose value is
the species' Wikidata entity URI — the same identifier vocabulary as
kind 2473:

```jsonc
["i", "https://www.wikidata.org/entity/Q26825"]
```

The same URL-shape rules as kind 2473 apply: `https` scheme, host
`www.wikidata.org`, path `/entity/Q<digits>`, no fragment, no query
string, no trailing slash.

As with kind 2473, the Birdex deliberately omits the `k` tag that
NIP-73 normally pairs with `i`. See the kind 2473 rationale — every
`i` tag on a Birdex is known by the kind contract to be a Wikidata
entity URI, and pairing with `k` would only add noise.

#### Entry ordering

`i` tags MUST be emitted in **chronological order of first detection**,
oldest species first. The position of a species' `i` tag in the tag
array is its ordinal rank on the Birdex ("the 7th species I ever
identified"). Clients rendering a timeline of an author's birding
journey rely on this ordering — it cannot be reconstructed from the
replaceable event alone once the underlying kind 2473 events have aged
off relays.

Each species MUST appear at most once. Republishing the event to add a
newly confirmed species means appending the new `i` tag to the end of
the existing tag list, preserving the historical order of all previous
entries.

### Example

An author whose Birdex holds three species — first a robin, then a
cardinal, then a chickadee:

```jsonc
{
  "kind": 12473,
  "content": "",
  "tags": [
    ["alt", "Birdex: 3 species"],
    ["i", "https://www.wikidata.org/entity/Q26825"],      // American Robin
    ["i", "https://www.wikidata.org/entity/Q27014"],      // Northern Cardinal
    ["i", "https://www.wikidata.org/entity/Q335669"]      // Black-capped Chickadee
  ]
}
```

### Query Patterns

A specific user's Birdex:

```jsonc
{ "kinds": [12473], "authors": ["<hex-pubkey>"], "limit": 1 }
```

All users whose Birdex includes a given species:

```jsonc
{ "kinds": [12473], "#i": ["https://www.wikidata.org/entity/Q26825"] }
```

### Validation

Clients SHOULD ignore an event as a Birdex if:

- `kind !== 12473`
- It is not authored by the pubkey whose Birdex is being queried
  (replaceable events are per-author; the `authors` filter is the trust
  boundary — never trust a 12473 event on its content alone).

When parsing species entries, clients SHOULD:

1. Walk the tag array in order.
2. Accept each `i` tag whose value matches the canonical Wikidata
   entity URI regex; ignore any tag that does not match.
3. Deduplicate by Wikidata URI, keeping the first occurrence — the
   chronologically earliest entry wins.

### Publishing

Birdstar publishes the Birdex automatically for logged-in users. The
publish flow is tied to kind 2473 detections:

1. When a kind 2473 detection is about to be published for a species,
   check whether that species' Wikidata URI is already present in the
   author's existing Birdex (loaded via a single kind 12473 query on
   login).
2. If absent, publish the kind 2473 detection as normal, then publish a
   new kind 12473 event containing every previously-known URI **plus**
   the new one appended at the end.
3. If present, only the kind 2473 event is (re)published subject to the
   usual 10-minute cooldown; the Birdex does not change.

This couples Birdex growth to confirmed detections so the Birdex can
never diverge from the underlying log: every entry has a corresponding
kind 2473 event from the same author.

### Deletion

To retract a species from the Birdex, republish the event with that
species' `i` tag removed. Because kind 12473 is replaceable, the new
event supersedes the old. Separately issuing a NIP-09 deletion on the
underlying kind 2473 events is also recommended if the user wants to
remove the detection log, not just the Birdex entry.

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
