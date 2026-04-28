import { Compass, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getMobilePlatform } from "@/lib/detectDevice";

/**
 * Modal shown when a user on a phone has denied motion access and wants
 * help turning it back on. Instructions are tailored to the detected
 * mobile platform (iOS / Android / generic fallback). All variants end
 * with a prominent "Reload" button since most of these changes require a
 * page reload to take effect.
 */
export function EnableSensorsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const platform = getMobilePlatform();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-950 border-white/10 text-white sm:rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-linear-to-br from-indigo-500 to-amber-300 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Compass className="h-5 w-5 text-slate-900" />
            </div>
            <div className="text-left">
              <DialogTitle className="text-white text-lg">
                Turn on motion access
              </DialogTitle>
              <DialogDescription className="text-white/60">
                So Birdstar can match the sky to where you're pointing.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="mt-2">
          {platform === "ios" ? (
            <Instructions
              steps={[
                <>Tap the <Setting>aA</Setting> icon on the left of Safari's address bar.</>,
                <>Choose <Setting>Website Settings</Setting>.</>,
                <>Set <Setting>Motion &amp; Orientation Access</Setting> to <Setting>Allow</Setting>.</>,
                <>Reload the page.</>,
              ]}
              footnote={
                <>
                  Using Chrome or Firefox on iOS? Open <Setting>iOS
                  Settings → Safari</Setting> and enable{" "}
                  <Setting>Motion &amp; Orientation Access</Setting> there,
                  then reload.
                </>
              }
            />
          ) : platform === "android" ? (
            <Instructions
              steps={[
                <>Tap the lock icon on the left of the address bar.</>,
                <>Open <Setting>Permissions</Setting> (or <Setting>Site settings</Setting>).</>,
                <>Set <Setting>Motion sensors</Setting> to <Setting>Allow</Setting>.</>,
                <>Reload the page.</>,
              ]}
            />
          ) : (
            <Instructions
              steps={[
                <>Find the lock or info icon near your browser's address bar.</>,
                <>Allow motion or orientation access for this site.</>,
                <>Reload the page.</>,
              ]}
            />
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="bg-white/5 border-white/10 hover:bg-white/10 text-white hover:text-white"
          >
            Close
          </Button>
          <Button
            onClick={() => window.location.reload()}
            className="bg-linear-to-r from-indigo-500 to-amber-300 text-slate-900 hover:opacity-90 font-semibold"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Reload page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Instructions({
  steps,
  footnote,
}: {
  steps: React.ReactNode[];
  footnote?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <ol className="space-y-2.5">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-3 text-sm text-white/85">
            <span className="shrink-0 mt-0.5 h-5 w-5 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-[11px] font-semibold text-white/80 tabular-nums">
              {i + 1}
            </span>
            <span className="leading-snug">{step}</span>
          </li>
        ))}
      </ol>
      {footnote && (
        <p className="text-xs text-white/55 leading-relaxed pl-8">{footnote}</p>
      )}
    </div>
  );
}

/** Inline styling for UI labels the user is looking for on their device. */
function Setting({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-medium text-white bg-white/10 border border-white/10 rounded px-1.5 py-0.5 text-[0.85em]">
      {children}
    </span>
  );
}
