import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Loader2, BookOpen, AlertCircle } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CommentsSection } from "@/components/comments/CommentsSection";
import { useWikipediaSummary } from "@/hooks/useWikipediaSummary";
import type { Star } from "@/lib/stars";
import { bvToColor } from "@/lib/stars";
import { iauCodeToZodiac } from "@/lib/zodiac";

/**
 * Full table of all 88 IAU constellations, keyed by 3-letter abbreviation.
 * Covers every star the catalog can surface.
 */
const CONSTELLATION_NAMES: Record<string, string> = {
  And: "Andromeda",
  Ant: "Antlia",
  Aps: "Apus",
  Aqr: "Aquarius",
  Aql: "Aquila",
  Ara: "Ara",
  Ari: "Aries",
  Aur: "Auriga",
  Boo: "Boötes",
  Cae: "Caelum",
  Cam: "Camelopardalis",
  Cnc: "Cancer",
  CVn: "Canes Venatici",
  CMa: "Canis Major",
  CMi: "Canis Minor",
  Cap: "Capricornus",
  Car: "Carina",
  Cas: "Cassiopeia",
  Cen: "Centaurus",
  Cep: "Cepheus",
  Cet: "Cetus",
  Cha: "Chamaeleon",
  Cir: "Circinus",
  Col: "Columba",
  Com: "Coma Berenices",
  CrA: "Corona Australis",
  CrB: "Corona Borealis",
  Crv: "Corvus",
  Crt: "Crater",
  Cru: "Crux",
  Cyg: "Cygnus",
  Del: "Delphinus",
  Dor: "Dorado",
  Dra: "Draco",
  Equ: "Equuleus",
  Eri: "Eridanus",
  For: "Fornax",
  Gem: "Gemini",
  Gru: "Grus",
  Her: "Hercules",
  Hor: "Horologium",
  Hya: "Hydra",
  Hyi: "Hydrus",
  Ind: "Indus",
  Lac: "Lacerta",
  Leo: "Leo",
  LMi: "Leo Minor",
  Lep: "Lepus",
  Lib: "Libra",
  Lup: "Lupus",
  Lyn: "Lynx",
  Lyr: "Lyra",
  Men: "Mensa",
  Mic: "Microscopium",
  Mon: "Monoceros",
  Mus: "Musca",
  Nor: "Norma",
  Oct: "Octans",
  Oph: "Ophiuchus",
  Ori: "Orion",
  Pav: "Pavo",
  Peg: "Pegasus",
  Per: "Perseus",
  Phe: "Phoenix",
  Pic: "Pictor",
  Psc: "Pisces",
  PsA: "Piscis Austrinus",
  Pup: "Puppis",
  Pyx: "Pyxis",
  Ret: "Reticulum",
  Sge: "Sagitta",
  Sgr: "Sagittarius",
  Sco: "Scorpius",
  Scl: "Sculptor",
  Sct: "Scutum",
  Ser: "Serpens",
  Sex: "Sextans",
  Tau: "Taurus",
  Tel: "Telescopium",
  Tri: "Triangulum",
  TrA: "Triangulum Australe",
  Tuc: "Tucana",
  UMa: "Ursa Major",
  UMi: "Ursa Minor",
  Vel: "Vela",
  Vir: "Virgo",
  Vol: "Volans",
  Vul: "Vulpecula",
};

/**
 * Approximate a Harvard spectral class letter from a Johnson B-V index.
 * Used only for the human-readable "class K" label in the detail header —
 * the actual rendering color comes from `bvToColor` for smooth
 * interpolation. Thresholds are standard textbook values.
 */
function bvToSpectralClass(bv: number | undefined): string | undefined {
  if (bv === undefined || !Number.isFinite(bv)) return undefined;
  if (bv < -0.30) return "O";
  if (bv < -0.02) return "B";
  if (bv <  0.30) return "A";
  if (bv <  0.58) return "F";
  if (bv <  0.81) return "G";
  if (bv <  1.40) return "K";
  return "M";
}

