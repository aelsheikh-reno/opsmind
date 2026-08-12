"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";

type Props = {
  person: {
    id: string;
    name: string;
    jobTitle: string | null;
    department: string | null;
    nationality: string | null;
    email: string | null;
    contractStart: string | null;
    contractEnd: string | null;
    salary: number | null;
    salaryCurrency: string | null;
    costPerHour: number | null;
    billingRate: number | null;
    rateCurrency: string | null;
    employmentType: string | null;
    weeklyHours: number | null;
  };
  hidden?: boolean;
};

export default function EditPersonModal({ person, hidden }: Props) {
  if (hidden) return null;
  const activeCurrencies = useActiveCurrencies();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: person.name,
    jobTitle: person.jobTitle ?? "",
    department: person.department ?? "",
    nationality: person.nationality ?? "",
    email: person.email ?? "",
    contractStart: person.contractStart ?? "",
    contractEnd: person.contractEnd ?? "",
    costPerHour: person.costPerHour?.toString() ?? "",
    billingRate: person.billingRate?.toString() ?? "",
    rateCurrency: person.rateCurrency ?? "AED",
    employmentType: (person.employmentType ?? "fulltime") as "fulltime" | "parttime",
    weeklyHours: (person.weeklyHours ?? 40).toString(),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function set(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          jobTitle: form.jobTitle.trim() || null,
          department: form.department.trim() || null,
          nationality: form.nationality.trim() || null,
          email: form.email.trim() || null,
          contractStart: form.contractStart || null,
          contractEnd: form.contractEnd || null,
          costPerHour: form.costPerHour !== "" ? form.costPerHour : null,
          billingRate: form.billingRate !== "" ? form.billingRate : null,
          rateCurrency: form.rateCurrency.trim() || null,
          employmentType: form.employmentType,
          weeklyHours: form.weeklyHours !== "" ? form.weeklyHours : null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Failed to save");
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  function handleOpen() {
    setForm({
      name: person.name,
      jobTitle: person.jobTitle ?? "",
      department: person.department ?? "",
      nationality: person.nationality ?? "",
      email: person.email ?? "",
      contractStart: person.contractStart ?? "",
      contractEnd: person.contractEnd ?? "",
      costPerHour: person.costPerHour?.toString() ?? "",
      billingRate: person.billingRate?.toString() ?? "",
      rateCurrency: person.rateCurrency ?? "AED",
      employmentType: (person.employmentType ?? "fulltime") as "fulltime" | "parttime",
      weeklyHours: (person.weeklyHours ?? 40).toString(),
    });
    setError(null);
    setOpen(true);
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 bg-white border border-surface-border hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M8.5 1.5a1.414 1.414 0 0 1 2 2L3.5 10.5l-3 .5.5-3 7.5-6.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Edit
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => !saving && setOpen(false)}
          />

          {/* Panel */}
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border shrink-0">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Edit person details</h2>
                <p className="text-xs text-gray-400 mt-0.5">{person.name}</p>
              </div>
              <button
                onClick={() => !saving && setOpen(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto px-6 py-5 space-y-5">

              {/* Basic info */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Basic info</p>
                <div className="space-y-3">
                  <Field label="Full name *">
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                      placeholder="Full name"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Job title">
                      <input
                        type="text"
                        value={form.jobTitle}
                        onChange={(e) => set("jobTitle", e.target.value)}
                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                        placeholder="e.g. Senior Engineer"
                      />
                    </Field>
                    <Field label="Department">
                      <input
                        type="text"
                        value={form.department}
                        onChange={(e) => set("department", e.target.value)}
                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                        placeholder="e.g. Engineering"
                      />
                    </Field>
                  </div>
                  <Field label="Nationality">
                    <input
                      type="text"
                      value={form.nationality}
                      onChange={(e) => set("nationality", e.target.value)}
                      className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                      placeholder="e.g. Egyptian"
                    />
                  </Field>
                  <Field label="Email (for expense claims)">
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                      placeholder="person@company.com"
                    />
                  </Field>
                </div>
              </div>

              {/* Employment type */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Employment type</p>
                <div className="flex gap-2 mb-3">
                  {(["fulltime", "parttime"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        set("employmentType", type);
                        if (type === "fulltime") set("weeklyHours", "40");
                      }}
                      className={`flex-1 text-sm font-medium py-2 rounded-lg border transition-colors ${
                        form.employmentType === type
                          ? type === "fulltime"
                            ? "bg-indigo-600 border-indigo-600 text-white"
                            : "bg-amber-500 border-amber-500 text-white"
                          : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                      }`}
                    >
                      {type === "fulltime" ? "Full-time" : "Part-time"}
                    </button>
                  ))}
                </div>
                {form.employmentType === "parttime" && (
                  <Field label="Weekly committed hours">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="39"
                        value={form.weeklyHours}
                        onChange={(e) => set("weeklyHours", e.target.value)}
                        placeholder="e.g. 20"
                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                      />
                      <span className="text-xs text-gray-400 shrink-0">hrs / week</span>
                    </div>
                    {form.weeklyHours && !isNaN(Number(form.weeklyHours)) && (
                      <p className="text-[11px] text-gray-400 mt-1">
                        ≈ {Math.round(Number(form.weeklyHours) * 52 / 12)} hrs/month committed
                      </p>
                    )}
                  </Field>
                )}
              </div>

              {/* Contract period */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Contract period</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Start date">
                    <input
                      type="date"
                      value={form.contractStart}
                      onChange={(e) => set("contractStart", e.target.value)}
                      className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                    />
                  </Field>
                  <Field label="End date">
                    <input
                      type="date"
                      value={form.contractEnd}
                      onChange={(e) => set("contractEnd", e.target.value)}
                      className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                    />
                  </Field>
                </div>
              </div>

              {/* Labor rates */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Labor rates</p>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Currency">
                    <select
                      value={form.rateCurrency}
                      onChange={(e) => set("rateCurrency", e.target.value)}
                      className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 bg-white"
                    >
                      {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="Cost per hour">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={form.costPerHour}
                      onChange={(e) => set("costPerHour", e.target.value)}
                      className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                      placeholder="e.g. 150"
                    />
                  </Field>
                  <Field label="Billable rate / hr">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={form.billingRate}
                      onChange={(e) => set("billingRate", e.target.value)}
                      className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                      placeholder="e.g. 250"
                    />
                  </Field>
                </div>
                {form.costPerHour !== "" && form.billingRate !== "" && (() => {
                  const cost = parseFloat(form.costPerHour);
                  const bill = parseFloat(form.billingRate);
                  if (!isNaN(cost) && !isNaN(bill) && bill > 0) {
                    const margin = ((bill - cost) / bill * 100).toFixed(0);
                    return <p className="text-[10px] text-gray-400 mt-1.5">Margin: <span className="font-semibold text-indigo-600">{margin}%</span></p>;
                  }
                  return null;
                })()}
              </div>

              {error && (
                <div className="px-3 py-2.5 bg-red-50 border border-red-100 rounded-lg">
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-surface-border bg-surface-inset shrink-0">
              <button
                onClick={() => !saving && setOpen(false)}
                disabled={saving}
                className="text-sm font-medium text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2 rounded-lg transition-colors flex items-center gap-2"
              >
                {saving && (
                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" />
                    <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                )}
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
