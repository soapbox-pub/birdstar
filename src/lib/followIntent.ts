/**
 * Pending-follow intent.
 *
 * The "scan my QR to add me" flow needs to survive the login / signup
 * detour. A logged-out visitor taps **Follow**, we open the auth dialog,
 * and once they finish creating an account (or logging in) we want to
 * follow the target *for them* — without making them find the button
 * again.
 *
 * The signup path can involve a full navigation (e.g. launching a remote
 * signer app via `nostrconnect://` with a `/remoteloginsuccess` callback)
 * or simply a fresh mount, so the intent is persisted to `localStorage`
 * rather than held in React state. It is a single pending target keyed by
 * hex pubkey, with a timestamp so a stale intent (someone who abandoned
 * the flow days ago) is ignored.
 */

const STORAGE_KEY = 'birdstar:follow-intent';

/** How long a recorded intent stays valid. Beyond this we discard it so a
 * long-abandoned flow can't silently follow someone on a much later login. */
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

export interface FollowIntent {
  /** Hex pubkey of the account the visitor wanted to follow. */
  pubkey: string;
  /** When the intent was recorded (epoch ms). */
  createdAt: number;
}

function isHexPubkey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

/**
 * Record an intent to follow `pubkey` once a user is available. Overwrites
 * any previous pending intent — the most recent "Follow" tap wins.
 */
export function setFollowIntent(pubkey: string): void {
  if (!isHexPubkey(pubkey)) return;
  try {
    const intent: FollowIntent = { pubkey, createdAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // Storage unavailable (private mode / quota). The flow degrades to a
    // manual follow; not worth surfacing.
  }
}

/** Read the current pending intent, or `null` if none / expired / invalid. */
export function getFollowIntent(): FollowIntent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !isHexPubkey((parsed as FollowIntent).pubkey) ||
      typeof (parsed as FollowIntent).createdAt !== 'number'
    ) {
      clearFollowIntent();
      return null;
    }
    const intent = parsed as FollowIntent;
    if (Date.now() - intent.createdAt > MAX_AGE_MS) {
      clearFollowIntent();
      return null;
    }
    return intent;
  } catch {
    return null;
  }
}

/** Clear any pending intent. */
export function clearFollowIntent(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
