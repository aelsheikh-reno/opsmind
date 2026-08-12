"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PayrollFxRateEditor({
  runId,
  currencies,
  currentRates,
  hasSnapshot,
  hidden,
}: {
  runId: string;
  currencies: string[];
  currentRates: Record<string, number>;
  hasSnapshot?: boolean;
  hidden?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (hidden || currencies.length === 0) return null;

  function openEditor() {
    const initial: Record<string, string> = {};
    for (const c of currencies) {
      const rate = currentRates[c];
      initial[c] = rate != null ? String(rate) : "";
    }
    setDrafts(initial);
    setError(null);
    setOpen(true);
  }

  async function save() {
    const params = new URLSearchParams({ runId, action: "edit" });
    let hasValue = false;
    for (const c of currencies) {
      const num = parseFloat(drafts[c] ?? "");
      if (!isNaN(num) && num > 0) {
        params.set(c, String(num));
        hasValue = true;
      }
    }
    if (!hasValue) { setError("Enter at least one rate."); return; }

    setSaving(true);
    setError(null);
    const res = await fetch(`/api/payroll/rate-lock?${params}`, { method: "PATCH" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError((json as { error?: string }).error ?? "Failed to save rates.");
    } else {
      setOpen(false);
      router.refresh();
    }
    setSaving(false);
  }

  async function resetToLive() {
    setResetting(true);
    setError(null);
    const res = await fetch(`/api/payroll/rate-lock?runId=${runId}&action=unlock`, { method: "PATCH" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError((json as { error?: string }).error ?? "Failed to reset rates.");
    } else {
      setOpen(false);
      router.refresh();
    }
    setResetting(false);
  }

  return (
    <div className="relative">
      <button
        onClick={openEditor}
        title="Edit exchange rates for this payroll month"
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 rounded-lg px-2.5 py-1.5 transition-colors bg-white"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M8.5 1.5a1.414 1.414 0 0 1 2 2L3.5 10.5l-2.5.5.5-2.5L8.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Edit rates
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-4 w-64">
            <p className="text-xs font-semibold text-gray-700 mb-0.5">Exchange rates</p>
            <p className="text-xs text-gray-400 mb-3">1 USD equals how much of each currency</p>

            <div className="space-y-2 mb-3">
              {currencies.map(c => (
                <div key={c} className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-8 shrink-0">1 USD</span>
                  <span className="text-gray-300 text-xs">=</span>
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={drafts[c] ?? ""}
                    onChange={e => setDrafts(d => ({ ...d, [c]: e.target.value }))}
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
                    placeholder="0.0000"
                  />
                  <span className="text-xs font-medium text-gray-600 w-10 shrink-0">{c}</span>
                </div>
              ))}
            </div>

            {error && <p className="text-[11px] text-red-500 mb-2">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 text-xs px-2 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || resetting}
                className="flex-1 text-xs px-2 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>

            {hasSnapshot && (
              <button
                onClick={resetToLive}
                disabled={resetting || saving}
                className="mt-2 w-full text-[11px] text-gray-400 hover:text-red-500 disabled:opacity-50 text-center transition-colors"
              >
                {resetting ? "Resetting…" : "Reset to live rate"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
