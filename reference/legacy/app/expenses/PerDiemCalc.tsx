"use client";

import { useState } from "react";

function daysBetween(from: string, to: string): number | null {
  if (!from || !to) return null;
  const a = new Date(from);
  const b = new Date(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

const INPUT_CLS =
  "w-full h-9 px-3 text-sm text-gray-900 bg-white border border-indigo-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400";

export default function PerDiemCalc({
  currency,
  onResult,
}: {
  currency: string;
  onResult: (amount: number | null) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [daily, setDaily] = useState("");

  function compute(f: string, t: string, d: string) {
    const days = daysBetween(f, t);
    const rate = parseFloat(d) || null;
    onResult(days != null && rate != null ? days * rate : null);
  }

  const days = daysBetween(from, to);
  const rate = parseFloat(daily) || null;
  const total = days != null && rate != null ? days * rate : null;

  return (
    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3.5 space-y-3">
      <p className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wider">Per Diem Calculator</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">From</label>
          <input
            type="date"
            value={from}
            onChange={e => { setFrom(e.target.value); compute(e.target.value, to, daily); }}
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">To</label>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={e => { setTo(e.target.value); compute(from, e.target.value, daily); }}
            className={INPUT_CLS}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Daily rate ({currency})</label>
        <input
          type="number"
          value={daily}
          onChange={e => { setDaily(e.target.value); compute(from, to, e.target.value); }}
          placeholder="0.00"
          min="0"
          step="0.01"
          className={INPUT_CLS + " tabular-nums"}
        />
      </div>

      {total != null ? (
        <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-indigo-100">
          <span className="text-xs text-gray-500">
            {days} day{days !== 1 ? "s" : ""} × {currency} {rate!.toLocaleString()}
          </span>
          <span className="text-sm font-bold text-indigo-700 tabular-nums">
            {currency} {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      ) : (
        <p className="text-[11px] text-indigo-400">Enter dates and daily rate to calculate total</p>
      )}
    </div>
  );
}
