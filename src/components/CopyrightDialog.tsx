import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/**
 * Collapses the long attribution paragraph that used to live in the Birdex
 * footer into a single dialog. The footer trigger is a text-only button
 * ("License & Credits") so the page can end quietly; anyone who needs the
 * BirdNET / Wikipedia / AGPL / weights notice can open it explicitly.
 *
 * Links inside the dialog keep the same destinations as before — we haven't
 * dropped any attribution that a license requires us to show, just moved it
 * from always-visible to one-click-away.
 */
export interface CopyrightDialogProps {
  trigger: ReactNode;
}

export function CopyrightDialog({ trigger }: CopyrightDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>License & Credits</DialogTitle>
          <DialogDescription>
            Birdstar stands on the shoulders of open science, open data, and
            open source.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm text-stone-700 dark:text-stone-300">
          <p>
            Powered by{' '}
            <a
              href="https://birdnet.cornell.edu"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
            >
              BirdNET
            </a>{' '}
            · bird info from{' '}
            <a
              href="https://en.wikipedia.org"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
            >
              Wikipedia
            </a>{' '}
            · vibed with{' '}
            <a
              href="https://shakespeare.diy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
            >
              Shakespeare
            </a>
            .
          </p>

          <p>
            <a
              href="https://gitlab.com/soapbox-pub/birdstar"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
            >
              Source code
            </a>{' '}
            is licensed under AGPL-3.0. See the{' '}
            <Link
              to="/privacy"
              className="underline decoration-dotted underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
            >
              privacy policy
            </Link>{' '}
            for how location, audio, and detection data are handled.
          </p>

          <p className="text-xs text-stone-500 dark:text-stone-400">
            BirdNET weights are released under CC-BY-NC-SA 4.0 and may only be
            used for non-commercial purposes. Range data is derived from
            Wikipedia.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
