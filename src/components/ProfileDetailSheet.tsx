import { useMemo } from "react";
import { Link } from "react-router-dom";
import { nip19 } from "nostr-tools";
import { Sparkles, Loader2, Copy, Check } from "lucide-react";
import { useSeoMeta } from "@unhead/react";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthor } from "@/hooks/useAuthor";
import { useConstellationsByAuthor } from "@/hooks/useConstellationsByAuthor";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useDeleteConstellation,
} from "@/hooks/useCustomConstellations";
import { useToast } from "@/hooks/useToast";
import { ConstellationCard } from "@/components/ConstellationCard";
import {
  dispatchEditConstellation,
} from "@/lib/editConstellationEvent";
import type { CustomConstellation } from "@/lib/customConstellations";

interface ProfileDetailSheetProps {
  pubkey: string | null;
  onClose: () => void;
}

/**
 * Bottom-sheet overlay for a Nostr profile, mounted over the sky when
 * the URL resolves to an `npub` / `nprofile`. Mirrors the shape of the
 * other detail sheets (`StarDetailSheet`, `ConstellationDetailSheet`)
 * so the app has one consistent overlay pattern.
 *
 * Shows the author's avatar, name, bio, and the constellations they've
 * published, rendered with the shared `ConstellationCard`. When the
 * viewer is looking at their own profile, each constellation card gets
 * a 3-dots menu with Edit / Delete — the same actions available in the
 * constellation drawer's Mine tab.
 */
export function ProfileDetailSheet({
  pubkey,
  onClose,
}: ProfileDetailSheetProps) {
  return (
    <Sheet open={!!pubkey} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="bg-slate-950/95 backdrop-blur-lg border-white/10 text-white p-0 h-[88dvh] max-h-[88dvh] rounded-t-3xl flex flex-col"
      >
        {pubkey && <ProfileContent pubkey={pubkey} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function ProfileContent({
  pubkey,
  onClose,
}: {
  pubkey: string;
  onClose: () => void;
}) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const author = useAuthor(pubkey);
  const { data: constellations, isLoading } = useConstellationsByAuthor(pubkey);
  const { mutate: remove, isPending: deleting } = useDeleteConstellation();

  const metadata = author.data?.metadata;
  const displayName =
    metadata?.name ?? metadata?.display_name ?? 'Anonymous';
  const picture = metadata?.picture;
  const banner = metadata?.banner;
  const about = metadata?.about;

  const npub = useMemo(() => nip19.npubEncode(pubkey), [pubkey]);
  const isOwnProfile = user?.pubkey === pubkey;

  useSeoMeta({
    title: `${displayName} — Birdstar`,
    description:
      about ??
      `Constellations and sky explorations by ${displayName} on Birdstar.`,
  });

  const handleEdit = (c: CustomConstellation) => {
    // Let Index / ConstellationDrawer handle the heavy lifting: open the
    // drawer, enter drawing mode, rehydrate the figure and its metadata.
    dispatchEditConstellation(c);
    onClose();
  };

  const handleDelete = async (c: CustomConstellation) => {
    if (!confirm(`Delete "${c.title}"? This cannot be undone.`)) return;
    try {
      await remove(c.d);
      toast({
        title: "Constellation deleted",
        description: `"${c.title}" has been removed.`,
      });
    } catch (err) {
      toast({
        title: "Couldn't delete",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleCopyNpub = async () => {
    try {
      await navigator.clipboard.writeText(npub);
      toast({ title: "Copied", description: "Npub copied to clipboard." });
    } catch {
      // Clipboard denied — fall back silently; the npub is still visible.
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Drag handle */}
      <div className="flex items-center justify-center pt-3 pb-1 shrink-0">
        <div className="h-1.5 w-10 rounded-full bg-white/20" />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {/* Banner + header block */}
        <div className="relative isolate">
          {banner ? (
            <div className="absolute inset-0 -z-10 overflow-hidden">
              <img
                src={banner}
                alt=""
                className="h-full w-full object-cover opacity-50"
              />
              <div className="absolute inset-0 bg-linear-to-b from-transparent via-slate-950/60 to-slate-950" />
            </div>
          ) : (
            <div className="absolute inset-0 -z-10 bg-linear-to-b from-indigo-900/30 via-slate-900 to-slate-950" />
          )}

          <div className="px-5 pt-4 pb-6">
            <div className="flex items-start gap-4">
              {picture ? (
                <img
                  src={picture}
                  alt=""
                  className="h-20 w-20 rounded-full object-cover ring-4 ring-slate-950 shadow-xl shrink-0"
                />
              ) : (
                <div className="h-20 w-20 rounded-full bg-white/10 ring-4 ring-slate-950 shadow-xl shrink-0" />
              )}
              <div className="min-w-0 flex-1 pt-1">
                <h2 className="text-2xl font-semibold tracking-tight truncate">
                  {displayName}
                </h2>
                {metadata?.nip05 && (
                  <p className="text-xs text-sky-300/90 mt-0.5 truncate">
                    {metadata.nip05}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleCopyNpub}
                  className="inline-flex items-center gap-1 mt-1 text-[11px] text-white/40 hover:text-white/70 font-mono transition-colors"
                  title="Copy npub"
                >
                  <span className="truncate max-w-48">
                    {npub.slice(0, 16)}…{npub.slice(-8)}
                  </span>
                  <Copy className="h-3 w-3 shrink-0" />
                </button>
              </div>
            </div>

            {about && (
              <p className="mt-4 text-sm leading-relaxed text-white/80 whitespace-pre-wrap wrap-break-word">
                {about}
              </p>
            )}

            {isOwnProfile && (
              <div className="mt-4 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-emerald-300/80 bg-emerald-300/5 border border-emerald-300/20 rounded-full px-2.5 py-1">
                <Check className="h-3 w-3" />
                Your profile
              </div>
            )}
          </div>
        </div>

        {/* Constellations */}
        <div className="px-5 pb-6">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-4 w-4 text-amber-200/70" />
            <h3 className="text-xs uppercase tracking-widest text-white/50">
              Constellations
            </h3>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center p-8 text-white/60 text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading…
            </div>
          ) : !constellations || constellations.length === 0 ? (
            <Card className="bg-white/5 border-white/10 border-dashed">
              <CardContent className="py-10 text-center">
                <p className="text-sm text-white/60">
                  {isOwnProfile
                    ? "You haven't published any constellations yet."
                    : `${displayName} hasn't published any constellations yet.`}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {constellations.map((c) => (
                <ConstellationCard
                  key={`${c.pubkey}:${c.d}`}
                  c={c}
                  isMine={isOwnProfile}
                  hideAuthor
                  onBeforeNavigate={onClose}
                  onEdit={isOwnProfile ? () => handleEdit(c) : undefined}
                  onDelete={isOwnProfile ? () => handleDelete(c) : undefined}
                  deleting={deleting}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-white/10 shrink-0 bg-slate-950/80">
        <Button
          variant="outline"
          asChild
          className="w-full bg-white/5 border-white/10 hover:bg-white/10 text-white hover:text-white"
        >
          <Link to="/" onClick={onClose}>
            Back to sky
          </Link>
        </Button>
      </div>
    </div>
  );
}
