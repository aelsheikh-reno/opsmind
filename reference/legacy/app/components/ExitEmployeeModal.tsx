"use client";

import { useEffect, useState } from "react";

const REASONS = [
  "Resigned",
  "Terminated",
  "Contract not renewed",
  "End of probation",
];

type Props = {
  person: {
    id: string;
    name: string;
    salary: number | null;
    currency: string | null;
    exitDate: string | null;
    exitReason: string | null;
  };
};

export default function ExitEmployeeModal({ person }: Props) {
  const [open, setOpen] = useState(false);
  const [exitDate, setExitDate] = useState(person.exitDate ?? "");
  const [exitReason, setExitReason] = useState(person.exitReason ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasExit = !!person.exitDate;

  // The full-month salary to pro-rate against — fetched from the server so it reflects the
  // previous month's actual payroll (UAE Labour Law standard), not the flat person.salary
  // field, which can be stale/inaccurate if pay varies by schedule or has since changed.
  const [basePreview, setBasePreview] = useState<{ baseSalary: number; currency: string } | null>(null);

  useEffect(() => {
    if (!open || !exitDate) return;
    const d = new Date(exitDate);
    if (isNaN(d.getTime())) return;
    const today = new Date();
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    if (monthStart < currentMonthStart) return;

    let cancelled = false;
    fetch(`/api/people/${person.id}/exit-preview?exitDate=${exitDate}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((j) => { if (!cancelled) setBasePreview(j?.base ?? null); })
      .catch(() => { if (!cancelled) setBasePreview(null); });
    return () => { cancelled = true; };
  }, [open, exitDate, person.id]);

  const proRataPreview = (() => {
    if (!exitDate) return null;
    const d = new Date(exitDate);
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    if (monthStart < currentMonthStart) return null;
    const base = basePreview?.baseSalary ?? person.salary;
    if (!base) return null;
    const currency = basePreview?.currency ?? person.currency ?? "AED";
    const daysWorked = d.getDate();
    const proRated = Math.round((base / 30) * daysWorked * 100) / 100;
    return { daysWorked, proRated, baseSalary: base, currency };
  })();

  function openModal() {
    setExitDate(person.exitDate ?? "");
    setExitReason(person.exitReason ?? "");
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!exitDate) { setError("Exit date is required"); return; }
    if (!exitReason) { setError("Exit reason is required"); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exitDate, exitReason }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Failed to save");
        return;
      }
      setOpen(false);
      window.location.reload();
    } finally {
      setLoading(false);
    }
  }

  async function handleClear() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exitDate: null, exitReason: null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Failed to clear");
        return;
      }
      setOpen(false);
      window.location.reload();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={openModal}
        className={`text-xs font-medium transition-colors px-2 py-1 rounded-lg ${
          hasExit
            ? "text-amber-600 hover:text-amber-800 hover:bg-amber-50"
            : "text-gray-400 hover:text-gray-600 hover:bg-surface-inset"
        }`}
        title={hasExit ? "Edit exit" : "Set exit date"}
      >
        {hasExit ? "Edit exit" : "Set exit"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Employee exit</h2>
                <p className="text-sm text-gray-500 mt-0.5">{person.name}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Exit date</label>
                <input
                  type="date"
                  value={exitDate}
                  onChange={(e) => setExitDate(e.target.value)}
                  className="w-full border border-surface-border rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Exit reason</label>
                <select
                  value={exitReason}
                  onChange={(e) => setExitReason(e.target.value)}
                  className="w-full border border-surface-border rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="">Select reason…</option>
                  {REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              {proRataPreview && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-amber-700 mb-1">
                    {exitReason === "Contract not renewed" || exitReason === "End of probation"
                      ? "Final month salary"
                      : "Pro-rated final salary"}
                  </p>
                  <p className="text-sm text-amber-800">
                    {proRataPreview.daysWorked}/30 days × {proRataPreview.currency}{" "}
                    {proRataPreview.baseSalary.toLocaleString("en-US")} ={" "}
                    <strong>
                      {proRataPreview.currency} {proRataPreview.proRated.toLocaleString("en-US")}
                    </strong>
                  </p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    {exitReason === "Contract not renewed" || exitReason === "End of probation"
                      ? "Salary for days worked in final month"
                      : "UAE Labour Law standard (÷ 30 days)"}
                  </p>
                </div>
              )}

              {error && <p className="text-xs text-red-600">{error}</p>}

              <div className="flex items-center gap-2 pt-1">
                {hasExit && (
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={loading}
                    className="text-xs text-gray-400 hover:text-indigo-600 transition-colors px-2 py-1.5"
                    title="Remove exit date — employee will be included in future payroll runs again"
                  >
                    Rehire (clear exit)
                  </button>
                )}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
