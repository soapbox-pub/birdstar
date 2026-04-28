import { useMemo, useState } from "react";
import { Compass, MapPin, X as XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/useLocalStorage";

/**
 * Non-blocking, dismissible status banners shown over the sky canvas when
 * something isn't quite right — no sensors, denied permission, or no
 * geolocation. The sky remains fully interactive (drag to pan) while these
 * are visible.
 *
 * Each message can opt into persistent dismissal via `dismissPersist`.
 * Persistent dismissals go into localStorage so the user never sees that
 * banner again; non-persistent dismissals live in component state only, so
 * the banner re-appears on the next page load if the underlying condition
 * is still present. This is the right behavior for transient or
 * recoverable conditions (e.g. a denied permission the user might fix
 * later) vs. tips the user has explicitly acknowledged.
 */

export interface SkyStatusBannerMessage {
  /** Stable id used as the localStorage-dismissed key. */
  id: string;
  /** Leading icon. */
  icon: "compass" | "map-pin";
  /** Short title. */
  title: string;
  /** Longer explanatory text. */
  description: string;
  /** Optional action — renders as a pill button on the right. */
  action?: { label: string; onClick: () => void };
  /** Visual tone. */
  tone?: "info" | "warning";
  /**
   * Whether to persist the dismissal to localStorage. Default `true`.
   * Set `false` for messages describing a condition the user might
   * reasonably want to be reminded of next session (e.g. denied
   * permission, missing location).
   */
  dismissPersist?: boolean;
}

export function SkyStatusBanner({ messages }: { messages: SkyStatusBannerMessage[] }) {
  const [persistentDismissed, setPersistentDismissed] = useLocalStorage<
    Record<string, true>
  >("starpoint:dismissedBanners", {});
  const [sessionDismissed, setSessionDismissed] = useState<Record<string, true>>({});

  const visible = useMemo(
    () =>
      messages.filter(
        (m) => !persistentDismissed[m.id] && !sessionDismissed[m.id],
      ),
    [messages, persistentDismissed, sessionDismissed],
  );

  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 w-[min(92vw,520px)] px-2 flex flex-col gap-2 z-10">
      {visible.map((m) => (
        <BannerCard
          key={m.id}
          msg={m}
          onDismiss={() => {
            if (m.dismissPersist === false) {
              setSessionDismissed((d) => ({ ...d, [m.id]: true }));
            } else {
              setPersistentDismissed((d) => ({ ...d, [m.id]: true }));
            }
          }}
        />
      ))}
    </div>
  );
}

function BannerCard({
  msg,
  onDismiss,
}: {
  msg: SkyStatusBannerMessage;
  onDismiss: () => void;
}) {
  const Icon = msg.icon === "compass" ? Compass : MapPin;
  const warning = msg.tone === "warning";
  return (
    <div
      className={cn(
        "pointer-events-auto rounded-2xl border backdrop-blur-md px-4 py-2.5 shadow-lg",
        "flex items-start gap-3",
        warning
          ? "bg-rose-500/10 border-rose-300/30"
          : "bg-black/50 border-white/10",
      )}
    >
      <div
        className={cn(
          "h-8 w-8 rounded-xl flex items-center justify-center shrink-0",
          warning ? "bg-rose-400/20 text-rose-100" : "bg-white/10 text-sky-200",
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-white">{msg.title}</div>
        <div className="text-[11px] text-white/70 leading-snug mt-0.5">
          {msg.description}
        </div>
      </div>
      {msg.action && (
        <button
          type="button"
          onClick={msg.action.onClick}
          className="shrink-0 h-7 px-3 rounded-full bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium"
        >
          {msg.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 h-7 w-7 rounded-full hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center"
        aria-label="Dismiss"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
