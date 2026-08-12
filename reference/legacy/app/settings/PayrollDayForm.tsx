"use client";

import { useState } from "react";

export default function PayrollDayForm({ initialDay }: { initialDay: number | null }) {
  const [selected, setSelected] = useState<number | null>(initialDay);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const days = Array.from({ length: 28 }, (_, i) => i + 1);

  async function save() {
    if (!selected) return;
    setSaving(true);
    setSaved(false);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "payrollDay", value: String(selected) }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-4">
        Select the day of each month when payroll is processed. The dashboard will show a countdown and expected payout amount.
      </p>

      <div className="grid grid-cols-7 gap-2 mb-6">
        {days.map((day) => (
          <button
            key={day}
            onClick={() => { setSelected(day); setSaved(false); }}
            className={`h-10 w-full rounded-lg text-sm font-semibold transition-colors ${
              selected === day
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-surface-inset text-gray-700 hover:bg-gray-100 border border-surface-border"
            }`}
          >
            {day}
          </button>
        ))}
      </div>

      {selected && (
        <div className="flex items-center gap-3 mb-4 px-4 py-3 bg-surface-inset border border-surface-border rounded-xl">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="3" width="14" height="12" rx="2" stroke="#4f46e5" strokeWidth="1.3" fill="none" />
              <path d="M5 1v4M11 1v4M1 7h14" stroke="#4f46e5" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Payroll runs on day <span className="text-indigo-600">{selected}</span> of each month
            </p>
            <p className="text-xs text-gray-400">Dashboard will show next payroll date and expected amount</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={!selected || saving}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            !selected
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : saving
              ? "bg-indigo-400 text-white cursor-wait"
              : "bg-indigo-600 hover:bg-indigo-700 text-white"
          }`}
        >
          {saving ? (
            <>
              <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" />
              </svg>
              Saving…
            </>
          ) : "Save setting"}
        </button>

        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-green-700 font-medium">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 7l2.5 2.5L11 4" stroke="#15803d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
