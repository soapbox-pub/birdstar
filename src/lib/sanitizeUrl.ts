/**
 * Return `url` only if it is a well-formed `https:` URL, else `undefined`.
 * Use on every event-sourced URL before it reaches `src`, `href`, or CSS.
 */
export function sanitizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
