import { useSeoMeta } from "@unhead/react";
import { Link, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioOn, setAudioOn] = useState(false);

  useSeoMeta({
    title: "404 — Lost at sea | Birdstar",
    description:
      "The page you are looking for has drifted into the deep. Return to the home page to continue browsing.",
  });

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  // Pre-compute a stable set of bubbles + marine snow with a lazy state initializer
  // so they don't re-randomize on every render (and don't violate the purity rule).
  const [bubbles] = useState(() =>
    Array.from({ length: 22 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      size: 4 + Math.random() * 14,
      duration: 9 + Math.random() * 12,
      delay: -Math.random() * 20,
      drift: (Math.random() - 0.5) * 60,
      opacity: 0.18 + Math.random() * 0.35,
    })),
  );

  const [snow] = useState(() =>
    Array.from({ length: 35 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      top: Math.random() * 100,
      size: 1 + Math.random() * 2,
      duration: 18 + Math.random() * 22,
      delay: -Math.random() * 30,
      opacity: 0.1 + Math.random() * 0.3,
    })),
  );

  const toggleAudio = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (audioOn) {
      el.pause();
      setAudioOn(false);
    } else {
      try {
        el.volume = 0.6;
        await el.play();
        setAudioOn(true);
      } catch {
        // Autoplay or codec failure — keep silent.
        setAudioOn(false);
      }
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#021024] text-slate-100">
      {/* Deep ocean gradient base */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-[#0a3a6b] via-[#04203f] to-[#000814]"
      />

      {/* Subtle animated caustics / water shimmer */}
      <div aria-hidden="true" className="absolute inset-0 opacity-60 mix-blend-screen">
        <div className="absolute inset-0 motion-safe:animate-[caustics_14s_ease-in-out_infinite] bg-[radial-gradient(ellipse_at_30%_-10%,rgba(120,200,255,0.35),transparent_60%),radial-gradient(ellipse_at_70%_-20%,rgba(80,160,220,0.25),transparent_55%)]" />
      </div>

      {/* Sun rays piercing from the surface */}
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 left-[15%] h-[120%] w-40 -rotate-6 bg-gradient-to-b from-cyan-200/25 via-cyan-300/10 to-transparent blur-2xl motion-safe:animate-[ray_9s_ease-in-out_infinite]" />
        <div className="absolute -top-20 left-[45%] h-[120%] w-56 rotate-3 bg-gradient-to-b from-sky-200/20 via-sky-300/10 to-transparent blur-3xl motion-safe:animate-[ray_11s_ease-in-out_infinite] [animation-delay:-3s]" />
        <div className="absolute -top-20 left-[72%] h-[120%] w-32 -rotate-3 bg-gradient-to-b from-cyan-100/20 via-cyan-200/5 to-transparent blur-2xl motion-safe:animate-[ray_13s_ease-in-out_infinite] [animation-delay:-6s]" />
      </div>

      {/* Marine snow */}
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
        {snow.map((s) => (
          <span
            key={s.id}
            className="absolute rounded-full bg-white motion-safe:animate-[snow_linear_infinite]"
            style={{
              left: `${s.left}%`,
              top: `${s.top}%`,
              width: `${s.size}px`,
              height: `${s.size}px`,
              opacity: s.opacity,
              animationDuration: `${s.duration}s`,
              animationDelay: `${s.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Bubbles rising */}
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
        {bubbles.map((b) => (
          <span
            key={b.id}
            className="absolute bottom-[-40px] rounded-full border border-white/30 bg-white/10 backdrop-blur-[1px] motion-safe:animate-[bubble_linear_infinite]"
            style={{
              left: `${b.left}%`,
              width: `${b.size}px`,
              height: `${b.size}px`,
              opacity: b.opacity,
              animationDuration: `${b.duration}s`,
              animationDelay: `${b.delay}s`,
              ["--drift" as string]: `${b.drift}px`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Audio + speaker toggle (off by default) */}
      <audio
        ref={audioRef}
        src="/whale.m4a"
        loop
        preload="none"
        aria-label="Whale song ambient audio"
      />
      <button
        type="button"
        onClick={toggleAudio}
        aria-pressed={audioOn}
        aria-label={audioOn ? "Mute whale song" : "Play whale song"}
        className="group fixed top-[calc(1rem+env(safe-area-inset-top))] right-[calc(1rem+env(safe-area-inset-right))] z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-cyan-100 shadow-lg backdrop-blur-md transition hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 motion-safe:animate-[float-speaker_6s_ease-in-out_infinite]"
      >
        {audioOn ? (
          <Volume2 className="h-5 w-5" />
        ) : (
          <VolumeX className="h-5 w-5" />
        )}
        <span className="sr-only">
          {audioOn ? "Mute whale song" : "Play whale song"}
        </span>
      </button>

      {/* Content */}
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-16">
        <div className="max-w-3xl w-full text-center">
          <div className="relative mx-auto mb-8 w-[22rem] sm:w-[32rem] md:w-[40rem] lg:w-[48rem] max-w-[92vw]">
            {/* Soft glow halo beneath the whale */}
            <div
              aria-hidden="true"
              className="absolute inset-x-[10%] top-1/2 -translate-y-1/2 h-[140%] rounded-[50%] bg-cyan-400/20 blur-3xl motion-safe:animate-[glow_6s_ease-in-out_infinite]"
            />
            <img
              src="/whale.png"
              alt=""
              aria-hidden="true"
              width={1295}
              height={264}
              className="relative block h-auto w-full select-none drop-shadow-[0_10px_40px_rgba(8,40,80,0.6)] motion-safe:animate-[swim_7s_ease-in-out_infinite]"
            />
          </div>

          <p className="text-sm font-medium uppercase tracking-[0.3em] text-cyan-300/80 mb-3">
            404 · Lost at sea
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold text-white mb-3 drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
            This page drifted into the deep
          </h1>
          <p className="text-base text-cyan-100/80 mb-8">
            Nothing but blue down here. Surface back up and try another
            heading.
          </p>
          <Button
            asChild
            size="lg"
            className="bg-cyan-400 text-slate-900 hover:bg-cyan-300 shadow-[0_8px_30px_rgba(34,211,238,0.35)]"
          >
            <Link to="/">Surface to home</Link>
          </Button>
        </div>
      </div>

      <style>{`
        @keyframes swim {
          0%, 100% { transform: translate3d(0, 0, 0) rotate(-2deg); }
          25%      { transform: translate3d(6px, -10px, 0) rotate(0deg); }
          50%      { transform: translate3d(0, -18px, 0) rotate(2deg); }
          75%      { transform: translate3d(-6px, -8px, 0) rotate(0deg); }
        }
        @keyframes glow {
          0%, 100% { opacity: 0.45; transform: scale(0.95); }
          50%      { opacity: 0.7;  transform: scale(1.05); }
        }
        @keyframes bubble {
          0%   { transform: translate3d(0, 0, 0) scale(0.9); opacity: 0; }
          10%  { opacity: var(--bubble-opacity, 0.4); }
          100% { transform: translate3d(var(--drift, 0px), -110vh, 0) scale(1.1); opacity: 0; }
        }
        @keyframes snow {
          0%   { transform: translate3d(0, -10vh, 0); }
          100% { transform: translate3d(-20px, 110vh, 0); }
        }
        @keyframes ray {
          0%, 100% { opacity: 0.35; transform: translateX(0) scaleY(1); }
          50%      { opacity: 0.7;  transform: translateX(20px) scaleY(1.05); }
        }
        @keyframes caustics {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50%      { transform: translate3d(-2%, 1%, 0) scale(1.05); }
        }
        @keyframes float-speaker {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
};

export default NotFound;