/**
 * Build candidate Wikipedia titles to try, ordered from least to most
 * ambiguous. Wikipedia maintains `HIP <n>` redirects for most famous
 * stars, pointing directly at the canonical article — so we try that
 * first. For dim stars where no HIP redirect exists, we fall back to
 * Bayer designation, then to the common name.
 *
 * Wikipedia's REST summary API follows redirects, so asking for
 * "Alpha Lyrae" still returns the "Vega" article with its canonical URL.
 * That means comment thread identity (derived from the article's
 * Wikidata entity Q-ID) is stable regardless of which candidate matches.
 */
function buildCandidates(star: Star): string[] {
  const candidates: string[] = [];

  // 1. HIP redirect — present for virtually every famous star on Wikipedia
  // (tested: 100% coverage for the top ~200 named stars). Resolves all
  // historically-ambiguous cases (Algenib, Gienah, Peacock) correctly
  // without any hand-maintained override table.
  candidates.push(`HIP ${star.hip}`);

  // 2. Bayer designation, e.g. "Alpha Pavonis" — globally unambiguous
  if (star.bayer && star.constellation) {
    const greekName = greekNames[star.bayer];
    const genitive = constellationGenitive[star.constellation];
    if (greekName && genitive) {
      candidates.push(`${greekName} ${genitive}`);
    }
  }

  // 3. "Name (star)" — Wikipedia's own disambiguation convention
  if (star.name) {
    candidates.push(`${star.name} (star)`);
  }

  // 4. Plain common name — last resort (may hit the wrong article)
  if (star.name) {
    candidates.push(star.name);
  }

  return candidates;
}

const greekNames: Record<string, string> = {
  "α": "Alpha",
  "β": "Beta",
  "γ": "Gamma",
  "δ": "Delta",
  "ε": "Epsilon",
  "ζ": "Zeta",
  "η": "Eta",
  "θ": "Theta",
  "ι": "Iota",
  "κ": "Kappa",
  "λ": "Lambda",
  "μ": "Mu",
  "ν": "Nu",
  "ξ": "Xi",
  "ο": "Omicron",
  "π": "Pi",
  "ρ": "Rho",
  "σ": "Sigma",
  "τ": "Tau",
  "υ": "Upsilon",
  "φ": "Phi",
  "χ": "Chi",
  "ψ": "Psi",
  "ω": "Omega",
};

/**
 * Latin genitive constellation names, used in Bayer designations like
 * "Alpha Canis Majoris" (Sirius). Covers all 88 IAU constellations.
 */
const constellationGenitive: Record<string, string> = {
  And: "Andromedae",
  Ant: "Antliae",
  Aps: "Apodis",
  Aqr: "Aquarii",
  Aql: "Aquilae",
  Ara: "Arae",
  Ari: "Arietis",
  Aur: "Aurigae",
  Boo: "Boötis",
  Cae: "Caeli",
  Cam: "Camelopardalis",
  Cnc: "Cancri",
  CVn: "Canum Venaticorum",
  CMa: "Canis Majoris",
  CMi: "Canis Minoris",
  Cap: "Capricorni",
  Car: "Carinae",
  Cas: "Cassiopeiae",
  Cen: "Centauri",
  Cep: "Cephei",
  Cet: "Ceti",
  Cha: "Chamaeleontis",
  Cir: "Circini",
  Col: "Columbae",
  Com: "Comae Berenices",
  CrA: "Coronae Australis",
  CrB: "Coronae Borealis",
  Crv: "Corvi",
  Crt: "Crateris",
  Cru: "Crucis",
  Cyg: "Cygni",
  Del: "Delphini",
  Dor: "Doradus",
  Dra: "Draconis",
  Equ: "Equulei",
  Eri: "Eridani",
  For: "Fornacis",
  Gem: "Geminorum",
  Gru: "Gruis",
  Her: "Herculis",
  Hor: "Horologii",
  Hya: "Hydrae",
  Hyi: "Hydri",
  Ind: "Indi",
  Lac: "Lacertae",
  Leo: "Leonis",
  LMi: "Leonis Minoris",
  Lep: "Leporis",
  Lib: "Librae",
  Lup: "Lupi",
  Lyn: "Lyncis",
  Lyr: "Lyrae",
  Men: "Mensae",
  Mic: "Microscopii",
  Mon: "Monocerotis",
  Mus: "Muscae",
  Nor: "Normae",
  Oct: "Octantis",
  Oph: "Ophiuchi",
  Ori: "Orionis",
  Pav: "Pavonis",
  Peg: "Pegasi",
  Per: "Persei",
  Phe: "Phoenicis",
  Pic: "Pictoris",
  Psc: "Piscium",
  PsA: "Piscis Austrini",
  Pup: "Puppis",
  Pyx: "Pyxidis",
  Ret: "Reticuli",
  Sge: "Sagittae",
  Sgr: "Sagittarii",
  Sco: "Scorpii",
  Scl: "Sculptoris",
  Sct: "Scuti",
  Ser: "Serpentis",
  Sex: "Sextantis",
  Tau: "Tauri",
  Tel: "Telescopii",
  Tri: "Trianguli",
  TrA: "Trianguli Australis",
  Tuc: "Tucanae",
  UMa: "Ursae Majoris",
  UMi: "Ursae Minoris",
  Vel: "Velorum",
  Vir: "Virginis",
  Vol: "Volantis",
  Vul: "Vulpeculae",
};

