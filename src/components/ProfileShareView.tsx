import { useCallback, useMemo, useState } from 'react';
import { nip19 } from 'nostr-tools';
import { ArrowLeft, Check, Copy, QrCode, Share2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { QRCodeCanvas } from '@/components/ui/qrcode';
import { useAuthor } from '@/hooks/useAuthor';
import { useToast } from '@/hooks/useToast';
import { hapticTap } from '@/lib/haptics';
import { shareOrigin } from '@/lib/shareOrigin';
import { cn } from '@/lib/utils';

interface ProfileShareViewProps {
  /** Hex pubkey of the profile to share (typically the logged-in user). */
  pubkey: string;
  /** Return to the profile view this was swapped in over. */
  onBack: () => void;
  /**
   * Visual treatment. `'dark'` matches the pinned-dark Stars sheet;
   * `'default'` matches the light/dark-aware Birds dialog.
   */
  variant?: 'default' | 'dark';
  className?: string;
}

/**
 * "Add me on Birdstar" share view — a QR code (and copyable link) pointing
 * at the profile's `npub` deep link (`https://…/npub1…`). Rendered *in
 * place* of the profile body inside the existing profile dialog / sheet
 * (not as a nested modal), so there's a single overlay and no z-index /
 * backdrop bleed.
 *
 * When someone scans the code the app opens this profile with a
 * {@link SmartFollowButton}, which carries them through account-creation /
 * login and an automatic follow.
 */
export function ProfileShareView({
  pubkey,
  onBack,
  variant = 'default',
  className,
}: ProfileShareViewProps) {
  const author = useAuthor(pubkey);
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const displayName =
    author.data?.metadata?.name ??
    author.data?.metadata?.display_name ??
    'me';

  const npub = useMemo(() => nip19.npubEncode(pubkey), [pubkey]);

  // Absolute URL so the QR works when scanned by any camera, off-device.
  const shareUrl = useMemo(() => `${shareOrigin()}/${npub}`, [npub]);

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

  const dark = variant === 'dark';

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-5 px-6 py-7 text-center',
        className,
      )}
    >
      <button
        type="button"
        onClick={onBack}
        className={cn(
          'inline-flex items-center gap-1.5 self-start text-sm font-medium transition-colors',
          dark
            ? 'text-white/60 hover:text-white'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="space-y-1.5">
        <h2
          className={cn(
            'flex items-center justify-center gap-2 text-lg font-semibold tracking-tight',
            dark ? 'text-white' : 'text-foreground',
          )}
        >
          <QrCode className="h-5 w-5" aria-hidden />
          Add me on Birdstar
        </h2>
        <p
          className={cn(
            'mx-auto max-w-xs text-sm',
            dark ? 'text-white/70' : 'text-muted-foreground',
          )}
        >
          Have a friend scan this with their camera. It walks them through
          joining and following you — even if they're brand new.
        </p>
      </div>

      {/* QR on a solid white card so it scans reliably over any backdrop. */}
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
          'group flex w-full max-w-sm items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          dark
            ? 'border-white/10 hover:bg-white/5'
            : 'hover:bg-muted/60',
        )}
        title="Copy link"
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-mono text-xs',
            dark ? 'text-white/60' : 'text-muted-foreground',
          )}
        >
          {shareUrl}
        </span>
        {copied ? (
          <Check className="h-4 w-4 shrink-0 text-emerald-500" />
        ) : (
          <Copy
            className={cn(
              'h-4 w-4 shrink-0',
              dark
                ? 'text-white/50 group-hover:text-white'
                : 'text-muted-foreground group-hover:text-foreground',
            )}
          />
        )}
      </button>

      <div className="flex w-full max-w-sm gap-2">
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
          className={cn(
            'h-11 flex-1 rounded-full',
            dark && canNativeShare
              ? 'border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white'
              : '',
          )}
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
  );
}
