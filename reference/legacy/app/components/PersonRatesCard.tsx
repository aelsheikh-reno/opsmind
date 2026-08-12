"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";

type Props = {
  personId: string;
  costPerHour: number | null;
  billingRate: number | null;
  rateCurrency: string | null;
  canWrite: boolean;
};

export default function PersonRatesCard({ personId, costPerHour, billingRate, rateCurrency, canWrite }: Props) {
  const router = useRouter();
  const activeCurrencies = useActiveCurrencies();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    costPerHour: costPerHour?.toString() ?? "",
    billingRate: billingRate?.toString() ?? "",
    rateCurrency: rateCurrency ?? "AED",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEdit() {
    setForm({
      costPerHour: costPerHour?.toString() ?? "",
      billingRate: billingRate?.toString() ?? "",
      rateCurrency: rateCurrency ?? "AED",
    });
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          costPerHour: form.costPerHour !== "" ? form.costPerHour : null,
          billingRate: form.billingRate !== "" ? form.billingRate : null,
          rateCurrency: form.rateCurrency || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Failed to save");
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const cur = rateCurrency ?? "AED";
  const hasRates = costPerHour != null || billingRate != null;
  const margin = costPerHour != null && billingRate != null && billingRate > 0
    ? ((billingRate - costPerHour) / billingRate) * 100
    : null;

  const liveCur = form.rateCurrency || "AED";
  const liveCost = form.costPerHour !== "" ? parseFloat(form.costPerHour) : null;
  const liveBill = form.billingRate !== "" ? parseFloat(form.billingRate) : null;
  const liveMargin = liveCost != null && liveBill != null && !isNaN(liveCost) && !isNaN(liveBill) && liveBill > 0
    ? ((liveBill - liveCost) / liveBill) * 100
    : null;

  return (
    <div className="bg-white border border-surface-border rounded-xl p-5 mb-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-violet-50 flex items-center justify-center shrink-0">
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v12M4 4h4.5a2.5 2.5 0 0 1 0 5H4M4 9h5" stroke="#7c3aed" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Labor rates</span>
        </div>
        {canWrite && !editing && (
          <button
            onClick={openEdit}
            className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 hover:text-indigo-600 transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path d="M8.5 1.5a1.414 1.414 0 0 1 2 2L3.5 10.5l-3 .5.5-3 7.5-7.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Edit
          </button>
        )}
      </div>

      {editing ? (
        /* ── inline edit form ── */
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Currency</label>
              <select
                value={form.rateCurrency}
                onChange={e => setForm(f => ({ ...f, rateCurrency: e.target.value }))}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
              >
                {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Cost per hour</label>
              <input
                type="number" min="0" step="any"
                value={form.costPerHour}
                onChange={e => setForm(f => ({ ...f, costPerHour: e.target.value }))}
                placeholder="e.g. 150"
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Billable rate / hr</label>
              <input
                type="number" min="0" step="any"
                value={form.billingRate}
                onChange={e => setForm(f => ({ ...f, billingRate: e.target.value }))}
                placeholder="e.g. 250"
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          </div>

          {liveMargin !== null && (
            <p className="text-[10px] text-gray-400">
              Margin: <span className="font-semibold text-indigo-600">{liveMargin.toFixed(0)}%</span>
              {" · "}Profit / hr:{" "}
              <span className="font-semibold text-indigo-600">
                {liveCur} {(liveBill! - liveCost!).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </p>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-1.5 rounded-lg"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="text-xs text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* ── display view ── */
        <>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Cost per hour</p>
              {costPerHour != null ? (
                <p className="text-xl font-bold text-gray-900">
                  {cur} {costPerHour.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </p>
              ) : (
                <p className="text-xl font-bold text-gray-300">—</p>
              )}
              <p className="text-[10px] text-gray-400 mt-0.5">Internal labor cost</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Billable rate / hr</p>
              {billingRate != null ? (
                <p className="text-xl font-bold text-gray-900">
                  {cur} {billingRate.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </p>
              ) : (
                <p className="text-xl font-bold text-gray-300">—</p>
              )}
              <p className="text-[10px] text-gray-400 mt-0.5">Rate charged to client</p>
            </div>
          </div>

          {hasRates && margin !== null && (
            <div className="mt-4 pt-4 border-t border-surface-border flex items-center gap-6">
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Gross margin</p>
                <p className={`text-sm font-bold ${margin >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {margin.toFixed(0)}%
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Profit per hour</p>
                <p className={`text-sm font-bold ${billingRate! - costPerHour! >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {cur} {(billingRate! - costPerHour!).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          )}

          {!hasRates && canWrite && (
            <p className="text-xs text-gray-400">
              No rates set.{" "}
              <button onClick={openEdit} className="text-indigo-500 hover:text-indigo-700 font-medium">Add rates</button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