interface StarDetailSheetProps {
  star: Star | null;
  onClose: () => void;
}

export function StarDetailSheet({ star, onClose }: StarDetailSheetProps) {
  const candidates = useMemo(() => (star ? buildCandidates(star) : []), [star]);
  const { data: wiki, isLoading, error } = useWikipediaSummary(candidates);

  // Identifier for the NIP-73 comment thread. We prefer the Wikidata
  // entity URI (e.g. `https://www.wikidata.org/entity/Q3409`) because:
  //   - It's language-neutral — English, Spanish, and Japanese speakers
  //     discussing Sirius all converge on the same thread.
  //   - It's rename-stable — Wikipedia article renames don't fragment it.
  //   - It's the spec-endorsed canonical URI for the entity itself
  //     (Wikidata:Identifiers defines `entity/<id>` as THE globally
  //     unique URI; the `wiki/<id>` page is just one representation).
  //
  // Fall back to the Wikipedia page URL for the rare articles that have
  // no linked Wikidata item.
  const commentUrl = useMemo(() => {
    if (wiki?.wikibaseItem) {
      return new URL(`https://www.wikidata.org/entity/${wiki.wikibaseItem}`);
    }
    if (wiki?.pageUrl) return new URL(wiki.pageUrl);
    // While loading or if not found, don't render comments (URL unknown).
    return null;
  }, [wiki]);

  return (
    <Sheet open={!!star} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Use dvh (dynamic viewport height) so the sheet fits inside the
        // *currently visible* viewport, accounting for mobile browser UI
        // (address bar, bottom toolbar, etc). vh would overflow upward past
        // the top of the screen and cut off the title.
        className="bg-slate-950/95 backdrop-blur-lg border-white/10 text-white p-0 h-[88dvh] max-h-[88dvh] rounded-t-3xl flex flex-col"
      >
        {star && (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Drag handle */}
            <div className="flex items-center justify-center pt-3 pb-1 flex-shrink-0">
              <div className="h-1.5 w-10 rounded-full bg-white/20" />
            </div>

            {/* Header (star identity) */}
            <div className="px-5 pb-4 border-b border-white/10 flex-shrink-0">
              <div className="flex items-start gap-3">
                <div
                  className="mt-1.5 h-4 w-4 rounded-full flex-shrink-0 shadow-[0_0_16px_currentColor]"
                  style={{
                    backgroundColor: bvToColor(star.bv),
                    color: bvToColor(star.bv),
                  }}
                />
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    {star.name ?? "Unnamed star"}
                  </h2>
                  <p className="text-sm text-white/60 mt-0.5">
                    {star.bayer && <span>{star.bayer} </span>}
                    {(() => {
                      // Show the full constellation name when we have
                      // one, else fall back to the IAU code. When the
                      // constellation is a zodiac sign, make it a link
                      // into the dedicated zodiac view — the other 76
                      // IAU constellations have no dedicated page yet
                      // so they render as plain text.
                      const code = star.constellation;
                      const full = code ? CONSTELLATION_NAMES[code] : undefined;
                      const label = full ?? code ?? "—";
                      const zodiac = code ? iauCodeToZodiac(code) : null;
                      if (zodiac) {
                        return (
                          <Link
                            to={`/zodiac/${zodiac}`}
                            replace
                            className="hover:text-white transition-colors underline-offset-2 hover:underline"
                            title={`Open ${label}`}
                          >
                            {label}
                          </Link>
                        );
                      }
                      return <span>{label}</span>;
                    })()}
                    {" · "}
                    <span className="tabular-nums">mag {star.mag.toFixed(2)}</span>
                    {(() => {
                      const cls = bvToSpectralClass(star.bv);
                      return cls ? <span> · class {cls}</span> : null;
                    })()}
                  </p>
                </div>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <div className="p-5 space-y-5">
                {/* Wikipedia section */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen className="h-4 w-4 text-white/50" />
                    <h3 className="text-xs uppercase tracking-widest text-white/50">
                      Wikipedia
                    </h3>
                  </div>

                  {isLoading && (
                    <Card className="bg-white/5 border-white/10">
                      <CardContent className="p-4 flex items-center gap-3 text-sm text-white/70">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading article…
                      </CardContent>
                    </Card>
                  )}

                  {error && !isLoading && (
                    <Card className="bg-white/5 border-white/10">
                      <CardContent className="p-4 flex items-start gap-3 text-sm text-white/70">
                        <AlertCircle className="h-4 w-4 mt-0.5 text-amber-300" />
                        <div>
                          <div className="font-medium text-white">
                            No matching Wikipedia article found
                          </div>
                          <div className="text-xs mt-1 text-white/60">
                            Comments are unavailable until an article can be
                            linked.
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {wiki && (
                    <Card className="bg-white/5 border-white/10 overflow-hidden">
                      {wiki.thumbnail && (
                        <div className="relative w-full aspect-[16/9] bg-black/40">
                          <img
                            src={wiki.thumbnail.source}
                            alt={wiki.displayTitle}
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent" />
                        </div>
                      )}
                      <CardContent className="p-4 space-y-3">
                        <div>
                          <div
                            className="text-base font-semibold"
                            dangerouslySetInnerHTML={{ __html: wiki.displayTitle }}
                          />
                          {wiki.description && (
                            <div className="text-xs text-white/60 mt-0.5 capitalize">
                              {wiki.description}
                            </div>
                          )}
                        </div>
                        <p className="text-sm leading-relaxed text-white/80">
                          {wiki.extract}
                        </p>
                        <a
                          href={wiki.pageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200 transition-colors"
                        >
                          Read on Wikipedia
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </CardContent>
                    </Card>
                  )}
                </section>

                {/* Comments */}
                <section>
                  {commentUrl ? (
                    <CommentsSection
                      root={commentUrl}
                      emptyStateMessage="No comments yet"
                      emptyStateSubtitle={`Be the first to discuss ${star.name ?? "this star"} on Nostr.`}
                    />
                  ) : (
                    <Card className="bg-white/5 border-white/10">
                      <CardContent className="p-4 text-sm text-white/60">
                        Comments will appear once a Wikipedia article is linked.
                      </CardContent>
                    </Card>
                  )}
                </section>
              </div>
            </div>

            <div className="p-4 border-t border-white/10 flex-shrink-0 bg-slate-950/80">
              <Button
                variant="outline"
                className="w-full bg-white/5 border-white/10 hover:bg-white/10 text-white hover:text-white"
                onClick={onClose}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
