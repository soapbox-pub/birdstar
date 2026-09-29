import { useState } from 'react';
import { Bird, Sparkles } from 'lucide-react';

import AuthDialog from '@/components/auth/AuthDialog';
import { Button } from '@/components/ui/button';
import { hapticTap } from '@/lib/haptics';
import { setFollowIntent } from '@/lib/followIntent';
import { cn } from '@/lib/utils';

interface ProfileInviteCardProps {
  /** Hex pubkey of the profile being viewed — the person who invited them. */
  pubkey: string;
  displayName: string;
  /** `'dark'` for the pinned-dark Stars sheet, `'default'` for Birds. */
  variant?: 'default' | 'dark';
  className?: string;
}

/**
 * The landing half of an invite link. An invite is just the inviter's
 * profile URL (`/npub1…`); a logged-out visitor sees this card on that
 * profile instead of a bare Follow button.
 *
 * Either button records a {@link setFollowIntent} for the inviter and
 * opens the auth dialog (which covers both signup and login). Once an
 * account is active, the root-mounted `FollowIntentExecutor` follows the
 * inviter automatically.
 */
export function ProfileInviteCard({
  pubkey,
  displayName,
  variant = 'default',
  className,
}: ProfileInviteCardProps) {
  const [authOpen, setAuthOpen] = useState(false);
  const [authStep, setAuthStep] = useState<'welcome' | 'login'>('welcome');
  const dark = variant === 'dark';

  const start = (step: 'welcome' | 'login') => {
    hapticTap();
    setFollowIntent(pubkey);
    setAuthStep(step);
    setAuthOpen(true);
  };

  return (
    <div
      className={cn(
        'rounded-2xl border p-5',
        dark
          ? 'border-white/10 bg-white/5'
          : 'border-emerald-200/70 bg-emerald-50/60 dark:border-indigo-800/50 dark:bg-indigo-950/40',
        className,
      )}
    >
      <p
        className={cn(
          'flex items-center gap-2 font-semibold',
          dark ? 'text-white' : 'text-stone-900 dark:text-stone-50',
        )}
      >
        <span className="inline-flex items-center gap-0.5" aria-hidden>
          <Bird className="size-4 text-emerald-600 dark:text-emerald-300" />
          <Sparkles className="size-4 text-amber-500 dark:text-amber-200" />
        </span>
        <span className="min-w-0 truncate">Join {displayName} on Birdstar</span>
      </p>
      <p
        className={cn(
          'mt-1.5 text-sm',
          dark ? 'text-white/70' : 'text-stone-600 dark:text-stone-300',
        )}
      >
        Go outside. Find the birds. Draw the stars. Create an account or log
        in, and you'll follow {displayName} automatically.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button type="button" onClick={() => start('welcome')} className="h-11 flex-1 rounded-full font-semibold">
          Join and follow
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => start('login')}
          className={cn(
            'h-11 flex-1 rounded-full',
            dark && 'border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white',
          )}
        >
          I have an account
        </Button>
      </div>

      <AuthDialog
        isOpen={authOpen}
        initialStep={authStep}
        onClose={() => setAuthOpen(false)}
      />
    </div>
  );
}
