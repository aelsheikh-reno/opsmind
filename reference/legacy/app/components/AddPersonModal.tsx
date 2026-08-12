"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { useActiveCurrencies } from "@/lib/useActiveCurrencies";

type Props = {
  hidden?: boolean;
  // Controlled mode: caller manages open state and supplies a prefilled name
  controlledOpen?: boolean;
  prefillName?: string;
  onClose?: () => void;
  onCreated?: (personId: string) => void;
};

export default function AddPersonModal({ hidden, controlledOpen, prefillName, onClose, onCreated }: Props) {
  if (hidden) return null;
  const router = useRouter();
  const activeCurrencies = useActiveCurrencies();
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: prefillName ?? "",
    email: "",
    jobTitle: "",
    department: "",
    nationality: "",
    contractStart: "",
    contractEnd: "",
    salary: "",
    salaryCurrency: "AED",
    employmentType: "fulltime" as "fulltime" | "parttime",
    weeklyHours: "40",
  });

  // Sync prefillName into form whenever the controlled modal opens
  useEffect(() => {
    if (isControlled && controlledOpen) {
      setForm(f => ({ ...f, name: prefillName ?? "", email: "", jobTitle: "", department: "", nationality: "", contractStart: "", contractEnd: "", salary: "", salaryCurrency: "AED", employmentType: "fulltime", weeklyHours: "40" }));
      setError(null);
    }
  }, [isControlled, controlledOpen, prefillName]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(field: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function reset() {
    setForm({ name: isControlled ? "" : (prefillName ?? ""), email: "", jobTitle: "", department: "", nationality: "", contractStart: "", contractEnd: "", salary: "", salaryCurrency: "AED", employmentType: "fulltime", weeklyHours: "40" });
    setError(null);
  }

  function close() {
    reset();
    if (isControlled) onClose?.();
    else setInternalOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required."); return; }
    if (!form.email.trim()) { setError("Email is required."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setError("Enter a valid email address."); return; }
    setSaving(true);
    setError(null);

    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to add employee.");
      setSaving(false);
      return;
    }

    setSaving(false);
    if (onCreated) onCreated(data.id);
    else router.refresh();
    close();
  }

  return (
    <>
      {!isControlled && (
        <button
          onClick={() => setInternalOpen(true)}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          Add employee
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={close} />

          {/* Panel */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Add employee</h2>
                <p className="text-xs text-gray-400 mt-0.5">Manually add an employee without uploading a contract</p>
              </div>
              <button onClick={close} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Name */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Full name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => set("name", e.target.value)}
                  placeholder="e.g. Mohamed Al Sheikh"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder:text-gray-300"
                  autoFocus
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => set("email", e.target.value)}
                  placeholder="e.g. name@company.com"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder:text-gray-300"
                />
              </div>

              {/* Job title + Department */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Job title</label>
                  <input
                    type="text"
                    value={form.jobTitle}
                    onChange={e => set("jobTitle", e.target.value)}
                    placeholder="e.g. Operations Manager"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder:text-gray-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Department</label>
                  <input
                    type="text"
                    value={form.department}
                    onChange={e => set("department", e.target.value)}
                    placeholder="e.g. Finance"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder:text-gray-300"
                  />
                </div>
              </div>

              {/* Nationality */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Nationality</label>
                <input
                  type="text"
                  value={form.nationality}
                  onChange={e => set("nationality", e.target.value)}
                  placeholder="e.g. Egyptian"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder:text-gray-300"
                />
              </div>

              {/* Contract dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Contract start</label>
                  <input
                    type="date"
                    value={form.contractStart}
                    onChange={e => set("contractStart", e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Contract end</label>
                  <input
                    type="date"
                    value={form.contractEnd}
                    onChange={e => set("contractEnd", e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>

              {/* Salary */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Monthly salary</label>
                <div className="flex gap-2">
                  <select
                    value={form.salaryCurrency}
                    onChange={e => set("salaryCurrency", e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  >
                    {activeCurrencies.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <input
                    type="number"
                    value={form.salary}
                    onChange={e => set("salary", e.target.value)}
                    placeholder="0"
                    min="0"
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder:text-gray-300"
                  />
                </div>
              </div>

              {/* Employment type */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Employment type
                </label>
                <div className="flex gap-2">
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
                  <div className="mt-2">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Weekly committed hours
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="39"
                      value={form.weeklyHours}
                      onChange={(e) => set("weeklyHours", e.target.value)}
                      placeholder="e.g. 20"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder:text-gray-300"
                    />
                    {form.weeklyHours && !isNaN(Number(form.weeklyHours)) && (
                      <p className="text-[11px] text-gray-400 mt-1">
                        ≈ {Math.round(Number(form.weeklyHours) * 52 / 12)} hrs/month committed
                      </p>
                    )}
                  </div>
                )}
              </div>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}
            </form>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-surface-border bg-surface-inset">
              <button
                type="button"
                onClick={close}
                className="text-sm font-medium text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || !form.name.trim() || !form.email.trim()}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {saving ? (
                  <>
                    <svg className="animate-spin" width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="5" stroke="white" strokeWidth="1.5" strokeDasharray="8 6" />
                    </svg>
                    Saving…
                  </>
                ) : "Add employee"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
