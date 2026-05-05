import { useMode } from "@/hooks/useMode";
import { ForceDarkTheme } from "@/components/ForceDarkTheme";
import { LocationDisabledIndicator } from "@/components/LocationDisabledIndicator";
import BirdsIndex from "./BirdsIndex";
import StarsIndex from "./StarsIndex";

/**
 * Top-level dispatcher. Reads the current {@link useMode.mode} and
 * renders the matching experience. Both sub-pages own their own SEO
 * meta, top-HUD, and background.
 *
 * `ForceDarkTheme` is mounted only for Stars mode — the sky canvas only
 * reads on a black background, and the HUD styles assume white-on-dark.
 * Birds mode keeps AppConfig's theme (light/dark/system) intact.
 *
 * `LocationDisabledIndicator` (floating variant) is mounted alongside
 * Stars because the sky map has no natural "above the content" slot.
 * Birds mode mounts its own inline variant directly above the
 * BirdexGrid, so we don't render it here.
 */
const Index = () => {
  const { mode } = useMode();

  if (mode === "stars") {
    return (
      <>
        <ForceDarkTheme />
        <StarsIndex />
        <LocationDisabledIndicator />
      </>
    );
  }
  return <BirdsIndex />;
};

export default Index;
