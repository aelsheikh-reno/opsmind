"use client";

import { useState } from "react";
import { CURRENCIES, CURRENCY_NAMES } from "@/lib/currencies";

type Props = {
  initialCurrencies: string[];
  rates: Record<string, number>;
};

export default function CurrenciesSection({ initialCurrencies, rates }: Props) {
  const [enabled, setEnabled] = useState<Set<string>>(new Set(initialCurrencies));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggle(code: string) {
    if (code === "USD") return; // base currency, always on
    setEnabled(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/settings/currencies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currencies: [...enabled] }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="space-y-1">
        {CURRENCIES.map(code => {
          const isUSD = code === "USD";
          const on = enabled.has(code);
          const rate = rates[code];
          return (
            <div
              key={code}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors cursor-pointer ${on ? "bg-indigo-50/60" : "hover:bg-surface-hover"}`}
              onClick={() => toggle(code)}
            >
              {/* Toggle pill */}
              <button
                type="button"
                disabled={isUSD}
                onClick={e => { e.stopPropagation(); toggle(code); }}
                className={`relative flex-shrink-0 inline-flex h-5 w-9 rounded-full transition-colors duration-200 ${on ? "bg-indigo-500" : "bg-gray-200"} ${isUSD ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-4" : "translate-x-0"}`} />
              </button>

              {/* Code badge */}
              <span className={`text-xs font-bold w-9 shrink-0 ${on ? "text-indigo-700" : "text-gray-400"}`}>{code}</span>

              {/* Name */}
              <span className="text-xs text-gray-600 flex-1">{CURRENCY_NAMES[code] ?? code}</span>

              {/* Rate or base label */}
              {isUSD ? (
                <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">Base</span>
              ) : on && rate ? (
                <span className="text-xs text-gray-500 font-mono">1 USD = {rate.toFixed(4)} {code}</span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="h-8 px-4 text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 disabled:opacity-50 rounded-lg transition-colors"
        >
          {saving ? "Saving…" : "Save currencies"}
        </button>
        {saved && <span className="text-xs text-green-600 font-medium">Saved</span>}
      </div>

      <p className="mt-3 text-[11px] text-gray-400 flex items-center gap-1.5">
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" className="shrink-0 text-gray-400">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
          <path d="M7 6v4M7 4.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        Exchange rates are refreshed automatically every day at 10 AM UAE time. To pull the latest rates immediately, use the <strong className="font-semibold text-gray-500">Fetch latest</strong> button in the Exchange Rates section below.
      </p>
    </div>
  );
}
