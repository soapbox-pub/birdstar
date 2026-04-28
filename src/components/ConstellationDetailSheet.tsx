import { useMemo } from "react";
import { Link } from "react-router-dom";
import { nip19 } from "nostr-tools";
import { Star as StarIcon, Calendar } from "lucide-react";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CommentsSection } from "@/components/comments/CommentsSection";
import { ConstellationPreview } from "@/components/ConstellationPreview";
import { ZapButton } from "@/components/ZapButton";
import { useAuthor } from "@/hooks/useAuthor";
import { genUserName } from "@/lib/genUserName";
import { starByHip } from "@/lib/stars";
import type { CustomConstellation } from "@/lib/customConstellations";
import { cn } from "@/lib/utils";

interface ConstellationDetailSheetProps {
  constellation: CustomConstellation | null;
  onClose: () => void;
}

/**
 * Full-sheet view of a custom constellation, modeled on StarDetailSheet.
 *
 * Shows title, author, description (the event's `content`), a quick list
 * of the named stars the figure connects through, and a Nostr comment
 * thread anchored to the constellation event itself (kind 30621).
 *
 * Using the raw addressable event as the comment root means all replies
 * to subsequent edits of the same constellation converge on one thread —
 * replacement events with the same kind+pubkey+d all resolve to the same
 * NIP-22 root address.
 */
export function ConstellationDetailSheet({
  constellation,
  onClose,
}: ConstellationDetailSheetProps) {
  const c = constellation;
  const author = useAuthor(c?.pubkey ?? "");

  // Unique HIP numbers referenced by this figure, in first-appearance
  // order. This is how we display the "stars in this figure" list.
  // Derived eagerly because it's tiny and purely deterministic.
  const uniqueHips = useMemo(() => {
    if (!c) return [];
    const seen = new Set<number>();
    const out: number[] = [];
    for (const [a, b] of c.edges) {
      if (!seen.has(a)) {
        seen.add(a);
        out.push(a);
      }
      if (!seen.has(b)) {
        seen.add(b);
        out.push(b);
      }
    }
    return out;
  }, [c]);

  const displayName =
    author.data?.metadata?.name ??
    author.data?.metadata?.display_name ??
    (c ? genUserName(c.pubkey) : "");
  const picture = author.data?.metadata?.picture;

  const authorNpub = useMemo(
    () => (c ? nip19.npubEncode(c.pubkey) : ""),
    [c],
  );

  const createdAtLabel = useMemo(() => {
    if (!c) return "";
    const d = new Date(c.createdAt * 1000);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, [c]);

  return (
    <Sheet open={!!c} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="bg-slate-950/95 backdrop-blur-lg border-white/10 text-white p-0 h-[88dvh] max-h-[88dvh] rounded-t-3xl flex flex-col"
      >
        {c && (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Drag handle */}
            <div className="flex items-center justify-center pt-3 pb-1 shrink-0">
              <div className="h-1.5 w-10 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="px-5 pb-4 border-b border-white/10 shrink-0">
              <div className="min-w-0">
                <h2 className="text-2xl font-semibold tracking-tight truncate">
                  {c.title}
                </h2>
                {/* "by <author>" is a link into the author's profile
                    page. Closing the sheet is handled by the
                    profile route taking over from `/`. */}
                <Link
                  to={`/${authorNpub}`}
                  className="inline-flex items-center gap-1.5 mt-1 text-sm text-white/60 hover:text-white transition-colors min-w-0 -mx-1 px-1 py-0.5 rounded-full hover:bg-white/5"
                  title={`View ${displayName}'s profile`}
                >
                  {picture ? (
                    <img
                      src={picture}
                      alt=""
                      className="h-4 w-4 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-4 w-4 rounded-full bg-white/10 shrink-0" />
                  )}
                  <span className="truncate">by {displayName}</span>
                </Link>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <div className="p-5 space-y-5">
                {/* Hero preview — a large rendering of the figure, shown in
                    the same slot Wikipedia images occupy on star views. */}
                <Card className="bg-white/5 border-white/10 overflow-hidden">
                  <div className="relative w-full aspect-4/3">
                    <ConstellationPreview
                      edges={c.edges}
                      ariaLabel={`Preview of ${c.title}`}
                      className="rounded-none!"
                      interactive
                    />
                    <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-slate-950/70 via-transparent to-transparent" />
                  </div>
                  {c.description && (
                    <CardContent className="p-4">
                      <p className="text-sm leading-relaxed text-white/85 whitespace-pre-wrap wrap-break-word">
                        {c.description}
                      </p>
                    </CardContent>
                  )}
                </Card>

                {/* Stars in this figure */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <StarIcon className="h-4 w-4 text-white/50" />
                    <h3 className="text-xs uppercase tracking-widest text-white/50">
                      Stars
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {uniqueHips.map((hip) => {
                      const s = starByHip(hip);
                      const label = s?.name ?? s?.bayer ?? `HIP ${hip}`;
                      // Only make the chip clickable if the star exists
                      // in the catalog — otherwise the target route
                      // would 404.
                      const content = (
                        <>
                          <span className="text-white/85">{label}</span>
                          {s?.constellation && (
                            <span className="text-white/40">
                              {s.constellation}
                            </span>
                          )}
                        </>
                      );
                      const classes =
                        "inline-flex items-center gap-1 rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-xs";
                      if (s) {
                        return (
                          <Link
                            key={hip}
                            to={`/star/${hip}`}
                            replace
                            className={cn(
                              classes,
                              "hover:bg-white/10 hover:border-white/20 transition-colors cursor-pointer",
                            )}
                            title={`Open ${label}`}
                          >
                            {content}
                          </Link>
                        );
                      }
                      return (
                        <span
                          key={hip}
                          className={classes}
                          title={`HIP ${hip}`}
                        >
                          {content}
                        </span>
                      );
                    })}
                  </div>
                </section>

                {/* Meta row: date + zap */}
                <section className="flex items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-1.5 text-xs text-white/50">
                    <Calendar className="h-3.5 w-3.5" />
                    <span className="tabular-nums">
                      Published {createdAtLabel}
                    </span>
                  </div>
                  <ZapButton
                    target={c.event}
                    className="text-xs rounded-full bg-white/5 hover:bg-white/10 px-3 py-1.5 cursor-pointer transition-colors"
                  />
                </section>

                {/* Nostr comments */}
                <section>
                  <CommentsSection
                    root={c.event}
                    emptyStateMessage="No comments yet"
                    emptyStateSubtitle={`Be the first to discuss "${c.title}" on Nostr.`}
                  />
                </section>
              </div>
            </div>

            <div className="p-4 border-t border-white/10 shrink-0 bg-slate-950/80">
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
