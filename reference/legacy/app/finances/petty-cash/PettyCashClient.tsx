"use client";

import { useState } from "react";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";
import { AttachmentChips } from "@/app/components/AttachmentChips";

type Person = { id: string; name: string };

type FloatExpense = {
  id: string;
  amount: number | null;
  currency: string;
  claimStatus: string | null;
  claimNote: string | null;
  dueOn: string | null;
  expenseType: string | null;
  notes: string | null;
  attachments: { id: string; name: string; downloadUrl: string }[];
};

type PettyCashFloat = {
  id: string;
  personId: string | null;
  person: Person | null;
  amount: number;
  currency: string;
  handedAt: string;
  note: string | null;
  status: string;
  createdAt: string;
  expenses: FloatExpense[];
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmt(v: number, currency: string) {
  return `${currency} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function StatusChip({ status }: { status: string }) {
  return status === "cleared" ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Cleared
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Open
    </span>
  );
}

function ClaimStatusChip({ status }: { status: string | null }) {
  if (status === "approved") return <span className="text-[9px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-100">Approved</span>;
  if (status === "rejected") return <span className="text-[9px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full border border-red-100">Rejected</span>;
  if (status === "pending")  return <span className="text-[9px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full border border-blue-100">Pending</span>;
  return null;
}

// ── Hand Out Cash Modal ────────────────────────────────────────────────────────

function HandOutModal({
  people,
  onClose,
  onCreated,
}: {
  people: Person[];
  onClose: () => void;
  onCreated: (float: PettyCashFloat) => void;
}) {
  const activeCurrencies = useActiveCurrencies();
  const today = new Date().toISOString().slice(0, 10);
  const [personId, setPersonId] = useState("");
  const [amount, setAmount]     = useState("");
  const [currency, setCurrency] = useState("AED");
  const [handedAt, setHandedAt] = useState(today);
  const [note, setNote]         = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  async function handleSave() {
    if (!amount || !handedAt) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/petty-cash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId: personId || null, amount, currency, handedAt, note }),
    });
    if (res.ok) {
      const created = await res.json();
      onCreated({ ...created, expenses: [] });
      onClose();
    } else {
      setError("Failed to save. Please try again.");
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => !saving && onClose()} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-gray-900">Hand out petty cash</h2>
          <button onClick={() => !saving && onClose()} className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Person</label>
            <select value={personId} onChange={e => setPersonId(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 bg-white">
              <option value="">— Unassigned —</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="flex gap-3">
            <div className="w-24 shrink-0">
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Currency</label>
              <select value={currency} onChange={e => setCurrency(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 bg-white">
                {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Amount</label>
              <input autoFocus type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                placeholder="0" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Date handed</label>
            <input type="date" value={handedAt} onChange={e => setHandedAt(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400" />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Note <span className="normal-case font-normal text-gray-400">(optional)</span>
            </label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
              placeholder="e.g. Office supplies run" />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-surface-border bg-surface-inset">
          <button onClick={() => !saving && onClose()} disabled={saving} className="text-sm font-medium text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !amount || !handedAt}
            className="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2 rounded-lg transition-colors flex items-center gap-2">
            {saving && <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" /><path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
            {saving ? "Saving…" : "Hand out cash"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Modal ─────────────────────────────────────────────────────────────────

function EditModal({
  float,
  people,
  onClose,
  onSaved,
}: {
  float: PettyCashFloat;
  people: Person[];
  onClose: () => void;
  onSaved: (updated: PettyCashFloat) => void;
}) {
  const activeCurrencies = useActiveCurrencies();
  const [personId, setPersonId] = useState(float.personId ?? "");
  const [amount,   setAmount]   = useState(String(float.amount));
  const [currency, setCurrency] = useState(float.currency);
  const [handedAt, setHandedAt] = useState(float.handedAt.slice(0, 10));
  const [note,     setNote]     = useState(float.note ?? "");
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");

  async function handleSave() {
    if (!amount || !handedAt) return;
    setSaving(true);
    setError("");
    const res = await fetch(`/api/petty-cash/${float.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId: personId || null, amount, currency, handedAt, note }),
    });
    if (res.ok) {
      const updated = await res.json();
      onSaved({ ...float, ...updated });
      onClose();
    } else {
      setError("Failed to save. Please try again.");
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => !saving && onClose()} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-gray-900">Edit petty cash float</h2>
          <button onClick={() => !saving && onClose()} className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Person</label>
            <select value={personId} onChange={e => setPersonId(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 bg-white">
              <option value="">— Unassigned —</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="flex gap-3">
            <div className="w-24 shrink-0">
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Currency</label>
              <select value={currency} onChange={e => setCurrency(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 bg-white">
                {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Amount</label>
              <input autoFocus type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                placeholder="0" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Date handed</label>
            <input type="date" value={handedAt} onChange={e => setHandedAt(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400" />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Note <span className="normal-case font-normal text-gray-400">(optional)</span>
            </label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
              placeholder="e.g. Office supplies run" />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-surface-border bg-surface-inset">
          <button onClick={() => !saving && onClose()} disabled={saving} className="text-sm font-medium text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !amount || !handedAt}
            className="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2 rounded-lg transition-colors flex items-center gap-2">
            {saving && <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" /><path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PettyCashClient({
  floats: initialFloats,
  people,
}: {
  floats: PettyCashFloat[];
  people: Person[];
}) {
  const [floats, setFloats]           = useState<PettyCashFloat[]>(initialFloats);
  const [showModal, setShowModal]     = useState(false);
  const [editingFloat, setEditingFloat] = useState<PettyCashFloat | null>(null);
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [togglingId, setTogglingId]   = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId]   = useState<string | null>(null);

  const openFloats    = floats.filter(f => f.status === "open");
  const clearedFloats = floats.filter(f => f.status === "cleared");

  const totalOutstanding = openFloats.reduce((sum, f) => {
    const submitted = f.expenses.filter(e => e.claimStatus !== "rejected").reduce((s, e) => s + (e.amount ?? 0), 0);
    return sum + Math.max(0, f.amount - submitted);
  }, 0);

  async function toggleStatus(float: PettyCashFloat) {
    setTogglingId(float.id);
    const newStatus = float.status === "open" ? "cleared" : "open";
    const res = await fetch(`/api/petty-cash/${float.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      setFloats(prev => prev.map(f => f.id === float.id ? { ...f, status: newStatus } : f));
    }
    setTogglingId(null);
  }

  function handleCreated(float: PettyCashFloat) {
    setFloats(prev => [float, ...prev]);
  }

  function handleSaved(updated: PettyCashFloat) {
    setFloats(prev => prev.map(f => f.id === updated.id ? { ...f, ...updated } : f));
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const res = await fetch(`/api/petty-cash/${id}`, { method: "DELETE" });
    if (res.ok) {
      setFloats(prev => prev.filter(f => f.id !== id));
      setConfirmDeleteId(null);
    }
    setDeletingId(null);
  }

  return (
    <>
      {showModal && (
        <HandOutModal people={people} onClose={() => setShowModal(false)} onCreated={handleCreated} />
      )}
      {editingFloat && (
        <EditModal float={editingFloat} people={people} onClose={() => setEditingFloat(null)} onSaved={handleSaved} />
      )}

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white border border-surface-border rounded-xl px-4 py-3">
          <p className="text-xs text-gray-500 mb-1">Open floats</p>
          <p className="text-2xl font-bold text-gray-900">{openFloats.length}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">awaiting receipts</p>
        </div>
        <div className="bg-white border border-surface-border rounded-xl px-4 py-3">
          <p className="text-xs text-gray-500 mb-1">Outstanding</p>
          <p className="text-2xl font-bold text-amber-600">{totalOutstanding.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">unreconciled across all currencies</p>
        </div>
        <div className="bg-white border border-surface-border rounded-xl px-4 py-3">
          <p className="text-xs text-gray-500 mb-1">Cleared</p>
          <p className="text-2xl font-bold text-emerald-600">{clearedFloats.length}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">fully reconciled</p>
        </div>
      </div>

      {/* Floats table */}
      <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-gray-900">All floats</h2>
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            Hand out cash
          </button>
        </div>

        {floats.length === 0 && (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-gray-400">No petty cash floats yet.</p>
            <p className="text-xs text-gray-300 mt-1">Click &ldquo;Hand out cash&rdquo; to record the first one.</p>
          </div>
        )}

        {floats.length > 0 && (
          <div className="divide-y divide-surface-border">
            {floats.map(float => {
              const validExpenses = float.expenses.filter(e => e.claimStatus !== "rejected");
              const submittedTotal = validExpenses.reduce((s, e) => s + (e.amount ?? 0), 0);
              const outstanding = Math.max(0, float.amount - submittedTotal);
              const pct = float.amount > 0 ? Math.min(100, (submittedTotal / float.amount) * 100) : 0;
              const isExpanded = expandedId === float.id;

              return (
                <div key={float.id}>
                  {/* Main row */}
                  <div className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : float.id)}
                  >
                    {/* Person */}
                    <div className="w-36 shrink-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{float.person?.name ?? "—"}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{fmtDate(float.handedAt)}</p>
                    </div>

                    {/* Amount handed */}
                    <div className="w-28 shrink-0 text-right">
                      <p className="text-sm font-semibold text-gray-900 tabular-nums">{fmt(float.amount, float.currency)}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">handed</p>
                    </div>

                    {/* Progress bar + submitted */}
                    <div className="flex-1 min-w-0">
                      {float.note && <p className="text-xs text-gray-500 mb-1.5 truncate">{float.note}</p>}
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all ${pct >= 100 ? "bg-emerald-500" : "bg-indigo-400"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-gray-400">
                          {fmt(submittedTotal, float.currency)} submitted · {validExpenses.length} receipt{validExpenses.length !== 1 ? "s" : ""}
                          {float.expenses.length > validExpenses.length && (
                            <span className="text-red-400 ml-1">· {float.expenses.length - validExpenses.length} rejected</span>
                          )}
                        </span>
                        {outstanding > 0 && (
                          <span className="text-[10px] font-semibold text-amber-600">{fmt(outstanding, float.currency)} outstanding</span>
                        )}
                        {outstanding === 0 && float.expenses.length > 0 && (
                          <span className="text-[10px] font-semibold text-emerald-600">Fully covered</span>
                        )}
                      </div>
                    </div>

                    {/* Status + actions */}
                    <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                      <StatusChip status={float.status} />
                      {float.status === "open" && (
                        <button
                          onClick={() => toggleStatus(float)}
                          disabled={togglingId === float.id}
                          className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {togglingId === float.id ? "…" : "Mark cleared"}
                        </button>
                      )}
                      {float.status === "cleared" && (
                        <button
                          onClick={() => toggleStatus(float)}
                          disabled={togglingId === float.id}
                          className="text-[11px] font-medium text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                        >
                          {togglingId === float.id ? "…" : "Reopen"}
                        </button>
                      )}
                      {/* Edit */}
                      <button
                        onClick={() => setEditingFloat(float)}
                        className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                        title="Edit"
                      >
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                          <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      {/* Delete / confirm */}
                      {confirmDeleteId === float.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-gray-500">Delete?</span>
                          <button
                            onClick={() => handleDelete(float.id)}
                            disabled={deletingId === float.id}
                            className="text-[11px] font-semibold text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                          >
                            {deletingId === float.id ? "…" : "Delete"}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-[11px] text-gray-400 hover:text-gray-700 px-1 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(float.id)}
                          className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Delete"
                        >
                          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                            <path d="M2 4h10M5 4V2.5h4V4M5.5 6.5v4M8.5 6.5v4M3 4l.75 7.5h6.5L11 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      )}
                      {/* Expand chevron */}
                      <button
                        onClick={e => { e.stopPropagation(); setExpandedId(isExpanded ? null : float.id); }}
                        className="w-6 h-6 flex items-center justify-center"
                      >
                        <svg
                          className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          viewBox="0 0 12 12" fill="none"
                        >
                          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Expanded receipts */}
                  {isExpanded && (
                    <div className="border-t border-surface-border bg-surface-inset px-5 py-3">
                      {float.expenses.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">No receipts submitted yet.</p>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Submitted receipts</p>
                          {float.expenses.map(exp => (
                            <div key={exp.id} className="bg-white border border-surface-border rounded-lg px-3 py-2.5">
                              <div className="flex items-center gap-3">
                                <div className="w-5 h-5 rounded bg-gray-100 flex items-center justify-center shrink-0">
                                  <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                                    <rect x="2" y="1" width="10" height="12" rx="1.5" stroke="#6b7280" strokeWidth="1.3" />
                                    <path d="M5 5h4M5 7.5h4M5 10h2" stroke="#6b7280" strokeWidth="1.2" strokeLinecap="round" />
                                  </svg>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-gray-800 truncate">
                                    {exp.expenseType ?? "Expense"}{exp.notes ? ` — ${exp.notes}` : ""}
                                  </p>
                                  {exp.dueOn && <p className="text-[10px] text-gray-400">{fmtDate(exp.dueOn)}</p>}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {exp.amount != null && (
                                    <span className="text-xs font-semibold tabular-nums text-gray-700">
                                      {fmt(exp.amount, exp.currency)}
                                    </span>
                                  )}
                                  <ClaimStatusChip status={exp.claimStatus} />
                                </div>
                              </div>
                              {exp.claimStatus === "rejected" && exp.claimNote && (
                                <div className="flex items-start gap-1.5 mt-2 bg-red-50 border border-red-100 rounded-md px-2.5 py-1.5">
                                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="shrink-0 mt-0.5">
                                    <path d="M3 3l6 6M9 3l-6 6" stroke="#dc2626" strokeWidth="1.4" strokeLinecap="round"/>
                                  </svg>
                                  <p className="text-[10px] text-red-600 leading-relaxed">{exp.claimNote}</p>
                                </div>
                              )}
                              {exp.attachments.length > 0 && (
                                <AttachmentChips attachments={exp.attachments} className="mt-2" />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
