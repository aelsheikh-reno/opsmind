"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";

type Form = {
  vendor: string;
  referenceNumber: string;
  issueDate: string;
  expiryDate: string;
  amount: string;
  currency: string;
  notes: string;
};

const empty: Form = {
  vendor: "",
  referenceNumber: "",
  issueDate: "",
  expiryDate: "",
  amount: "",
  currency: "AED",
  notes: "",
};

export default function CreateInvoiceModal() {
  const activeCurrencies = useActiveCurrencies();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<string[]>([]);
  const [vendorMode, setVendorMode] = useState<"select" | "free">("select");
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const router = useRouter();

  function set(key: keyof Form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
    setError(null);
  }

  async function openModal() {
    setOpen(true);
    setVendorsLoading(true);
    try {
      const res = await fetch("/api/invoices/vendors");
      const data = await res.json();
      const list: string[] = data.vendors ?? [];
      setVendors(list);
      setVendorMode(list.length === 0 ? "free" : "select");
    } catch {
      setVendorMode("free");
    } finally {
      setVendorsLoading(false);
    }
  }

  function close() {
    setOpen(false);
    setForm(empty);
    setError(null);
    setVendorMode("select");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.vendor.trim()) { setError("Vendor name is required"); return; }
    if (!form.issueDate) { setError("Invoice date is required"); return; }
    if (!form.expiryDate) { setError("Due date is required"); return; }

    setSaving(true);
    setError(null);

    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendor:          form.vendor.trim(),
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
      setError(data.error ?? "Failed to create invoice");
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
        onClick={openModal}
        className="flex items-center gap-1.5 bg-white border border-gray-200 hover:bg-surface-hover text-gray-700 text-xs font-medium px-3.5 py-2 rounded-lg transition-colors"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Create manually
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={close} />

          {/* Modal */}
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
              <h2 className="text-sm font-semibold text-gray-900">Create invoice</h2>
              <button onClick={close} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <form onSubmit={submit} className="px-6 py-5 space-y-4">

              {/* Vendor / Party */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Vendor / Party <span className="text-red-400">*</span>
                  </label>
                  {vendorMode === "free" && vendors.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setVendorMode("select"); set("vendor", ""); }}
                      className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-1"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M7 2l-4 3 4 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Pick from list
                    </button>
                  )}
                </div>

                {vendorsLoading ? (
                  <div className="w-full h-9 bg-surface-inset border border-surface-border rounded-lg flex items-center px-3 gap-2">
                    <svg className="animate-spin shrink-0" width="12" height="12" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="5" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="8 6" />
                    </svg>
                    <span className="text-sm text-gray-400">Loading vendors…</span>
                  </div>
                ) : vendorMode === "select" ? (
                  <select
                    value={form.vendor}
                    onChange={e => {
                      if (e.target.value === "__other__") {
                        setVendorMode("free");
                        set("vendor", "");
                      } else {
                        set("vendor", e.target.value);
                      }
                    }}
                    className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
                  >
                    <option value="">— Select vendor —</option>
                    {vendors.map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                    <option disabled>──────────────</option>
                    <option value="__other__">Other — type manually</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    value={form.vendor}
                    onChange={e => set("vendor", e.target.value)}
                    placeholder="e.g. Acme Supplies LLC"
                    autoFocus
                    className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400"
                  />
                )}
              </div>

              {/* Reference + Currency */}
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

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Invoice date <span className="text-red-400">*</span></label>
                  <input
                    required
                    type="date"
                    value={form.issueDate}
                    onChange={e => set("issueDate", e.target.value)}
                    className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Due date <span className="text-red-400">*</span></label>
                  <input
                    required
                    type="date"
                    value={form.expiryDate}
                    onChange={e => set("expiryDate", e.target.value)}
                    className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
                  />
                </div>
              </div>

              {/* Amount */}
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

              {/* Notes */}
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
                  {saving ? "Creating…" : "Create invoice"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
