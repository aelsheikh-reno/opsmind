"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";

const TYPES = [
  { value: "equity",  label: "Equity injection"  },
  { value: "loan",    label: "Loan received"      },
  { value: "grant",   label: "Grant"              },
  { value: "other",   label: "Other"              },
];

export default function AddCapitalModal() {
  const router = useRouter();
  const activeCurrencies = useActiveCurrencies();
  const [open, setOpen]       = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const [amount,   setAmount]   = useState("");
  const [currency, setCurrency] = useState("AED");
  const [date,     setDate]     = useState(() => new Date().toISOString().slice(0, 10));
  const [source,   setSource]   = useState("");
  const [type,     setType]     = useState("equity");
  const [notes,    setNotes]    = useState("");

  function reset() {
    setAmount(""); setCurrency("AED");
    setDate(new Date().toISOString().slice(0, 10));
    setSource(""); setType("equity"); setNotes("");
    setError(null);
  }

  function close() { setOpen(false); reset(); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setError("Enter a valid positive amount"); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/capital", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amt, currency, date, source: source || undefined, type, notes: notes || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Save failed"); setSaving(false); return; }
      router.refresh();
      close();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3.5 py-2 rounded-lg transition-colors"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        Add capital
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col">

            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h2 className="text-sm font-semibold text-gray-900">Add capital to wallet</h2>
              <button onClick={close} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <form onSubmit={submit} className="px-5 py-4 space-y-4">

              {/* Amount + Currency */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Amount</label>
                <div className="flex gap-2">
                  <select
                    value={currency}
                    onChange={e => setCurrency(e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-surface-inset text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300"
                  >
                    {activeCurrencies.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-300"
                    required
                  />
                </div>
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Date received</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-300"
                  required
                />
              </div>

              {/* Type */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Type</label>
                <select
                  value={type}
                  onChange={e => setType(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-gray-300"
                >
                  {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              {/* Source */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Source <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="text"
                  placeholder="Investor name, shareholder, bank…"
                  value={source}
                  onChange={e => setSource(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-300"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
                <textarea
                  rows={2}
                  placeholder="Any additional details…"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-gray-300"
                />
              </div>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}

              <div className="flex items-center justify-between pt-1">
                <button type="button" onClick={close} className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  {saving ? "Saving…" : "Save capital entry"}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}
    </>
  );
}
