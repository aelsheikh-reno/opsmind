"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";
import type { Expense, ExpenseAttachment } from "@prisma/client";
import TypeSelect from "./TypeSelect";
import PerDiemCalc from "./PerDiemCalc";

type BudgetOption = { id: string; name: string };

type Props = {
  expense: Expense & { attachments: ExpenseAttachment[] };
  budgets?: BudgetOption[];
};

const PAYMENT_METHODS = ["Company Card", "Bank Transfer", "Cash", "Other"];

export default function EditExpenseModal({ expense, budgets = [] }: Props) {
  const router = useRouter();
  const activeCurrencies = useActiveCurrencies();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState(expense.attachments);

  const [form, setForm] = useState({
    name:          expense.name,
    expenseType:   expense.expenseType ?? "",
    currency:      expense.currency,
    amount:        expense.amount != null ? String(expense.amount) : "",
    dueOn:         expense.dueOn ? new Date(expense.dueOn).toISOString().split("T")[0] : "",
    paymentMethod: expense.paymentMethod ?? "",
    notes:         expense.notes ?? "",
    budgetId:      expense.budgetId ?? "",
  });

  function set(key: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
    setError(null);
  }

  function openModal() {
    setForm({
      name:          expense.name,
      expenseType:   expense.expenseType ?? "",
      currency:      expense.currency,
      amount:        expense.amount != null ? String(expense.amount) : "",
      dueOn:         expense.dueOn ? new Date(expense.dueOn).toISOString().split("T")[0] : "",
      paymentMethod: expense.paymentMethod ?? "",
      notes:         expense.notes ?? "",
      budgetId:      expense.budgetId ?? "",
    });
    setAttachments(expense.attachments);
    setError(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Description is required"); return; }
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/expenses/${expense.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:          form.name.trim(),
        expenseType:   form.expenseType || null,
        currency:      form.currency,
        amount:        form.amount ? parseFloat(form.amount) : null,
        dueOn:         form.dueOn || null,
        paymentMethod: form.paymentMethod || null,
        notes:         form.notes || null,
        budgetId:      form.budgetId || null,
      }),
    });

    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to save"); setSaving(false); return; }

    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  async function uploadAttachment(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/expenses/${expense.id}/attachments`, { method: "POST", body: fd });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (res.ok) {
        setAttachments(prev => [...prev, data.attachment]);
      } else {
        setError(data.error ?? "Upload failed");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  }

  async function deleteAttachment(attId: string) {
    await fetch(`/api/expenses/attachments/${attId}`, { method: "DELETE" });
    setAttachments(prev => prev.filter(a => a.id !== attId));
  }

  return (
    <>
      <button
        onClick={openModal}
        title="Edit expense"
        className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
              <h2 className="text-sm font-semibold text-gray-900">Edit expense</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
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
                  className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Type</label>
                  <TypeSelect value={form.expenseType} onChange={v => set("expenseType", v)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Currency</label>
                  <select value={form.currency} onChange={e => set("currency", e.target.value)}
                    className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors">
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
                  <input type="number" value={form.amount} onChange={e => set("amount", e.target.value)}
                    placeholder="0.00" min="0" step="0.01"
                    className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors tabular-nums placeholder-gray-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Date</label>
                  <input type="date" value={form.dueOn} onChange={e => set("dueOn", e.target.value)}
                    className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Payment method</label>
                <select value={form.paymentMethod} onChange={e => set("paymentMethod", e.target.value)}
                  className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors">
                  <option value="">— Select method —</option>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              {budgets.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Budget</label>
                  <select value={form.budgetId} onChange={e => set("budgetId", e.target.value)}
                    className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors">
                    <option value="">— No budget —</option>
                    {budgets.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes</label>
                <input type="text" value={form.notes} onChange={e => set("notes", e.target.value)}
                  placeholder="Optional"
                  className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400" />
              </div>

              {/* Attachments */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Attachments</label>
                  <label className={`flex items-center gap-1 text-[11px] font-medium cursor-pointer transition-colors ${uploading ? "text-gray-400" : "text-indigo-600 hover:text-indigo-800"}`}>
                    {uploading ? (
                      <><svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10"/>
                      </svg>Uploading…</>
                    ) : (
                      <><svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                        <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>Add file</>
                    )}
                    <input type="file" className="hidden" onChange={uploadAttachment} disabled={uploading}
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.gif" />
                  </label>
                </div>

                {attachments.length > 0 ? (
                  <div className="space-y-1">
                    {attachments.map(att => (
                      <div key={att.id} className="flex items-center justify-between px-2.5 py-1.5 bg-surface-inset rounded-lg">
                        <a
                          href={`/api/expenses/attachments/${att.id}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[11px] text-indigo-600 hover:text-indigo-800 underline truncate max-w-[300px]"
                        >
                          {att.name}
                        </a>
                        <button
                          type="button"
                          onClick={() => deleteAttachment(att.id)}
                          className="text-gray-300 hover:text-red-500 transition-colors ml-2 shrink-0"
                          title="Remove"
                        >
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-300">No attachments yet</p>
                )}
              </div>

              {error && <p className="text-xs font-medium text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

              <div className="flex items-center justify-end gap-3 pt-1">
                <button type="button" onClick={() => setOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 bg-surface-inset border border-surface-border rounded-lg hover:bg-surface-hover transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 rounded-lg transition-colors">
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
