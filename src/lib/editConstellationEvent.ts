import type { CustomConstellation } from "@/lib/customConstellations";

/**
 * Cross-component event that asks the app to enter "edit this
 * constellation" mode: open the constellation drawer, rehydrate the
 * drawing state with the figure's stars, and fill the title/description
 * form.
 *
 * `Index` listens for this on `window` to open the drawer and populate
 * drawing state. `ConstellationDrawer` listens to populate its form
 * fields and mark the flow as an edit (so it updates rather than
 * creates a new `d`).
 *
 * This event exists because Edit can be triggered from several places
 * (the drawer itself, the profile sheet, potentially others) and we
 * need the handlers to stay co-located with the UI that owns each piece
 * of state. Passing the whole parsed constellation avoids duplicating
 * the chain-rehydration logic at every call site.
 */
export const EDIT_CONSTELLATION_EVENT = "starpoint:edit-constellation";

export interface EditConstellationDetail {
  d: string;
  title: string;
  description: string;
  /** Exact edge pairs from the event — the listener rebuilds an ordered
      star chain from them. */
  edges: Array<[number, number]>;
}

export function dispatchEditConstellation(c: CustomConstellation) {
  const detail: EditConstellationDetail = {
    d: c.d,
    title: c.title,
    description: c.description,
    edges: c.edges,
  };
  window.dispatchEvent(
    new CustomEvent<EditConstellationDetail>(EDIT_CONSTELLATION_EVENT, {
      detail,
    }),
  );
}

/** Walk `edges` as a chain of connected stars, producing the ordered
 *  HIP list the drawing tool uses. Disconnected jumps are preserved
 *  verbatim so we never silently drop data from a malformed input. */
export function edgesToChain(edges: Array<[number, number]>): number[] {
  const chain: number[] = [];
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i];
    if (i === 0) {
      chain.push(a, b);
    } else if (chain[chain.length - 1] === a) {
      chain.push(b);
    } else if (chain[chain.length - 1] === b) {
      chain.push(a);
    } else {
      chain.push(a, b);
    }
  }
  return chain;
}
