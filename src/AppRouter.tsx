import { BrowserRouter, Route, Routes } from "react-router-dom";

import { ScrollToTop } from "@/components/ScrollToTop";
import { ModeProvider } from "@/components/ModeProvider";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Privacy from "./pages/Privacy";
import NIP19Page from "./pages/NIP19Page";

/**
 * Birdstar's routing.
 *
 * The root path `/` renders `Index`, which reads `useMode()` and picks
 * birds vs stars from the user's selection. Birds is the default.
 *
 * Starpoint's overlay routes (`/star/:hip`, `/zodiac/:id`, `/planet/:id`,
 * `/sun`, `/moon`, plus `/:nip19Id` for constellations and profiles)
 * also render `Index`. In stars mode they open the matching detail
 * sheet via `useOpenedView`. In birds mode they still render the
 * checklist — the overlay just doesn't appear. That is fine: these
 * URLs are only generated while the sky map is actually being used,
 * and the birdex page stays navigable.
 *
 * The catch-all `*` route is a proper 404.
 */
export function AppRouter() {
  return (
    <BrowserRouter>
      <ModeProvider>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Index />} />
          {/* Starpoint overlay routes: each renders `Index`; the detail
              sheet opens over the sky based on `useOpenedView()`. */}
          <Route path="/star/:hip" element={<Index />} />
          <Route path="/zodiac/:zodiacId" element={<Index />} />
          <Route path="/planet/:planetId" element={<Index />} />
          <Route path="/sun" element={<Index />} />
          <Route path="/moon" element={<Index />} />
          {/* Privacy policy. Must be declared above `/:nip19Id`,
              which would otherwise swallow the single-segment path. */}
          <Route path="/privacy" element={<Privacy />} />
          {/* Root-level NIP-19 dispatch: npub/nprofile → profile sheet,
              naddr (kind 30621) → constellation overlay, other → 404. */}
          <Route path="/:nip19Id" element={<NIP19Page />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ModeProvider>
    </BrowserRouter>
  );
}

export default AppRouter;
