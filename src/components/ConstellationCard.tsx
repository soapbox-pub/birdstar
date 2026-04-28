import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { nip19 } from "nostr-tools";
import { MoreHorizontal, Pencil, Trash2, ExternalLink } from "lucide-react";

import { ConstellationPreview } from "@/components/ConstellationPreview";
import { useAuthor } from "@/hooks/useAuthor";
import { genUserName } from "@/lib/genUserName";
import {
  CUSTOM_CONSTELLATION_KIND,
  type CustomConstellation,
} from "@/lib/customConstellations";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { hapticTap } from "@/lib/haptics";
import { cn } from "@/lib/utils";

interface ConstellationCardProps {
  c: CustomConstellation;
  /** Whether the current user owns this constellation (enables Edit/Delete). */
  isMine: boolean;
  /** Hide the per-card author chip — used on profile views where every
      card is by the same person and repeating the byline is noise. */
  hideAuthor?: boolean;
  /** Called before navigating so parent overlays (drawer / profile sheet)
      can dismiss themselves to reveal the newly-opened constellation. */
  onBeforeNavigate?: () => void;
  /** Edit handler, shown in the kebab menu. Only wired when `isMine`. */
  onEdit?: () => void;
  /** Delete handler, shown in the kebab menu. Only wired when `isMine`. */
  onDelete?: () => void;
  /** Disable the Delete item while a deletion is in flight. */
  deleting?: boolean;
}

/**
 * Uniform tile card used wherever we list custom constellations —
 * profile sheets, the community feed, and the "mine" tab of the
 * constellation drawer.
 *
 * The card itself is a `<Link>` to the constellation's naddr page.
 * The kebab menu is a nested button that `stopPropagation`s its events
 * so tapping the menu doesn't also open the card.
 */
export function ConstellationCard({
  c,
  isMine,
  hideAuthor,
  onBeforeNavigate,
  onEdit,
  onDelete,
  deleting,
}: ConstellationCardProps) {
  const navigate = useNavigate();
  const author = useAuthor(c.pubkey);
  const displayName =
    author.data?.metadata?.name ??
    author.data?.metadata?.display_name ??
    genUserName(c.pubkey);
  const picture = author.data?.metadata?.picture;

  const naddr = useMemo(
    () =>
      nip19.naddrEncode({
        kind: CUSTOM_CONSTELLATION_KIND,
        pubkey: c.pubkey,
        identifier: c.d,
      }),
    [c.pubkey, c.d],
  );
  const npub = useMemo(() => nip19.npubEncode(c.pubkey), [c.pubkey]);

  const hasMenu = isMine && (onEdit || onDelete);

  const openDetail = () => {
    hapticTap();
    onBeforeNavigate?.();
    navigate(`/${naddr}`);
  };

  return (
    <div
      className={cn(
        "group relative rounded-2xl border overflow-hidden transition-colors",
        "bg-white/[0.04] border-white/10 hover:border-white/20 hover:bg-white/[0.06]",
      )}
    >
      {/* Clickable card body. Using a <div role="button"> (rather than an
          <a>) so we can safely nest the author chip <Link> and the
          kebab <button> without invalid interactive-nesting HTML. */}
      <div
        role="button"
        tabIndex={0}
        onClick={openDetail}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openDetail();
          }
        }}
        className="w-full text-left cursor-pointer"
        title={`Open ${c.title}`}
      >
        {/* Hero preview (4:3) */}
        <div className="relative aspect-[4/3]">
          <ConstellationPreview
            edges={c.edges}
            ariaLabel={`Preview of ${c.title}`}
            className="!rounded-none"
          />
        </div>

        <div className="p-3 pr-10">
          <div className="font-semibold text-sm text-white group-hover:text-amber-100 transition-colors line-clamp-1">
            {c.title}
          </div>
          {!hideAuthor && (
            <Link
              to={`/${npub}`}
              onClick={(e) => {
                e.stopPropagation();
                hapticTap();
                onBeforeNavigate?.();
              }}
              className="inline-flex items-center gap-1.5 mt-1.5 -mx-1 px-1 py-0.5 rounded-full hover:bg-white/5 transition-colors max-w-full"
              title={`View ${isMine ? "your" : displayName + "'s"} profile`}
            >
              {picture ? (
                <img
                  src={picture}
                  alt=""
                  className="h-4 w-4 rounded-full object-cover flex-shrink-0 ring-1 ring-white/10"
                />
              ) : (
                <div className="h-4 w-4 rounded-full bg-white/10 flex-shrink-0" />
              )}
              <span className="text-xs text-white/60 truncate hover:text-white/80">
                {isMine ? "You" : displayName}
              </span>
            </Link>
          )}
          {c.description && (
            <p className="text-xs text-white/60 mt-1.5 line-clamp-2">
              {c.description}
            </p>
          )}
        </div>
      </div>

      {/* Kebab menu, positioned absolutely in the top-right corner of the
          card. Only rendered for owned constellations. We also expose a
          "View on njump.me" entry for any card so users can jump to a
          third-party Nostr viewer if they want. */}
      <div className="absolute top-2 right-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => e.stopPropagation()}
              aria-label="Constellation options"
              className="h-7 w-7 rounded-full bg-slate-950/60 hover:bg-slate-950/80 backdrop-blur text-white/80 hover:text-white border border-white/10"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            // Stop clicks inside the menu from bubbling up and triggering
            // the card's onClick.
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-950/95 border-white/10 text-white backdrop-blur-lg"
          >
            {hasMenu && onEdit && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="focus:bg-white/10 focus:text-white cursor-pointer"
              >
                <Pencil className="h-3.5 w-3.5 mr-2" />
                Edit
              </DropdownMenuItem>
            )}
            {hasMenu && onDelete && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                disabled={deleting}
                className="text-rose-300 focus:bg-rose-500/15 focus:text-rose-200 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            )}
            {hasMenu && <DropdownMenuSeparator className="bg-white/10" />}
            <DropdownMenuItem
              asChild
              className="focus:bg-white/10 focus:text-white cursor-pointer"
            >
              <a
                href={`https://njump.me/${naddr}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-2" />
                View on njump.me
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
