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
 * `LocationDisabledIndicator` is mounted on both modes as a sibling of
 * the mode page so it floats above everything and is always visible
 * when the app is running against a geolocation fallback.
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
  return (
    <>
      <BirdsIndex />
      <LocationDisabledIndicator />
    </>
  );
};

export default Index;
