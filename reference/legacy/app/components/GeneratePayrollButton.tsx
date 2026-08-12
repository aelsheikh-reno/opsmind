"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GeneratePayrollButton({
  month,
  year,
  count,
  mode,
  hidden,
}: {
  month: number;
  year: number;
  count: number;
  mode: "generate" | "sync";
  hidden?: boolean;
}) {
  if (hidden) return null;
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handle() {
    setLoading(true);
    await fetch("/api/payroll/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, year }),
    });
    setLoading(false);
    router.refresh();
  }

  if (mode === "sync") {
    return (
      <button
        onClick={handle}
        disabled={loading}
        className="flex items-center gap-1 text-xs font-medium text-indigo-500 hover:text-indigo-700 disabled:opacity-40 transition-colors"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M2 6a4 4 0 1 1 .8 2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M2 9V6.5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {loading ? "Syncing…" : `Sync ${count} missing from contracts`}
      </button>
    );
  }

  return (
    <button
      onClick={handle}
      disabled={loading}
      className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors"
    >
      {loading ? (
        <>
          <svg width="11" height="11" viewBox="0 0 12 12" className="animate-spin" fill="none">
            <circle cx="6" cy="6" r="4" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeDasharray="6 6" />
          </svg>
          Generating…
        </>
      ) : (
        <>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Generate from contracts ({count})
        </>
      )}
    </button>
  );
}
