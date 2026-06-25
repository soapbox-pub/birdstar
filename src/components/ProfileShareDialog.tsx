import { useCallback, useMemo, useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Check, Copy, QrCode, Share2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { QRCodeCanvas } from '@/components/ui/qrcode';
import { useAuthor } from '@/hooks/useAuthor';
import { useToast } from '@/hooks/useToast';
import { hapticTap } from '@/lib/haptics';
import { cn } from '@/lib/utils';

interface ProfileShareDialogProps {
  /** Hex pubkey of the profile to share (typically the logged-in user). */
  pubkey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Add me on Birdstar" share sheet. Shows a scannable QR code (and a
 * copyable link) pointing at the profile's `npub` deep link
 * (`https://…/npub1…`). When someone scans it the app opens this profile
 * with a {@link SmartFollowButton}, which carries them through
 * account-creation / login and an automatic follow.
 *
 * Surfaced from the **own-profile** view via a small Share button, so a
 * user can hold up their phone and let a new friend point a camera at it.
 */
export function ProfileShareDialog({
  pubkey,
  open,
  onOpenChange,
}: ProfileShareDialogProps) {
  const author = useAuthor(pubkey);
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const displayName =
    author.data?.metadata?.name ??
    author.data?.metadata?.display_name ??
    'me';

  const npub = useMemo(() => nip19.npubEncode(pubkey), [pubkey]);

  // Absolute URL so the QR works when scanned by any camera, off-device.
  const shareUrl = useMemo(() => {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/${npub}`;
  }, [npub]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      hapticTap();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: 'Link copied', description: 'Share it anywhere.' });
    } catch {
      toast({
        title: "Couldn't copy",
        description: 'Long-press the link to copy it manually.',
        variant: 'destructive',
      });
    }
  }, [shareUrl, toast]);

  const handleNativeShare = useCallback(async () => {
    const nav = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
    };
    if (typeof nav.share !== 'function') {
      void handleCopy();
      return;
    }
    try {
      hapticTap();
      await nav.share({
        title: 'Add me on Birdstar',
        text: `Follow ${displayName} on Birdstar`,
        url: shareUrl,
      });
    } catch {
      // User dismissed the share sheet, or it failed — no-op.
    }
  }, [displayName, shareUrl, handleCopy]);

  const canNativeShare =
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { share?: unknown }).share === 'function';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-center gap-2 text-center">
            <QrCode className="h-5 w-5" aria-hidden />
            Add me on Birdstar
          </DialogTitle>
          <DialogDescription className="text-center">
            Have a friend scan this with their camera. It walks them through
            joining and following you — even if they're brand new.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-5 pt-1">
          {/* QR code on a solid white card so it scans reliably over any
              backdrop (the Stars sheet is dark). */}
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <QRCodeCanvas
              value={shareUrl}
              size={224}
              level="M"
              className="h-56 w-56"
            />
          </div>

          {/* Copyable link. */}
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              'group flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors',
              'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
            title="Copy link"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              {shareUrl}
            </span>
            {copied ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-500" />
            ) : (
              <Copy className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
            )}
          </button>

          <div className="flex w-full gap-2">
            {canNativeShare && (
              <Button
                type="button"
                onClick={handleNativeShare}
                className="h-11 flex-1 rounded-full"
              >
                <Share2 className="mr-2 h-4 w-4" />
                Share
              </Button>
            )}
            <Button
              type="button"
              variant={canNativeShare ? 'outline' : 'default'}
              onClick={handleCopy}
              className="h-11 flex-1 rounded-full"
            >
              {copied ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
