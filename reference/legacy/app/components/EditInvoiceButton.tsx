"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";
import VendorCombobox from "./VendorCombobox";

export type InvoicePatch = {
  parties: string;
  referenceNumber: string | null;
  issueDate: Date | null;
  expiryDate: Date | null;
  amount: number | null;
  currency: string | null;
  notes: string | null;
};

type Props = {
  documentId: string;
  vendor: string;
  referenceNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  amount: number | null;
  currency: string | null;
  notes: string | null;
  onUpdate?: (patch: InvoicePatch) => void;
};

type Form = {
  vendor: string;
  referenceNumber: string;
  issueDate: string;
  expiryDate: string;
  amount: string;
  currency: string;
  notes: string;
};

export default function EditInvoiceButton({
  documentId,
  vendor,
  referenceNumber,
  issueDate,
  expiryDate,
  amount,
  currency,
  notes,
  onUpdate,
}: Props) {
  const activeCurrencies = useActiveCurrencies();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<string[]>([]);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/invoices/vendors")
      .then(r => r.ok ? r.json() : { vendors: [] })
      .then(d => setVendors(d.vendors ?? []))
      .catch(() => {});
  }, []);

  const initial: Form = {
    vendor:          vendor ?? "",
    referenceNumber: referenceNumber ?? "",
    issueDate:       issueDate ? issueDate.slice(0, 10) : "",
    expiryDate:      expiryDate ? expiryDate.slice(0, 10) : "",
    amount:          amount != null ? String(amount) : "",
    currency:        currency ?? "AED",
    notes:           notes ?? "",
  };

  const [form, setForm] = useState<Form>(initial);

  function set(key: keyof Form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
    setError(null);
  }

  function openModal() {
    setForm(initial);
    setError(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.vendor.trim()) { setError("Vendor name is required"); return; }

    setSaving(true);
    setError(null);

    const res = await fetch(`/api/invoices/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendor:          form.vendor,
        referenceNumber: form.referenceNumber || null,
        issueDate:       form.issueDate  || null,
        expiryDate:      form.expiryDate || null,
        amount:          form.amount ? parseFloat(form.amount) : null,
        currency:        form.currency || null,
        notes:           form.notes   || null,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Failed to save changes");
      setSaving(false);
      return;
    }

    setOpen(false);
    setSaving(false);
    if (onUpdate) {
      onUpdate({
        parties: JSON.stringify([form.vendor.trim()]),
        referenceNumber: form.referenceNumber || null,
        issueDate:  form.issueDate  ? new Date(form.issueDate)  : null,
        expiryDate: form.expiryDate ? new Date(form.expiryDate) : null,
        amount:   form.amount ? parseFloat(form.amount) : null,
        currency: form.currency || null,
        notes:    form.notes   || null,
      });
    } else {
      router.refresh();
    }
  }

  return (
    <>
      <button
        onClick={openModal}
        title="Edit invoice"
        className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
              <h2 className="text-sm font-semibold text-gray-900">Edit invoice</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <form onSubmit={submit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Client <span className="text-red-400">*</span>
                </label>
                <VendorCombobox
                  value={form.vendor}
                  onChange={v => set("vendor", v)}
                  vendors={vendors}
                  placeholder="Search or add client…"
                  inputClassName="h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Reference #</label>
                  <input
                    type="text"
                    value={form.referenceNumber}
                    onChange={e => set("referenceNumber", e.target.value)}
                    placeholder="e.g. INV-2026-001"
                    className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400"
                  />
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Invoice date</label>
                  <input
                    type="date"
                    value={form.issueDate}
                    onChange={e => set("issueDate", e.target.value)}
                    className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Due date</label>
                  <input
                    type="date"
                    value={form.expiryDate}
                    onChange={e => set("expiryDate", e.target.value)}
                    className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Amount</label>
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
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={e => set("notes", e.target.value)}
                  placeholder="Optional — any special terms or remarks"
                  className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400"
                />
              </div>

              {error && (
                <p className="text-xs font-medium text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 bg-surface-inset border border-surface-border rounded-lg hover:bg-surface-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 rounded-lg transition-colors"
                >
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
