import { useSeoMeta } from "@unhead/react";
import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useSeoMeta({
    title: "404 — This page flew away | Birdstar",
    description:
      "The page you are looking for could not be found. Return to the home page to continue browsing.",
  });

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-md w-full text-center">
        <img
          src="/bird-icon.png"
          alt=""
          aria-hidden="true"
          width={220}
          height={220}
          className="mx-auto mb-6 h-44 w-44 sm:h-52 sm:w-52 select-none motion-safe:animate-[wiggle_4s_ease-in-out_infinite] drop-shadow-sm"
        />
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground mb-2">
          404
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold text-foreground mb-3">
          This page flew away
        </h1>
        <p className="text-base text-muted-foreground mb-8">
          We couldn't find what you were looking for. Head back and try
          another branch.
        </p>
        <Button asChild size="lg">
          <Link to="/">Return home</Link>
        </Button>
      </div>
      <style>{`
        @keyframes wiggle {
          0%, 100% { transform: rotate(-2deg); }
          50% { transform: rotate(2deg); }
        }
      `}</style>
    </div>
  );
};

export default NotFound;
