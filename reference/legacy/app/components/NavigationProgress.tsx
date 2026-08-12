"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

export default function NavigationProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"idle" | "loading" | "completing">("idle");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(false);

  // Intercept anchor clicks to start the bar before navigation fires
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      // Skip external, hash-only, and same-page links
      if (href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) return;
      if (anchor.getAttribute("target") === "_blank") return;
      // Normalise to path only for comparison
      const destPath = href.split("?")[0].split("#")[0];
      if (destPath === window.location.pathname) return;

      if (timerRef.current) clearInterval(timerRef.current);
      setProgress(12);
      setPhase("loading");

      let p = 12;
      timerRef.current = setInterval(() => {
        // Accelerates quickly at first, slows to a crawl near 82%
        const step = Math.max(1, (82 - p) * 0.08 + Math.random() * 4);
        p = Math.min(82, p + step);
        setProgress(p);
      }, 220);
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  // Complete the bar when the pathname actually changes
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setProgress(100);
    setPhase("completing");
    const t = setTimeout(() => {
      setPhase("idle");
      setProgress(0);
    }, 450);
    return () => clearTimeout(t);
  }, [pathname]);

  if (phase === "idle") return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] pointer-events-none" style={{ height: 3 }}>
      <div
        style={{
          height: "100%",
          width: `${progress}%`,
          background: "linear-gradient(90deg, #6366f1, #818cf8)",
          boxShadow: "0 0 10px 1px rgba(99,102,241,0.55)",
          transition: phase === "loading" ? "width 220ms ease-out" : "width 180ms ease-in",
        }}
      />
    </div>
  );
}
