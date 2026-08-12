"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";
import VendorCombobox from "@/app/components/VendorCombobox";

type POData = {
  clientName: string;
  contractValue: number | null;
  currency: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  referenceNumber: string | null;
};

const BILLING_TYPES = [
  { value: "milestone", label: "Milestone-based",       icon: "🏁" },
  { value: "tm",        label: "Time & Material",       icon: "⏱" },
  { value: "ps",        label: "Professional Services", icon: "🔧" },
] as const;

export default function CreateProjectFromPOButton({ po }: { po: POData }) {
  const router = useRouter();
  const activeCurrencies = useActiveCurrencies();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vendors, setVendors] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/invoices/vendors")
      .then(r => r.ok ? r.json() : { vendors: [] })
      .then(d => setVendors(d.vendors ?? []))
      .catch(() => {});
  }, []);
  const [form, setForm] = useState({
    name: po.referenceNumber ? `${po.clientName} — ${po.referenceNumber}` : po.clientName,
    clientName: po.clientName,
    description: po.description ?? "",
    billingType: "milestone" as "milestone" | "tm" | "ps",
    contractValue: po.contractValue != null ? String(po.contractValue) : "",
    currency: po.currency ?? "AED",
    startDate: po.startDate ?? "",
    endDate: po.endDate ?? "",
  });

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        clientName: form.clientName.trim() || null,
        description: form.description.trim() || null,
        billingType: form.billingType,
        contractValue: form.contractValue ? parseFloat(form.contractValue) : null,
        currency: form.currency,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        status: "active",
      }),
    });
    if (res.ok) {
      const project = await res.json();
      router.push(`/projects/${project.id}`);
    } else {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        Create project
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">Create project from PO</h2>
              <p className="text-xs text-gray-400 mt-0.5">Fields pre-filled from the purchase order.</p>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Project name <span className="text-red-400">*</span></label>
                <input
                  required
                  value={form.name}
                  onChange={set("name")}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300"
                  placeholder="Project name"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
                <VendorCombobox
                  value={form.clientName}
                  onChange={v => setForm(f => ({ ...f, clientName: v }))}
                  vendors={vendors}
                  placeholder="Search or add client…"
                  inputClassName="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={set("description")}
                  rows={2}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300 resize-none"
                  placeholder="Optional description"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Billing type</label>
                <div className="grid grid-cols-3 gap-2">
                  {BILLING_TYPES.map(bt => (
                    <button
                      key={bt.value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, billingType: bt.value }))}
                      className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-center transition-all ${
                        form.billingType === bt.value
                          ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                          : "border-gray-200 text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      <span className="text-base">{bt.icon}</span>
                      <span className="text-[10px] font-semibold leading-tight">{bt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Contract value</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.contractValue}
                    onChange={set("contractValue")}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
                  <select
                    value={form.currency}
                    onChange={set("currency")}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300 bg-white"
                  >
                    {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start date</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={set("startDate")}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End date</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={set("endDate")}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300"
                  />
                </div>
              </div>
            </form>

            <div className="px-6 pb-6 pt-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || !form.name.trim()}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-60"
              >
                {saving ? "Creating…" : "Create project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
