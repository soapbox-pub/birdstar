import { useFollowIntentExecutor } from '@/hooks/useFollowIntentExecutor';

/**
 * Headless mount point for {@link useFollowIntentExecutor}. Rendered once,
 * high in the tree, so a pending "follow this pubkey after login" intent
 * (set by {@link SmartFollowButton} during the scan-to-add flow) is
 * completed automatically as soon as an account becomes active — no matter
 * which mode or route the user lands back on.
 */
export function FollowIntentExecutor() {
  useFollowIntentExecutor();
  return null;
}
