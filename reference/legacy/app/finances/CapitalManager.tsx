"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";

export type CapitalEntry = {
  id: string;
  amount: number;
  currency: string;
  date: string;
  source: string | null;
  type: string;
  notes: string | null;
};

const TYPES = [
  { value: "equity", label: "Equity injection" },
  { value: "loan",   label: "Loan received"    },
  { value: "grant",  label: "Grant"             },
  { value: "other",  label: "Other"             },
];


const TYPE_LABELS: Record<string, string> = {
  equity: "Equity",
  loan:   "Loan",
  grant:  "Grant",
  other:  "Other",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function CapitalModal({
  editing,
  onClose,
}: {
  editing: CapitalEntry | null;
  onClose: () => void;
}) {
  const router  = useRouter();
  const activeCurrencies = useActiveCurrencies();
  const isEdit  = editing !== null;

  const [amount,   setAmount]   = useState(isEdit ? String(editing!.amount)   : "");
  const [currency, setCurrency] = useState(isEdit ? editing!.currency         : "AED");
  const [date,     setDate]     = useState(isEdit ? editing!.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [source,   setSource]   = useState(isEdit ? (editing!.source ?? "")   : "");
  const [type,     setType]     = useState(isEdit ? editing!.type             : "equity");
  const [notes,    setNotes]    = useState(isEdit ? (editing!.notes ?? "")    : "");
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setError("Enter a valid positive amount"); return; }
    setSaving(true); setError(null);

    const url    = isEdit ? `/api/capital/${editing!.id}` : "/api/capital";
    const method = isEdit ? "PATCH" : "POST";

    try {
      const res  = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amt, currency, date, source: source || null, type, notes: notes || null }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Save failed"); setSaving(false); return; }
      router.refresh();
      onClose();
    } catch {
      setError("Network error");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-gray-900">
            {isEdit ? "Edit capital entry" : "Add capital to wallet"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="px-5 py-4 space-y-4">
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
                type="number" min="0" step="any" placeholder="0.00"
                value={amount} onChange={e => setAmount(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-300"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Date received</label>
            <input
              type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-300"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Type</label>
            <select
              value={type} onChange={e => setType(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-gray-300"
            >
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Source <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text" placeholder="Investor, shareholder, bank…"
              value={source} onChange={e => setSource(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-300"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Notes <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              rows={2} placeholder="Any additional details…"
              value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-gray-300"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex items-center justify-between pt-1">
            <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
              Cancel
            </button>
            <button
              type="submit" disabled={saving}
              className="flex items-center gap-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg transition-colors"
            >
              {saving ? "Saving…" : isEdit ? "Save changes" : "Save capital entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CapitalManager({ entries }: { entries: CapitalEntry[] }) {
  const router  = useRouter();
  const [modalOpen, setModalOpen]   = useState(false);
  const [editing,   setEditing]     = useState<CapitalEntry | null>(null);
  const [deleting,  setDeleting]    = useState<string | null>(null);

  function openAdd()  { setEditing(null);  setModalOpen(true); }
  function openEdit(e: CapitalEntry) { setEditing(e); setModalOpen(true); }
  function closeModal() { setModalOpen(false); setEditing(null); }

  async function deleteEntry(id: string) {
    if (!confirm("Delete this capital entry?")) return;
    setDeleting(id);
    try {
      await fetch(`/api/capital/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      {/* Header row */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-emerald-50 flex items-center justify-center shrink-0">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="#059669" strokeWidth="1.3" />
              <path d="M7 4.5v1m0 3v1m-1.5-3.5h2.5a1 1 0 0 1 0 2H5.5a1 1 0 0 0 0 2H8" stroke="#059669" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-gray-900">Capital injections</span>
          {entries.length > 0 && (
            <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{entries.length}</span>
          )}
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Add capital
        </button>
      </div>

      {/* List */}
      {entries.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-gray-400">No capital entries yet</p>
          <p className="text-xs text-gray-300 mt-1">Record equity injections, loans, or grants received by the company</p>
        </div>
      ) : (
        <div className="divide-y divide-surface-border">
          {entries.map(ci => (
            <div key={ci.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-inset/50 transition-colors group">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full capitalize">
                    {TYPE_LABELS[ci.type] ?? ci.type}
                  </span>
                  {ci.source && (
                    <span className="text-xs text-gray-700 truncate">{ci.source}</span>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">{fmtDate(ci.date)}</p>
                {ci.notes && (
                  <p className="text-[10px] text-gray-400 mt-0.5 truncate">{ci.notes}</p>
                )}
              </div>
              <p className="font-semibold text-sm text-emerald-600 tabular-nums shrink-0">
                +{ci.currency} {ci.amount.toLocaleString("en-US")}
              </p>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  onClick={() => openEdit(ci)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                  title="Edit"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  onClick={() => deleteEntry(ci.id)}
                  disabled={deleting === ci.id}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                  title="Delete"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M2 4h10M5 4V2.5h4V4M5.5 6v5M8.5 6v5M3 4l.5 8h7L11 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <CapitalModal editing={editing} onClose={closeModal} />
      )}
    </>
  );
}
