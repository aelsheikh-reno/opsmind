"use client";

import { useState } from "react";

export default function PayrollHorizonForm({ initialYear, minYear }: { initialYear: number | null; minYear: number }) {
  const currentYear = new Date().getFullYear();
  const [selected, setSelected] = useState<number | null>(initialYear);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const years = Array.from({ length: 12 }, (_, i) => currentYear + i);

  async function save() {
    if (!selected) return;
    setSaving(true);
    setSaved(false);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "payrollHorizonYear", value: String(selected) }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-4">
        Payroll months and exchange rates are shown up to December of this year. Employees with contracts beyond this date are still tracked — this only affects what&apos;s visible in the calendar.
      </p>

      <div className="grid grid-cols-4 gap-2 mb-5">
        {years.map((year) => {
          const disabled = year < minYear;
          return (
            <button
              key={year}
              disabled={disabled}
              onClick={() => { if (!disabled) { setSelected(year); setSaved(false); } }}
              title={disabled ? `Payroll runs exist through ${minYear} — cannot set horizon before this year` : undefined}
              className={`h-10 w-full rounded-lg text-sm font-semibold transition-colors ${
                disabled
                  ? "bg-surface-inset text-gray-300 border border-surface-border cursor-not-allowed"
                  : selected === year
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-surface-inset text-gray-700 hover:bg-gray-100 border border-surface-border"
              }`}
            >
              {year}
            </button>
          );
        })}
      </div>

      {minYear > currentYear && (
        <div className="flex items-start gap-2 mb-4 px-3 py-2.5 bg-amber-50 border border-amber-100 rounded-lg">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0 mt-0.5">
            <circle cx="7" cy="7" r="6" stroke="#d97706" strokeWidth="1.3" fill="none" />
            <path d="M7 4v3.5M7 9.5v.5" stroke="#d97706" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <p className="text-[11px] text-amber-800 leading-relaxed">
            Years before <span className="font-semibold">{minYear}</span> are disabled because payroll runs already exist through that year. The horizon cannot be set earlier than the latest payroll month.
          </p>
        </div>
      )}

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
              Payroll visible through <span className="text-indigo-600">December {selected}</span>
            </p>
            <p className="text-xs text-gray-400">Exchange rates will be generated for all months up to this date</p>
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
