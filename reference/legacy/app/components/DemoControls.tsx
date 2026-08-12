"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DemoControls() {
  const router = useRouter();
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState<"seed" | "reset" | null>(null);
  const [error, setError]     = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function reloadSampleData() {
    setLoading("seed");
    setError("");
    const res = await fetch("/api/seed-demo", { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? "Failed to reload sample data.");
      setLoading(null);
      return;
    }
    router.push("/dashboard");
    router.refresh();
    setLoading(null);
    setOpen(false);
  }

  async function clearAndRestart() {
    setLoading("reset");
    setError("");
    const res = await fetch("/api/demo/reset", { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? "Failed to reset.");
      setLoading(null);
      return;
    }
    router.push("/onboarding");
  }

  return (
    <div ref={ref} className="fixed bottom-6 left-6 z-50">
      {open && (
        <div className="mb-2.5 bg-white border border-surface-border rounded-xl shadow-xl overflow-hidden w-56">
          {error && (
            <p className="text-[11px] text-red-500 px-4 py-2 bg-red-50 border-b border-red-100">{error}</p>
          )}
          <button
            onClick={reloadSampleData}
            disabled={!!loading}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-surface-hover disabled:opacity-40 transition-colors border-b border-surface-border"
          >
            {loading === "seed" ? (
              <svg width="14" height="14" viewBox="0 0 14 14" className="animate-spin shrink-0" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="8 8"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
                <path d="M2 7a5 5 0 0 1 8.5-3.5L12 5M12 2v3H9" stroke="#6366f1" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 7a5 5 0 0 1-8.5 3.5L2 9M2 12V9h3" stroke="#6366f1" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            <span className="font-medium">{loading === "seed" ? "Loading…" : "Reload sample data"}</span>
          </button>
          <button
            onClick={clearAndRestart}
            disabled={!!loading}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-surface-hover disabled:opacity-40 transition-colors"
          >
            {loading === "reset" ? (
              <svg width="14" height="14" viewBox="0 0 14 14" className="animate-spin shrink-0" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="8 8"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
                <path d="M2 3.5h10M5.5 3.5V2.5h3v1M5 3.5l.5 8M9 3.5l-.5 8" stroke="#ef4444" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            <span className="font-medium text-red-600">{loading === "reset" ? "Clearing…" : "Clear all & restart"}</span>
          </button>
        </div>
      )}

      <button
        onClick={() => { setOpen(o => !o); setError(""); }}
        className="flex items-center gap-2 px-3.5 py-2 bg-amber-400 hover:bg-amber-500 text-amber-900 text-xs font-bold rounded-full shadow-md transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-700 animate-pulse" />
        Demo
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}
