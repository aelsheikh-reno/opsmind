"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";
import TypeSelect from "./TypeSelect";
import PerDiemCalc from "./PerDiemCalc";

type Form = {
  name: string;
  expenseType: string;
  currency: string;
  amount: string;
  dueOn: string;
  paymentMethod: string;
  notes: string;
};

const empty: Form = {
  name: "",
  expenseType: "",
  currency: "AED",
  amount: "",
  dueOn: "",
  paymentMethod: "",
  notes: "",
};

const PAYMENT_METHODS = ["Company Card", "Bank Transfer", "Cash", "Other"];

export default function CreateExpenseModal() {
  const activeCurrencies = useActiveCurrencies();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function set(key: keyof Form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
    setError(null);
  }

  function close() {
    setOpen(false);
    setForm(empty);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Description is required"); return; }
    if (!form.expenseType) { setError("Type is required"); return; }
    if (!form.dueOn) { setError("Date is required"); return; }

    setSaving(true);
    setError(null);

    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:          form.name.trim(),
        expenseType:   form.expenseType || null,
        currency:      form.currency,
        amount:        form.amount ? parseFloat(form.amount) : null,
        dueOn:         form.dueOn || null,
        paymentMethod: form.paymentMethod || null,
        notes:         form.notes || null,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Failed to create expense");
      setSaving(false);
      return;
    }

    close();
    setSaving(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-white border border-gray-200 hover:bg-surface-hover text-gray-700 text-xs font-medium px-3.5 py-2 rounded-lg transition-colors"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        New expense
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={close} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
              <h2 className="text-sm font-semibold text-gray-900">New company expense</h2>
              <button onClick={close} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <form onSubmit={submit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Description <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => set("name", e.target.value)}
                  placeholder="e.g. Office supplies — Q2"
                  autoFocus
                  className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Type <span className="text-red-400">*</span></label>
                  <TypeSelect value={form.expenseType} onChange={v => set("expenseType", v)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Currency</label>
                  <select
                    value={form.currency}
                    onChange={e => set("currency", e.target.value)}
                    className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
                  >
                    {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {form.expenseType === "Per Diem" && (
                <PerDiemCalc
                  currency={form.currency}
                  onResult={amount => set("amount", amount != null ? String(amount) : "")}
                />
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    {form.expenseType === "Per Diem" ? "Total amount" : "Amount"}
                  </label>
                  <input
                    type="number"
                    value={form.amount}
                    onChange={e => set("amount", e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Date <span className="text-red-400">*</span></label>
                  <input
                    type="date"
                    value={form.dueOn}
                    onChange={e => set("dueOn", e.target.value)}
                    className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Payment method</label>
                <select
                  value={form.paymentMethod}
                  onChange={e => set("paymentMethod", e.target.value)}
                  className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
                >
                  <option value="">— Select method —</option>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={e => set("notes", e.target.value)}
                  placeholder="Optional"
                  className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400"
                />
              </div>

              {error && (
                <p className="text-xs font-medium text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={close}
                  className="px-4 py-2 text-sm font-medium text-gray-600 bg-surface-inset border border-surface-border rounded-lg hover:bg-surface-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 rounded-lg transition-colors"
                >
                  {saving ? "Creating…" : "Create expense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
