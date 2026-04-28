import { useMode } from "@/hooks/useMode";
import { ForceDarkTheme } from "@/components/ForceDarkTheme";
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
 */
const Index = () => {
  const { mode } = useMode();

  if (mode === "stars") {
    return (
      <>
        <ForceDarkTheme />
        <StarsIndex />
      </>
    );
  }
  return <BirdsIndex />;
};

export default Index;
