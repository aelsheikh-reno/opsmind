"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function FetchRateButton({ cachedAt }: { cachedAt: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(cachedAt);

  async function handleFetch() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fx/refresh", { method: "POST" });
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      setLastFetched(data.cachedAt);
      localStorage.setItem("fx_rates_seen_at", data.cachedAt);
      toast.success("Exchange rates updated", {
        description: "Latest rates are now live across the app.",
        duration: 10000,
      });
      router.refresh();
    } catch {
      setError("Could not fetch rates. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  const formattedAt = lastFetched
    ? new Date(lastFetched).toLocaleString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="text-right">
        <p className="text-[10px] text-gray-400">
          Auto-refresh daily at <span className="font-medium text-gray-500">10:00 AM</span>
        </p>
        {formattedAt && (
          <p className="text-[10px] text-gray-300 mt-0.5">Last fetched {formattedAt}</p>
        )}
        {error && <p className="text-[10px] text-red-400 mt-0.5">{error}</p>}
      </div>
      <button
        onClick={handleFetch}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <svg
          width="11" height="11" viewBox="0 0 16 16" fill="none"
          className={loading ? "animate-spin" : ""}
        >
          <path d="M14 8A6 6 0 1 1 8 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          <path d="M8 2l2.5 2.5L8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
        {loading ? "Fetching…" : "Fetch now"}
      </button>
    </div>
  );
}
