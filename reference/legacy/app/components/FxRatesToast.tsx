"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export default function FxRatesToast() {
  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/fx/refresh");
        if (!res.ok) return;
        const { cachedAt } = await res.json();
        if (!cachedAt) return;

        const seen = localStorage.getItem("fx_rates_seen_at");
        if (seen && new Date(seen) >= new Date(cachedAt)) return;

        localStorage.setItem("fx_rates_seen_at", cachedAt);

        const formatted = new Date(cachedAt).toLocaleString("en-GB", {
          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        });

        toast.success("Exchange rates updated", {
          description: `Rates refreshed at ${formatted}. All currency conversions are now up to date.`,
          duration: 10000,
        });
      } catch { /* silent */ }
    }
    check();
  }, []);

  return null;
}
