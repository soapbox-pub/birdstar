import { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  Pencil,
  Undo2,
  Trash2,
  Check,
  Globe2,
  User,
  Loader2,
  X as XIcon,
  PlusCircle,
} from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/useToast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useCustomConstellations,
  useMyCustomConstellations,
  usePublishConstellation,
  useDeleteConstellation,
} from "@/hooks/useCustomConstellations";
import {
  type CustomConstellation,
} from "@/lib/customConstellations";
import { ConstellationCard } from "@/components/ConstellationCard";
import { slugify } from "@/lib/customConstellations";
import { starByHip } from "@/lib/stars";
import {
  EDIT_CONSTELLATION_EVENT,
  dispatchEditConstellation,
  type EditConstellationDetail,
} from "@/lib/editConstellationEvent";
import { hapticTick } from "@/lib/haptics";

interface ConstellationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether we're currently in draw mode on the sky. */
  drawingMode: boolean;
  /** Stars (by HIP catalog number) currently queued in the figure being drawn. */
  drawingStars: number[];
  onStartDrawing: () => void;
  onCancelDrawing: () => void;
  onUndoStar: () => void;
  onClearStars: () => void;
  onFinishDrawing: () => void;
}

export function ConstellationDrawer({
  open,
  onOpenChange,
  drawingMode,
  drawingStars,
  onStartDrawing,
  onCancelDrawing,
  onUndoStar,
  onClearStars,
  onFinishDrawing,
}: ConstellationDrawerProps) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { data: all, isLoading: loadingAll } = useCustomConstellations();
  const { data: mine, isLoading: loadingMine } = useMyCustomConstellations();
  const { mutate: publish, isPending: publishing } = usePublishConstellation();
  const { mutate: remove, isPending: deleting } = useDeleteConstellation();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tab, setTab] = useState<"mine" | "community">("mine");
  const [editingSlug, setEditingSlug] = useState<string | null>(null);

  // When the sheet closes we don't clear the pencil state — the user is
  // likely going back to the sky to tap more stars. We DO reset only when
  // they finish publishing successfully.
  const edges = useMemo<Array<[number, number]>>(() => {
    const arr: Array<[number, number]> = [];
    for (let i = 0; i < drawingStars.length - 1; i++) {
      arr.push([drawingStars[i], drawingStars[i + 1]]);
    }
    return arr;
  }, [drawingStars]);

  // Ensure the Mine tab is active whenever the sheet opens or the user
  // starts/extends an in-progress drawing, since that's where the draw
  // pane now lives. Tracks previous `open` and drawing-empty state in
  // siblings refs and adjusts during render rather than in an effect,
  // which avoids the react-hooks/set-state-in-effect warning and cuts
  // an extra render cycle on every tab switch.
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevHasDrawing, setPrevHasDrawing] = useState(drawingStars.length > 0);
  const hasDrawing = drawingStars.length > 0;
  if (prevOpen !== open || prevHasDrawing !== hasDrawing) {
    setPrevOpen(open);
    setPrevHasDrawing(hasDrawing);
    // Fire on the open false→true edge (reopening with a drawing) and
    // on the hasDrawing false→true edge (starting a drawing with the
    // sheet already open). Don't fire on the opposite edges — we
    // don't want to snap back to "mine" when the user clears their
    // drawing or closes the sheet.
    const openedWithDrawing = !prevOpen && open && hasDrawing;
    const startedDrawingWhileOpen = open && !prevHasDrawing && hasDrawing;
    if ((openedWithDrawing || startedDrawingWhileOpen) && tab !== "mine") {
      setTab("mine");
    }
  }

  // Listen for the cross-component "edit this constellation" event so
  // that Edit triggered from elsewhere (profile sheet, our own kebab
  // menu) populates our form and switches to the Mine tab. The stars
  // themselves are handled by Index's listener on the same event.
  useEffect(() => {
    const onEdit = (e: Event) => {
      const detail = (e as CustomEvent<EditConstellationDetail>).detail;
      if (!detail) return;
      setTitle(detail.title);
      setDescription(detail.description);
      setEditingSlug(detail.d);
      setTab("mine");
    };
    window.addEventListener(EDIT_CONSTELLATION_EVENT, onEdit);
    return () => window.removeEventListener(EDIT_CONSTELLATION_EVENT, onEdit);
  }, []);

  const handlePublish = async () => {
    if (!user) {
      toast({
        title: "Log in to publish",
        description: "Sign in with Nostr to share constellations.",
      });
      return;
    }
    if (!title.trim()) {
      toast({
        title: "Name your constellation",
        description: "Give it a title before publishing.",
      });
      return;
    }
    if (edges.length === 0) {
      toast({
        title: "Needs at least two stars",
        description: "Tap two or more stars to form a figure.",
      });
      return;
    }
    try {
      const slug = editingSlug ?? slugify(title);
      await publish({
        d: slug,
        title: title.trim(),
        edges,
        description: description.trim(),
      });
      hapticTick();
      toast({
        title: "Constellation published",
        description: `"${title.trim()}" is now on Nostr.`,
      });
      setTitle("");
      setDescription("");
      setEditingSlug(null);
      onClearStars();
      onCancelDrawing();
      setTab("mine");
    } catch (err) {
      toast({
        title: "Couldn't publish",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleEdit = (c: CustomConstellation) => {
    // Route through the shared event so Index handles the drawing-state
    // side (drawing mode + drawingStars) and we handle the form side
    // (title / description / editingSlug) via our own listener above.
    dispatchEditConstellation(c);
    // Close the drawer so the user can actually see the stars they need
    // to tap on the sky.
    onOpenChange(false);
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-slate-950/95 border-white/10 text-white backdrop-blur-lg p-0 h-[85dvh] max-h-[85dvh] rounded-t-3xl flex flex-col"
      >
        <div className="flex items-center justify-center pt-3 pb-1 shrink-0">
          <div className="h-1.5 w-10 rounded-full bg-white/20" />
        </div>
        <SheetHeader className="px-5 pb-3 text-left">
          <SheetTitle className="text-white flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-300" />
            Constellations
          </SheetTitle>
          <SheetDescription className="text-white/60">
            Trace your own figures in the stars and share them on Nostr.
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as typeof tab)}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="px-5 shrink-0">
            <TabsList className="bg-white/5 border border-white/10 grid grid-cols-2 w-full">
              <TabsTrigger value="mine" className="data-[state=active]:bg-white/10">
                <User className="h-3.5 w-3.5 mr-1.5" />
                Mine
              </TabsTrigger>
              <TabsTrigger value="community" className="data-[state=active]:bg-white/10">
                <Globe2 className="h-3.5 w-3.5 mr-1.5" />
                Community
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="community" className="flex-1 overflow-hidden m-0 mt-4">
            <ScrollArea className="h-full px-5 pb-6">
              <ConstellationGrid
                items={all ?? []}
                loading={loadingAll}
                emptyLabel="No community constellations yet. Be the first!"
                onCloseDrawer={() => onOpenChange(false)}
                currentUserPubkey={user?.pubkey}
              />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="mine" className="flex-1 overflow-hidden m-0 mt-4">
            <ScrollArea className="h-full px-5 pb-6">
              <div className="space-y-5">
                <DrawPane
                  drawingMode={drawingMode}
                  drawingStars={drawingStars}
                  title={title}
                  description={description}
                  onTitle={setTitle}
                  onDescription={setDescription}
                  onStart={onStartDrawing}
                  onCancel={() => {
                    onCancelDrawing();
                    setEditingSlug(null);
                    setTitle("");
                    setDescription("");
                  }}
                  onUndo={onUndoStar}
                  onClear={onClearStars}
                  onFinish={onFinishDrawing}
                  onPublish={handlePublish}
                  publishing={publishing}
                  isEditing={!!editingSlug}
                  loggedIn={!!user}
                />

                {!user ? (
                  <div className="text-sm text-white/60 p-6 text-center rounded-xl border border-dashed border-white/10">
                    Log in with Nostr to see your published constellations here.
                  </div>
                ) : (
                  <ConstellationGrid
                    items={mine ?? []}
                    loading={loadingMine}
                    emptyLabel="You haven't published any constellations yet."
                    onCloseDrawer={() => onOpenChange(false)}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    deleting={deleting}
                    currentUserPubkey={user.pubkey}
                    // On the Mine tab every card is by the same person
                    // (the viewer), so the author chip is pure noise.
                    hideAuthor
                  />
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function DrawPane({
  drawingMode,
  drawingStars,
  title,
  description,
  onTitle,
  onDescription,
  onStart,
  onCancel,
  onUndo,
  onClear,
  onFinish,
  onPublish,
  publishing,
  isEditing,
  loggedIn,
}: {
  drawingMode: boolean;
  drawingStars: number[];
  title: string;
  description: string;
  onTitle: (v: string) => void;
  onDescription: (v: string) => void;
  onStart: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onClear: () => void;
  onFinish: () => void;
  onPublish: () => void;
  publishing: boolean;
  isEditing: boolean;
  loggedIn: boolean;
}) {
  const canPublish = drawingStars.length >= 2 && title.trim().length > 0;

  return (
    <div className="space-y-5">
      {!drawingMode ? (
        <Button
          onClick={onStart}
          className="w-full bg-linear-to-r from-indigo-500 to-amber-300 text-slate-900 hover:opacity-90 font-semibold"
        >
          <PlusCircle className="h-4 w-4 mr-2" />
          Start drawing
        </Button>
      ) : (
        <>
          <div className="rounded-2xl border border-amber-200/30 bg-amber-300/5 p-4 space-y-3">
            <div className="flex items-center gap-2 text-amber-200 text-sm font-semibold">
              <Pencil className="h-4 w-4" />
              Drawing mode
              {isEditing && (
                <span className="ml-auto text-[10px] uppercase tracking-widest text-amber-200/70">
                  editing
                </span>
              )}
            </div>
            <p className="text-xs text-white/70 leading-relaxed">
              Close this sheet and tap stars on the sky to connect them in
              order. Return here to finish and publish.
            </p>

            <div>
              <div className="text-xs uppercase tracking-widest text-white/50 mb-1.5">
                {drawingStars.length === 0
                  ? "No stars picked yet"
                  : `${drawingStars.length} star${drawingStars.length === 1 ? "" : "s"}`}
              </div>
              {drawingStars.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {drawingStars.map((hip, i) => {
                    const s = starByHip(hip);
                    const label = s?.name ?? `HIP ${hip}`;
                    return (
                      <span
                        key={`${hip}-${i}`}
                        className="inline-flex items-center gap-1 rounded-full bg-white/8 border border-white/10 px-2 py-0.5 text-xs"
                      >
                        <span className="text-amber-200/80 tabular-nums">{i + 1}</span>
                        <span className="text-white/85">{label}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onUndo}
                disabled={drawingStars.length === 0}
                className="flex-1 bg-white/5 border-white/10 hover:bg-white/10 text-white hover:text-white"
              >
                <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                Undo
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onClear}
                disabled={drawingStars.length === 0}
                className="flex-1 bg-white/5 border-white/10 hover:bg-white/10 text-white hover:text-white"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Clear
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
                className="flex-1 bg-rose-500/10 border-rose-400/20 hover:bg-rose-500/20 text-rose-200 hover:text-rose-100"
              >
                <XIcon className="h-3.5 w-3.5 mr-1.5" />
                Cancel
              </Button>
            </div>
            <Button
              size="sm"
              onClick={onFinish}
              className="w-full bg-white/10 hover:bg-white/15 text-white"
            >
              Back to sky
            </Button>
          </div>

          <Separator className="bg-white/10" />

          <div className="space-y-3">
            <div>
              <Label className="text-xs text-white/70">Name</Label>
              <Input
                value={title}
                onChange={(e) => onTitle(e.target.value)}
                placeholder="The Winter Cat"
                maxLength={64}
                className="bg-white/5 border-white/10 text-white mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-white/70">Legend (optional)</Label>
              <Textarea
                value={description}
                onChange={(e) => onDescription(e.target.value)}
                placeholder="Tell the story of your constellation…"
                maxLength={500}
                rows={3}
                className="bg-white/5 border-white/10 text-white mt-1 resize-none"
              />
              <div className="text-[10px] text-white/40 mt-1 text-right tabular-nums">
                {description.length}/500
              </div>
            </div>
            <Button
              onClick={onPublish}
              disabled={!canPublish || publishing || !loggedIn}
              className="w-full bg-linear-to-r from-indigo-500 to-amber-300 text-slate-900 hover:opacity-90 font-semibold disabled:opacity-40"
            >
              {publishing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Publishing…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  {isEditing ? "Update & share" : "Publish to Nostr"}
                </>
              )}
            </Button>
            {!loggedIn && (
              <p className="text-xs text-amber-200/80 text-center">
                Log in with Nostr (top right) to publish.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ConstellationGrid({
  items,
  loading,
  emptyLabel,
  onCloseDrawer,
  onEdit,
  onDelete,
  deleting,
  currentUserPubkey,
  hideAuthor,
}: {
  items: CustomConstellation[];
  loading: boolean;
  emptyLabel: string;
  /** Called before navigating to a card's detail view so the drawer
      doesn't remain covering the freshly-opened sheet. */
  onCloseDrawer: () => void;
  onEdit?: (c: CustomConstellation) => void;
  onDelete?: (c: CustomConstellation) => void;
  deleting?: boolean;
  currentUserPubkey?: string;
  hideAuthor?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center p-6 text-white/60 text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="text-sm text-white/60 p-6 text-center rounded-xl border border-dashed border-white/10">
        {emptyLabel}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {items.map((c) => {
        const isMine = currentUserPubkey === c.pubkey;
        return (
          <ConstellationCard
            key={`${c.pubkey}:${c.d}`}
            c={c}
            isMine={isMine}
            hideAuthor={hideAuthor}
            onBeforeNavigate={onCloseDrawer}
            onEdit={isMine && onEdit ? () => onEdit(c) : undefined}
            onDelete={isMine && onDelete ? () => onDelete(c) : undefined}
            deleting={!!deleting}
          />
        );
      })}
    </div>
  );
}
