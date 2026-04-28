import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { nip19 } from "nostr-tools";

import Index from "@/pages/Index";
import NotFound from "@/pages/NotFound";
import { CUSTOM_CONSTELLATION_KIND } from "@/lib/customConstellations";

/**
 * Root-level NIP-19 identifier dispatcher. Routes like `/npub1…`,
 * `/nprofile1…`, and `/naddr1…` all land here. Every supported
 * identifier resolves to an overlay opened over the sky (`Index`),
 * which reads the same URL via `useOpenedView` and mounts the matching
 * detail sheet (profile, constellation, etc.).
 *
 * We do a cheap pre-flight decode here just to 404 malformed or
 * unsupported identifiers up front, avoiding the flash of the sky
 * beneath an empty overlay.
 */
export function NIP19Page() {
  const { nip19Id } = useParams<{ nip19Id: string }>();

  const supported = useMemo(() => {
    if (!nip19Id) return false;
    let decoded: ReturnType<typeof nip19.decode>;
    try {
      decoded = nip19.decode(nip19Id);
    } catch {
      return false;
    }
    switch (decoded.type) {
      case "npub":
      case "nprofile":
        return true;
      case "naddr":
        // We only know how to render custom constellations; other
        // addressable kinds fall through to 404.
        return decoded.data.kind === CUSTOM_CONSTELLATION_KIND;
      default:
        return false;
    }
  }, [nip19Id]);

  if (!supported) return <NotFound />;
  return <Index />;
}

export default NIP19Page;
