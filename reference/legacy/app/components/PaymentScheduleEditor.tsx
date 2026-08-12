"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Money from "./Money";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";

type InvoiceRef = { id: string; filename: string; referenceNumber: string | null };

type ScheduleEntry = {
  id: string;
  dueDate: string; // ISO string from serialized Date
  amount: number;
  currency: string;
  description: string | null;
  scheduleType: string;
  isPaid: boolean;
  invoiceId: string | null;
  invoice: InvoiceRef | null;
  fxRateSnapshot: string | null;
};

type EditForm = {
  dueDate: string;
  amount: string;
  currency: string;
  description: string;
};

type InvoiceOption = {
  id: string;
  filename: string;
  referenceNumber: string | null;
  amount: number | null;
  currency: string | null;
  issueDate: string | null;
  parties: string | null;
  isPaid: boolean;
};

type RateOption = {
  year: number;
  month: number;
  key: string;
  label: string;
  rate: number | null;
  source: "locked" | "historical" | "live" | "forecast";
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function daysUntil(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function toDateInputValue(iso: string) {
  return iso.slice(0, 10);
}

function groupByYear(entries: ScheduleEntry[]): [string, ScheduleEntry[]][] {
  const map = new Map<string, ScheduleEntry[]>();
  for (const p of entries) {
    const key = String(new Date(p.dueDate).getFullYear());
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return Array.from(map.entries()).sort(([a], [b]) => Number(a) - Number(b));
}

// ── Add Payment Modal ─────────────────────────────────────────────────────────

function AddPaymentModal({
  defaultCurrency,
  onClose,
  onAdded,
  documentId,
  docType,
}: {
  defaultCurrency: string;
  documentId: string;
  docType?: string | null;
  onClose: () => void;
  onAdded: (entry: ScheduleEntry) => void;
}) {
  const activeCurrencies = useActiveCurrencies();
  const today = new Date();
  today.setDate(today.getDate() + 30);
  const [form, setForm] = useState<EditForm>({
    dueDate: today.toISOString().slice(0, 10),
    amount: "",
    currency: defaultCurrency,
    description: "",
  });
  const [scheduleType, setScheduleType] = useState<"salary" | "bonus">("salary");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isEmployeeContract = docType === "employee_contract";

  async function handleSave() {
    if (!form.amount || !form.dueDate) return;
    setSaving(true);
    setErrorMsg(null);
    const res = await fetch("/api/payment-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, documentId, scheduleType }),
    });
    if (res.ok) {
      const created = await res.json();
      onAdded({ ...created, scheduleType: created.scheduleType ?? scheduleType, invoiceId: created.invoiceId ?? null, invoice: null });
      onClose();
    } else {
      const data = await res.json().catch(() => ({}));
      setErrorMsg(data.error ?? "Failed to add payment");
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => !saving && onClose()} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm flex flex-col overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-gray-900">Add payment</h2>
          <button
            onClick={() => !saving && onClose()}
            className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {isEmployeeContract && (
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Type</label>
              <div className="flex gap-2">
                {(["salary", "bonus"] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setScheduleType(t)}
                    className={`flex-1 text-xs font-semibold py-1.5 rounded-lg border transition-colors capitalize ${
                      scheduleType === t
                        ? t === "bonus"
                          ? "bg-amber-50 text-amber-700 border-amber-300"
                          : "bg-indigo-50 text-indigo-700 border-indigo-300"
                        : "bg-white text-gray-400 border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {scheduleType === "bonus" && (
                <p className="text-[10px] text-amber-600 mt-1.5">
                  Added to the payroll entry for this month as a salary component.
                </p>
              )}
            </div>
          )}
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Due date</label>
            <input
              type="date"
              value={form.dueDate}
              onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
            />
          </div>
          <div className="flex gap-3">
            <div className="w-24 shrink-0">
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Currency</label>
              <select
                value={form.currency}
                onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 bg-white"
              >
                {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Amount</label>
              <input
                autoFocus
                type="number"
                min="0"
                step="any"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                placeholder="0"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Description <span className="normal-case font-normal text-gray-400">(optional)</span></label>
            <input
              type="text"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
              placeholder="e.g. Q1 payment"
            />
          </div>
        </div>

        {errorMsg && (
          <div className="px-5 pb-3">
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{errorMsg}</p>
          </div>
        )}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-surface-border bg-surface-inset">
          <button
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="text-sm font-medium text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.amount || !form.dueDate}
            className={`text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2 rounded-lg transition-colors flex items-center gap-2 ${
              scheduleType === "bonus" ? "bg-amber-500 hover:bg-amber-600" : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {saving && (
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" />
                <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
            {saving ? "Adding…" : scheduleType === "bonus" ? "Add bonus" : "Add payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Link Invoice Modal ────────────────────────────────────────────────────────

function LinkInvoiceModal({
  payment,
  isClient,
  onClose,
  onLinked,
}: {
  payment: ScheduleEntry;
  isClient: boolean;
  onClose: () => void;
  onLinked: (paymentId: string, invoice: InvoiceRef | null, isPaid: boolean) => void;
}) {
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/invoices")
      .then(r => r.json())
      .then(data => { setInvoices(data.invoices ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function link(invoiceId: string | null) {
    setSaving(true);
    const res = await fetch(`/api/payment-schedule/${payment.id}/invoice`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId }),
    });
    if (res.ok) {
      const data = await res.json();
      onLinked(payment.id, data.invoice ?? null, data.isPaid ?? payment.isPaid);
    }
    setSaving(false);
    onClose();
  }

  const vendors = Array.from(
    new Set(
      invoices.flatMap(inv => inv.parties ? (JSON.parse(inv.parties) as string[]) : []).filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  const filtered = invoices.filter(inv => {
    const parties: string[] = inv.parties ? JSON.parse(inv.parties) : [];
    if (selectedVendor && !parties.includes(selectedVendor)) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return inv.filename.toLowerCase().includes(q)
      || (inv.referenceNumber ?? "").toLowerCase().includes(q)
      || parties.some(p => p.toLowerCase().includes(q));
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] max-h-[70vh] flex flex-col mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Link invoice</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {payment.description ?? "Payment"} — {payment.currency} {payment.amount.toLocaleString("en-US")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Currently linked */}
        {payment.invoice && (
          <div className="mx-5 mt-4 flex items-center justify-between bg-green-50 border border-green-100 rounded-lg px-3 py-2.5">
            <Link
              href={`/records/invoices?q=${encodeURIComponent(payment.invoice.referenceNumber ?? payment.invoice.filename)}`}
              className="flex items-center gap-2 min-w-0 flex-1 group"
              onClick={onClose}
            >
              <div className="w-5 h-5 rounded bg-green-100 flex items-center justify-center shrink-0">
                <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                  <rect x="2" y="1" width="10" height="12" rx="1.5" stroke="#16a34a" strokeWidth="1.3" />
                  <path d="M5 5h4M5 7.5h4M5 10h2" stroke="#16a34a" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-green-800 truncate group-hover:underline">{payment.invoice.filename}</p>
                {payment.invoice.referenceNumber && (
                  <p className="text-[10px] text-green-600">Ref: {payment.invoice.referenceNumber}</p>
                )}
              </div>
              <svg className="shrink-0 text-green-500 opacity-0 group-hover:opacity-100 transition-opacity" width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M2 10L10 2M10 2H5M10 2v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <button
              onClick={() => link(null)}
              disabled={saving}
              className="text-xs font-medium text-red-500 hover:text-red-700 shrink-0 ml-3 transition-colors disabled:opacity-50"
            >
              Unlink
            </button>
          </div>
        )}

        {/* Search */}
        <div className="px-5 mt-4">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="13" height="13" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M9.5 9.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <input
              autoFocus
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search invoices…"
              className="w-full h-8 pl-8 pr-3 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
            />
          </div>
        </div>

        {/* Vendor filter dropdown */}
        {vendors.length > 1 && (
          <div className="px-5 mt-3">
            <select
              value={selectedVendor ?? ""}
              onChange={e => setSelectedVendor(e.target.value || null)}
              className="w-full h-8 px-2.5 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
            >
              <option value="">All vendors</option>
              {vendors.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        )}

        {/* Invoice list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-gray-400">No invoices found</p>
              <p className="text-xs text-gray-300 mt-1">Upload or create an invoice first</p>
            </div>
          )}
          {!loading && filtered.map(inv => {
            const isLinked = payment.invoiceId === inv.id;
            const parties: string[] = inv.parties ? JSON.parse(inv.parties) : [];
            const vendor = parties.join(", ");
            return (
              <button
                key={inv.id}
                onClick={() => link(inv.id)}
                disabled={saving || isLinked}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  isLinked
                    ? "bg-indigo-50 border border-indigo-200 cursor-default"
                    : "hover:bg-gray-50 border border-transparent hover:border-gray-100"
                }`}
              >
                <div className="w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <rect x="2" y="1" width="10" height="12" rx="1.5" stroke="#6b7280" strokeWidth="1.3" />
                    <path d="M5 5h4M5 7.5h4M5 10h2" stroke="#6b7280" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-900 truncate">{inv.filename}</p>
                  <p className="text-[10px] text-gray-400 truncate">
                    {vendor && `${vendor} · `}
                    {inv.referenceNumber ? `Ref: ${inv.referenceNumber} · ` : ""}
                    {inv.amount != null && inv.currency ? `${inv.currency} ${inv.amount.toLocaleString("en-US")}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {inv.isPaid && (
                    <span className="text-[9px] font-semibold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full border border-green-100">Paid</span>
                  )}
                  {isLinked && (
                    <span className="text-[10px] font-semibold text-indigo-600">Linked</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 space-y-1">
          {isClient && (
            <p className="text-[10px] font-medium text-amber-600">
              Vendor contract: linking a paid invoice will mark this payment as paid automatically.
            </p>
          )}
          <p className="text-[10px] text-gray-400">
            Don&apos;t see the invoice? Upload it in Records or create it manually via Invoices.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PaymentScheduleEditor({
  documentId,
  docType,
  initialSchedule,
  rates = {},
  monthRatesMap = {},
  canEdit = true,
}: {
  documentId: string;
  docType: string | null;
  initialSchedule: ScheduleEntry[];
  rates?: Record<string, number>;
  monthRatesMap?: Record<string, Record<string, number>>;
  canEdit?: boolean;
}) {
  const activeCurrencies = useActiveCurrencies();
  const isLease  = docType === "lease_contract";
  const isClient = docType === "client_contract" || docType === "purchase_order";
  const [schedule, setSchedule] = useState<ScheduleEntry[]>(
    [...initialSchedule].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [linkingPayment, setLinkingPayment] = useState<ScheduleEntry | null>(null);
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [rateOptions, setRateOptions] = useState<RateOption[]>([]);
  const [loadingRateOptions, setLoadingRateOptions] = useState(false);
  const [selectedRateKey, setSelectedRateKey] = useState("");
  const [savingRate, setSavingRate] = useState(false);

  // Returns the best rates for a payment: custom override > month rates > live fallback
  function getEffectiveRates(payment: ScheduleEntry): Record<string, number> {
    if (payment.fxRateSnapshot) {
      try { return JSON.parse(payment.fxRateSnapshot) as Record<string, number>; } catch { /* fall through */ }
    }
    const d = new Date(payment.dueDate);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    return monthRatesMap[key] ?? rates;
  }

  async function startEditRate(payment: ScheduleEntry) {
    const d = new Date(payment.dueDate);
    const paymentMonthKey = `${d.getFullYear()}-${d.getMonth() + 1}`;
    setEditingRateId(payment.id);
    setEditingId(null);
    setRateOptions([]);
    setSelectedRateKey(paymentMonthKey);
    setLoadingRateOptions(true);
    try {
      const res = await fetch(`/api/fx-rates?currency=${encodeURIComponent(payment.currency)}`);
      if (res.ok) {
        const data = await res.json();
        const opts: RateOption[] = data.options ?? [];
        setRateOptions(opts);
        const hasPaymentMonth = opts.some(o => o.key === paymentMonthKey && o.rate != null);
        if (!hasPaymentMonth) {
          const fallback = opts.find(o => o.rate != null);
          setSelectedRateKey(fallback?.key ?? "");
        }
      }
    } finally {
      setLoadingRateOptions(false);
    }
  }

  async function saveRateOverride(payment: ScheduleEntry) {
    const option = rateOptions.find(o => o.key === selectedRateKey);
    const val = option?.rate;
    if (!val || val <= 0) return;
    setSavingRate(true);
    const res = await fetch(`/api/payment-schedule/${payment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fxRate: val, currency: payment.currency }),
    });
    if (res.ok) {
      const snapshot = JSON.stringify({ [payment.currency]: val });
      setSchedule(prev => prev.map(p => p.id === payment.id ? { ...p, fxRateSnapshot: snapshot } : p));
    }
    setEditingRateId(null);
    setSavingRate(false);
  }

  async function resetRateOverride(paymentId: string) {
    setSavingRate(true);
    const res = await fetch(`/api/payment-schedule/${paymentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fxRate: null }),
    });
    if (res.ok) {
      setSchedule(prev => prev.map(p => p.id === paymentId ? { ...p, fxRateSnapshot: null } : p));
    }
    setEditingRateId(null);
    setSavingRate(false);
  }

  const defaultCurrency = schedule[0]?.currency ?? "AED";

  function startEdit(entry: ScheduleEntry) {
    setEditingId(entry.id);
    setIsAdding(false);
    setEditForm({
      dueDate: toDateInputValue(entry.dueDate),
      amount: String(entry.amount),
      currency: entry.currency,
      description: entry.description ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
  }

  async function saveEdit() {
    if (!editingId || !editForm) return;
    setSaving(true);
    const res = await fetch(`/api/payment-schedule/${editingId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    if (res.ok) {
      const updated = await res.json();
      setSchedule(prev =>
        [...prev.map(p => p.id === editingId
          ? { ...p, dueDate: updated.dueDate, amount: updated.amount, currency: updated.currency, description: updated.description }
          : p
        )].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      );
      setEditingId(null);
      setEditForm(null);
    }
    setSaving(false);
  }

  async function deleteEntry(id: string) {
    setDeletingId(id);
    const res = await fetch(`/api/payment-schedule/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSchedule(prev => prev.filter(p => p.id !== id));
      if (editingId === id) { setEditingId(null); setEditForm(null); }
    }
    setDeletingId(null);
  }

  function handleAdded(entry: ScheduleEntry) {
    setSchedule(prev =>
      [...prev, entry].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    );
  }

  async function togglePaid(entry: ScheduleEntry) {
    const res = await fetch(`/api/payment-schedule/${entry.id}`, { method: "PATCH" });
    if (res.ok) {
      const { isPaid } = await res.json();
      setSchedule(prev => prev.map(p => p.id === entry.id ? { ...p, isPaid } : p));
    }
  }

  function handleLinked(paymentId: string, invoice: InvoiceRef | null, isPaid: boolean) {
    setSchedule(prev => prev.map(p =>
      p.id === paymentId ? { ...p, invoiceId: invoice?.id ?? null, invoice, isPaid } : p
    ));
  }

  const upcoming = schedule.filter(p => !p.isPaid && daysUntil(p.dueDate) >= 0);
  const overdue  = schedule.filter(p => !p.isPaid && daysUntil(p.dueDate) < 0);
  const paid     = schedule.filter(p => p.isPaid);
  const totalRemaining = schedule.filter(p => !p.isPaid).reduce((s, p) => s + p.amount, 0);
  const totalPaid      = paid.reduce((s, p) => s + p.amount, 0);
  const grouped = groupByYear(schedule);

  const unlinkedCount = isClient ? schedule.filter(p => !p.isPaid && !p.invoiceId).length : 0;

  return (
    <>
      {isAdding && (
        <AddPaymentModal
          defaultCurrency={defaultCurrency}
          documentId={documentId}
          docType={docType}
          onClose={() => setIsAdding(false)}
          onAdded={(entry) => { handleAdded(entry); setIsAdding(false); }}
        />
      )}
      {linkingPayment && (
        <LinkInvoiceModal
          payment={linkingPayment}
          isClient={isClient}
          onClose={() => setLinkingPayment(null)}
          onLinked={handleLinked}
        />
      )}

      <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-violet-50 flex items-center justify-center shrink-0">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="3" width="14" height="12" rx="2" stroke="#7c3aed" strokeWidth="1.3" fill="none" />
                <path d="M5 1v4M11 1v4M1 7h14" stroke="#7c3aed" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-gray-900">Payment schedule</h2>
            <span className="text-xs text-gray-400 bg-surface-inset px-2 py-0.5 rounded-full">
              {schedule.length} payment{schedule.length !== 1 ? "s" : ""}
            </span>
            {unlinkedCount > 0 && (
              <span className="flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1L11 10H1L6 1z" stroke="#b45309" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
                  <path d="M6 5v2.5" stroke="#b45309" strokeWidth="1.2" strokeLinecap="round" />
                  <circle cx="6" cy="8.5" r="0.5" fill="#b45309" />
                </svg>
                {unlinkedCount} without invoice
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              {totalRemaining > 0 && (
                <p className="text-xs font-semibold text-gray-900">{defaultCurrency} {totalRemaining.toLocaleString("en-US")} remaining</p>
              )}
              {totalPaid > 0 && (
                <p className="text-xs text-gray-400">{defaultCurrency} {totalPaid.toLocaleString("en-US")} paid</p>
              )}
            </div>
            {canEdit && (
              <button
                onClick={() => { setIsAdding(true); setEditingId(null); setEditForm(null); }}
                className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Add
              </button>
            )}
          </div>
        </div>

        {/* Status chips */}
        {(overdue.length > 0 || upcoming.length > 0 || paid.length > 0) && (
          <div className="flex items-center gap-3 px-5 py-2.5 border-b border-surface-border bg-surface-inset">
            {overdue.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-red-700 bg-red-50 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />{overdue.length} overdue
              </span>
            )}
            {upcoming.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 bg-violet-50 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />{upcoming.length} upcoming
              </span>
            )}
            {paid.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />{paid.length} paid
              </span>
            )}
          </div>
        )}

        {/* Payment rows grouped by year */}
        {grouped.map(([groupLabel, payments]) => (
          <div key={groupLabel}>
            <div className="px-5 py-2 bg-surface-inset border-b border-surface-border">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{groupLabel}</span>
            </div>
            <div className="divide-y divide-surface-border">
              {payments.map((payment) => {
                const days = daysUntil(payment.dueDate);
                const isOverdue = !payment.isPaid && days < 0;
                const isDueSoon = !payment.isPaid && days >= 0 && days <= 14;
                const d = new Date(payment.dueDate);
                const hasInvoice = !!payment.invoiceId;

                if (editingId === payment.id && editForm) {
                  return (
                    <div key={payment.id} className="px-5 py-3 bg-indigo-50/30 border-l-2 border-indigo-300">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Date</label>
                          <input
                            type="date"
                            value={editForm.dueDate}
                            onChange={e => setEditForm({ ...editForm, dueDate: e.target.value })}
                            className="h-8 px-2 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
                          />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Amount</label>
                          <input
                            type="number"
                            value={editForm.amount}
                            onChange={e => setEditForm({ ...editForm, amount: e.target.value })}
                            className="h-8 w-28 px-2 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 tabular-nums"
                            placeholder="0"
                          />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Currency</label>
                          <select
                            value={editForm.currency}
                            onChange={e => setEditForm({ ...editForm, currency: e.target.value })}
                            className="h-8 px-2 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
                          >
                            {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div className="flex flex-col gap-0.5 flex-1 min-w-[140px]">
                          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Description</label>
                          <input
                            type="text"
                            value={editForm.description}
                            onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                            className="h-8 px-2 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
                            placeholder="e.g. H1 Year 2"
                          />
                        </div>
                        <div className="flex items-end gap-2 pb-0.5">
                          <button
                            onClick={saveEdit}
                            disabled={saving || !editForm.amount}
                            className="h-8 px-3 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg transition-colors"
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="h-8 px-3 text-xs font-semibold text-gray-600 bg-white border border-gray-200 hover:bg-surface-hover rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={payment.id}
                    className={`flex items-center gap-4 px-5 py-3 group transition-colors ${
                      payment.isPaid ? "opacity-50" :
                      isOverdue ? "bg-red-50/30" :
                      isDueSoon ? "bg-amber-50/20" : ""
                    }`}
                  >
                    {/* Paid indicator — interactive for lease (if canEdit), read-only otherwise */}
                    {isLease && canEdit ? (
                      <button
                        onClick={() => togglePaid(payment)}
                        title={payment.isPaid ? "Mark as unpaid" : "Mark as paid"}
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                          payment.isPaid
                            ? "bg-green-500 border-green-500"
                            : "border-gray-300 hover:border-green-400 bg-white"
                        }`}
                      >
                        {payment.isPaid && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    ) : (
                      <div
                        title={payment.isPaid ? "Paid (set by invoice)" : "Unpaid"}
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          payment.isPaid
                            ? "bg-green-500 border-green-500"
                            : "border-gray-200 bg-white"
                        }`}
                      >
                        {payment.isPaid && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    )}

                    {/* Date block */}
                    <div className="w-10 text-center shrink-0">
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">{MONTHS[d.getMonth()]}</p>
                      <p className="text-lg font-bold text-gray-900 leading-tight">{d.getDate()}</p>
                      <p className="text-[9px] text-gray-400">{d.getFullYear()}</p>
                    </div>

                    {/* Description + status */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className={`text-sm font-medium ${payment.isPaid ? "line-through text-gray-400" : "text-gray-800"}`}>
                          {payment.description ?? "—"}
                        </p>
                        {payment.scheduleType === "bonus" && (
                          <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full uppercase tracking-wide shrink-0">
                            Bonus
                          </span>
                        )}
                      </div>
                      {!payment.isPaid && (
                        <p className={`text-xs mt-0.5 ${isOverdue ? "text-red-500 font-medium" : isDueSoon ? "text-amber-600" : "text-gray-400"}`}>
                          {isOverdue ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `in ${days}d`}
                        </p>
                      )}
                      {payment.isPaid && <p className="text-xs text-green-600 mt-0.5">Paid</p>}
                    </div>

                    {/* Amount + per-month rate */}
                    <div className="shrink-0">
                      <Money
                        amount={payment.amount}
                        currency={payment.currency}
                        rates={getEffectiveRates(payment)}
                        size="sm"
                        muted={payment.isPaid}
                        showRate={false}
                      />
                      {payment.currency !== "USD" && (() => {
                        const effectiveRates = getEffectiveRates(payment);
                        const rate = effectiveRates[payment.currency];
                        if (!rate) return null;
                        const isCustom = !!payment.fxRateSnapshot && !payment.isPaid;
                        const d = new Date(payment.dueDate);
                        const monthKey = `${d.getFullYear()}-${d.getMonth() + 1}`;
                        const isMonthRate = !isCustom && !!monthRatesMap[monthKey];

                        if (editingRateId === payment.id) {
                          const validOptions = rateOptions.filter(o => o.rate != null);
                          return (
                            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                              {loadingRateOptions ? (
                                <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin shrink-0" />
                              ) : (
                                <select
                                  autoFocus
                                  value={selectedRateKey}
                                  onChange={e => setSelectedRateKey(e.target.value)}
                                  className="h-6 px-1 text-[11px] border border-indigo-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-200 bg-white max-w-[200px]"
                                >
                                  {validOptions.map(o => (
                                    <option key={o.key} value={o.key}>{o.label}</option>
                                  ))}
                                </select>
                              )}
                              <button
                                onClick={() => saveRateOverride(payment)}
                                disabled={savingRate || loadingRateOptions || !selectedRateKey}
                                className="h-6 px-1.5 text-[10px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 rounded-md transition-colors"
                              >
                                Save
                              </button>
                              {isCustom && (
                                <button
                                  onClick={() => resetRateOverride(payment.id)}
                                  disabled={savingRate}
                                  className="h-6 px-1.5 text-[10px] font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 rounded-md transition-colors"
                                  title="Reset to month rate"
                                >
                                  Reset
                                </button>
                              )}
                              <button
                                onClick={() => setEditingRateId(null)}
                                className="h-6 px-1.5 text-[10px] text-gray-400 hover:text-gray-600 rounded-md transition-colors"
                              >
                                ✕
                              </button>
                            </div>
                          );
                        }

                        return (
                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-[10px] tabular-nums text-gray-300">
                              1 USD = {rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} {payment.currency}
                            </span>
                            {isCustom && (
                              <span className="text-[9px] font-semibold text-amber-600 bg-amber-50 px-1 py-0.5 rounded-full border border-amber-100">custom</span>
                            )}
                            {isMonthRate && !isCustom && (
                              <span className="text-[9px] font-semibold text-gray-400 bg-gray-50 px-1 py-0.5 rounded-full border border-gray-100">month</span>
                            )}
                            {canEdit && !payment.isPaid && (
                              <button
                                onClick={() => startEditRate(payment)}
                                className="p-0.5 text-gray-300 hover:text-indigo-500 transition-colors"
                                title="Edit exchange rate"
                              >
                                <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                                  <path d="M9.5 2l2.5 2.5-7 7H2.5V9L9.5 2z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                                </svg>
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Invoice indicator — only relevant for vendor contracts */}
                    {isClient && (
                      payment.isPaid && hasInvoice ? (
                        <Link
                          href={`/records/${payment.invoiceId}`}
                          title={payment.invoice!.filename}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600 border border-gray-200 transition-colors shrink-0"
                        >
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                            <rect x="1.5" y="0.5" width="9" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                            <path d="M4 4h4M4 6.5h4M4 9h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                          </svg>
                          Invoice
                        </Link>
                      ) : !payment.isPaid ? (
                        <button
                          onClick={() => setLinkingPayment(payment)}
                          title={hasInvoice ? `Invoice linked: ${payment.invoice!.filename}` : "No invoice linked — click to link"}
                          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors shrink-0 ${
                            hasInvoice
                              ? "bg-green-50 text-green-700 hover:bg-green-100 border border-green-100"
                              : "bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
                          }`}
                        >
                          {hasInvoice ? (
                            <>
                              <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                                <rect x="1.5" y="0.5" width="9" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                                <path d="M4 4h4M4 6.5h4M4 9h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                              </svg>
                              Invoice
                            </>
                          ) : (
                            <>
                              <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                                <path d="M6 1L11 10H1L6 1z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
                                <path d="M6 5v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                                <circle cx="6" cy="8.5" r="0.6" fill="currentColor" />
                              </svg>
                              No invoice
                            </>
                          )}
                        </button>
                      ) : null
                    )}

                    {/* Edit / Delete actions — visible on row hover, hidden for read-only */}
                    <div className={`flex items-center gap-1 transition-opacity shrink-0 ${canEdit ? "opacity-0 group-hover:opacity-100" : "hidden"}`}>
                      <button
                        onClick={() => startEdit(payment)}
                        title="Edit payment"
                        className="p-1.5 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                          <path d="M9.5 2l2.5 2.5-7 7H2.5V9L9.5 2z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        </svg>
                      </button>
                      <button
                        onClick={() => deleteEntry(payment.id)}
                        disabled={deletingId === payment.id}
                        title="Delete payment"
                        className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                          <path d="M2 3.5h10M5 3.5V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1M11.5 3.5l-.7 8a.5.5 0 0 1-.5.5H3.7a.5.5 0 0 1-.5-.5l-.7-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Empty state */}
        {schedule.length === 0 && (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-gray-400">No payments in the schedule yet</p>
          </div>
        )}
      </div>
    </>
  );
}
