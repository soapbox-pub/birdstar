import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { RelayListManager } from '@/components/RelayListManager';

/**
 * Wraps {@link RelayListManager} in a dialog so it can be opened from the
 * settings sheet in either mode. Follows the same `trigger`-prop pattern as
 * {@link CopyrightDialog}: callers pass a styled button as the trigger, which
 * keeps the open/close state uncontrolled (Radix manages it).
 *
 * The relay list state itself lives in `AppContext` (synced by `NostrSync`),
 * so the dialog is purely a UI surface — opening it from Birds or Stars edits
 * the same underlying NIP-65 list.
 */
export interface RelayManagerDialogProps {
  trigger: ReactNode;
}

export function RelayManagerDialog({ trigger }: RelayManagerDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Relays</DialogTitle>
          <DialogDescription>
            Choose which Nostr relays Birdstar reads from and publishes to.
            Logged-in users have their list synced as a NIP-65 event.
          </DialogDescription>
        </DialogHeader>
        <RelayListManager />
      </DialogContent>
    </Dialog>
  );
}
