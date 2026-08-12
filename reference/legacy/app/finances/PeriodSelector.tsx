"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useTransition, useState } from "react";

const ROLLING = [
  { key: "3m",  label: "3 mo" },
  { key: "6m",  label: "6 mo" },
  { key: "12m", label: "12 mo" },
  { key: "24m", label: "24 mo" },
];

const STORAGE_KEY = "opsmind_finance_period";

export default function PeriodSelector({ current }: { current: string }) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [pendingKey, setPendingKey]  = useState<string | null>(null);

  const now = new Date();
  const fyYears = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  // Clear pending key once navigation resolves
  useEffect(() => {
    if (!isPending) setPendingKey(null);
  }, [isPending]);

  // Restore saved period on first load if URL has no period param
  useEffect(() => {
    if (!searchParams.get("period")) {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const params = new URLSearchParams(searchParams.toString());
        params.set("period", saved);
        router.replace(`${pathname}?${params.toString()}`);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function select(key: string) {
    if (key === current && !isPending) return;
    localStorage.setItem(STORAGE_KEY, key);
    setPendingKey(key);
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", key);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function btn(key: string, label: string) {
    const active  = current === key && pendingKey === null;
    const loading = pendingKey === key;

    return (
      <button
        key={key}
        onClick={() => select(key)}
        disabled={isPending}
        className={`relative px-3 py-1 text-xs font-medium rounded-md transition-colors ${
          active || loading
            ? "bg-white text-gray-900 shadow-sm border border-gray-200"
            : "text-gray-500 hover:text-gray-800"
        } ${isPending && !loading ? "opacity-50" : ""}`}
      >
        {loading ? (
          <span className="flex items-center gap-1.5">
            <svg className="animate-spin h-3 w-3 text-indigo-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            {label}
          </span>
        ) : label}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center bg-surface-inset rounded-lg p-0.5 border border-surface-border gap-0.5">
        <span className="pl-2 pr-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Rolling</span>
        {ROLLING.map(p => btn(p.key, p.label))}
      </div>
      <div className="flex items-center bg-surface-inset rounded-lg p-0.5 border border-surface-border gap-0.5">
        <span className="pl-2 pr-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">FY</span>
        {fyYears.map(y => btn(`fy${y}`, String(y)))}
      </div>
    </div>
  );
}
