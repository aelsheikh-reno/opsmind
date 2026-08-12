"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type TaxConfig = {
  id: string;
  country: string;
  taxType: string;
  currency: string;
  rate: number;
  frequencyMonths: number;
  filingDeadlineDays: number;
  anchorMonth: number;
  startDate: string;
  active: boolean;
  companyName?: string | null;
  taxId?: string | null;
  notes?: string | null;
  revenueBase: boolean;
  thresholdActive: boolean;
  profitThreshold?: number | null;
  periodsAhead: number;
};

const COUNTRY_CORPORATE_RATES: Record<string, number> = {
  "uae": 9, "united arab emirates": 9,
  "saudi arabia": 20, "ksa": 20, "saudi": 20,
  "egypt": 22.5,
  "uk": 25, "united kingdom": 25, "great britain": 25,
  "usa": 21, "united states": 21, "us": 21,
  "germany": 15,
  "france": 25,
  "netherlands": 25.8,
  "singapore": 17,
  "australia": 30,
  "india": 22,
  "south africa": 27,
  "nigeria": 30,
  "kenya": 30,
  "jordan": 20,
  "bahrain": 0,
  "oman": 15,
  "qatar": 10,
  "kuwait": 15,
};

const TAX_TYPE_LABELS: Record<string, string> = {
  corporate: "Corporate income tax",
  income: "Personal / employment income tax",
  withholding: "Withholding tax",
  other: "Other",
};

function getSuggestedRate(country: string, taxType: string): number | null {
  if (taxType !== "corporate") return null;
  return COUNTRY_CORPORATE_RATES[country.toLowerCase().trim()] ?? null;
}

const FREQ_LABELS: Record<number, string> = { 1: "Monthly", 3: "Quarterly", 6: "Semi-annual", 12: "Annual" };
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toInputDate(iso: string) { return iso.split("T")[0]; }

function fmtNum(n: number, currency: string) {
  if (n >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${currency} ${(n / 1_000).toFixed(0)}K`;
  return `${currency} ${n.toLocaleString("en-US")}`;
}

function Toggle({ on, onToggle, label, description }: { on: boolean; onToggle: () => void; label: string; description?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex gap-3 w-full text-left group"
    >
      <div
        className={`shrink-0 rounded-full transition-colors flex items-center px-0.5 mt-[1px] ${on ? "bg-indigo-600" : "bg-gray-200"}`}
        style={{ width: 32, height: 18 }}
      >
        <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${on ? "translate-x-3.5" : "translate-x-0"}`} />
      </div>
      <div>
        <p className={`text-[11px] font-medium leading-[18px] ${on ? "text-gray-800" : "text-gray-600"}`}>{label}</p>
        {description && <p className="text-[10px] text-gray-400 leading-relaxed mt-0.5">{description}</p>}
      </div>
    </button>
  );
}

const EMPTY_FORM = {
  country: "", taxType: "corporate", currency: "", rate: "",
  frequencyMonths: "12", filingDeadlineDays: "90",
  anchorMonth: "1", startDate: "",
  companyName: "", taxId: "", notes: "",
  profitThreshold: "", periodsAhead: "5",
};

export default function TaxConfigSection({ configs }: { configs: TaxConfig[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [revenueBase, setRevenueBase] = useState(false);
  const [thresholdActive, setThresholdActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState<{ type: "info" | "warn" | "error"; text: string } | null>(null);
  const [aiFields, setAiFields] = useState<Set<string>>(new Set());

  async function handleDocUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(true);
    setExtractMsg(null);
    setAiFields(new Set());

    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/tax/config-extract", { method: "POST", body: fd });
    const data = await res.json();

    if (!res.ok || !data.extracted) {
      setExtractMsg({ type: "error", text: data.error ?? "Could not extract fields from document" });
      setExtracting(false);
      return;
    }

    const ex = data.extracted;
    const filled = new Set<string>();
    const next = { ...EMPTY_FORM };

    if (ex.companyName)        { next.companyName = ex.companyName; filled.add("companyName"); }
    if (ex.taxId)              { next.taxId = ex.taxId; filled.add("taxId"); }
    if (ex.country)            { next.country = ex.country; filled.add("country"); }
    if (ex.currency)           { next.currency = ex.currency; filled.add("currency"); }
    if (ex.taxType)            { next.taxType = ex.taxType; filled.add("taxType"); }
    if (ex.rate != null)       { next.rate = String(ex.rate); filled.add("rate"); }
    if (ex.frequencyMonths)    { next.frequencyMonths = String(ex.frequencyMonths); filled.add("frequencyMonths"); }
    if (ex.filingDeadlineDays) { next.filingDeadlineDays = String(ex.filingDeadlineDays); filled.add("filingDeadlineDays"); }
    if (ex.anchorMonth)        { next.anchorMonth = String(ex.anchorMonth); filled.add("anchorMonth"); }
    if (ex.startDate)          { next.startDate = ex.startDate; filled.add("startDate"); }

    setForm(next);
    setAiFields(filled);
    setRevenueBase(false);
    setThresholdActive(false);
    setEditId(null);
    setShowForm(true);
    setExtractMsg({ type: "info", text: "Fields pre-filled from document. Review and confirm before saving." });
    setExtracting(false);
    e.target.value = "";
  }

  function openAdd() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setRevenueBase(false);
    setThresholdActive(false);
    setAiFields(new Set());
    setExtractMsg(null);
    setShowForm(true);
  }

  function openEdit(c: TaxConfig) {
    setAiFields(new Set());
    setExtractMsg(null);
    setEditId(c.id);
    setRevenueBase(c.revenueBase);
    setThresholdActive(c.thresholdActive);
    setForm({
      country: c.country,
      taxType: c.taxType,
      currency: c.currency,
      rate: String(c.rate * 100),
      frequencyMonths: String(c.frequencyMonths),
      filingDeadlineDays: String(c.filingDeadlineDays),
      anchorMonth: String(c.anchorMonth),
      startDate: toInputDate(c.startDate),
      companyName: c.companyName ?? "",
      taxId: c.taxId ?? "",
      notes: c.notes ?? "",
      profitThreshold: c.profitThreshold != null ? String(c.profitThreshold) : "",
      periodsAhead: String(c.periodsAhead ?? 5),
    });
    setShowForm(true);
  }

  async function save() {
    if (!form.country || !form.currency || !form.rate || !form.startDate) return;
    setSaving(true);
    const body = {
      country: form.country,
      taxType: form.taxType,
      currency: form.currency,
      rate: parseFloat(form.rate) / 100,
      frequencyMonths: parseInt(form.frequencyMonths),
      filingDeadlineDays: parseInt(form.filingDeadlineDays),
      anchorMonth: parseInt(form.anchorMonth),
      startDate: form.startDate,
      companyName: form.companyName || null,
      taxId: form.taxId || null,
      notes: form.notes || null,
      revenueBase,
      thresholdActive: revenueBase ? false : thresholdActive,
      profitThreshold: (!revenueBase && thresholdActive && form.profitThreshold)
        ? parseFloat(form.profitThreshold) : null,
      periodsAhead: parseInt(form.periodsAhead) || 5,
    };
    const res = await fetch(
      editId ? `/api/tax/configs/${editId}` : "/api/tax/configs",
      { method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    if (res.ok) {
      setShowForm(false);
      router.refresh();
    }
    setSaving(false);
  }

  async function remove(id: string) {
    setDeleting(id);
    await fetch(`/api/tax/configs/${id}`, { method: "DELETE" });
    router.refresh();
    setDeleting(null);
  }

  const clr = (k: string) => setAiFields(p => { const n = new Set(p); n.delete(k); return n; });
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));
  const fClr = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { clr(k); f(k)(e); };

  return (
    <div>
      <p className="text-xs text-gray-500 mb-4">
        Configure corporate tax, income tax, or other tax obligations per country. The system tracks filing deadlines and lets you record actual payments.
      </p>

      {configs.length > 0 && (
        <div className="space-y-2 mb-4">
          {configs.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-3 bg-surface-inset border border-surface-border rounded-lg">
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">{c.country}</p>
                    <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">
                      {TAX_TYPE_LABELS[c.taxType] ?? c.taxType}
                    </span>
                    {c.revenueBase && (
                      <span className="text-[10px] font-medium text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded-full">Revenue-based</span>
                    )}
                    {!c.revenueBase && c.thresholdActive && c.profitThreshold != null && (
                      <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">
                        Threshold {fmtNum(c.profitThreshold, c.currency)}
                      </span>
                    )}
                    {c.taxId && (
                      <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded font-mono">{c.taxId}</span>
                    )}
                  </div>
                  {c.companyName && <p className="text-[11px] text-gray-500">{c.companyName}</p>}
                  <p className="text-[11px] text-gray-400">
                    {c.currency} · {(c.rate * 100).toFixed(1)}%
                    {c.revenueBase ? " on revenue" : " on profit"}
                    {" · "}{FREQ_LABELS[c.frequencyMonths] ?? `Every ${c.frequencyMonths}mo`} · due {c.filingDeadlineDays}d after period
                  </p>
                </div>
                {!c.active && (
                  <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Inactive</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => openEdit(c)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded hover:bg-indigo-50 transition-colors">
                  Edit
                </button>
                <button
                  onClick={() => remove(c.id)}
                  disabled={deleting === c.id}
                  className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  {deleting === c.id ? "…" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {extractMsg && (
        <p className={`text-[11px] mb-3 ${extractMsg.type === "error" ? "text-red-500" : extractMsg.type === "warn" ? "text-amber-600" : "text-indigo-600"}`}>
          {extractMsg.text}
        </p>
      )}

      {!showForm ? (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={openAdd}
            className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium px-3 py-1.5 rounded-lg border border-indigo-200 hover:bg-indigo-50 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Add manually
          </button>
          <label className={`flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
            extracting ? "text-gray-400 border-gray-200 cursor-wait" : "text-gray-600 hover:text-gray-800 border-surface-border hover:bg-surface-hover"
          }`}>
            {extracting ? (
              <><svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10"/>
              </svg>Reading document…</>
            ) : (
              <><svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M6.5 1v7M4 4l2.5-3L9 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M1 9.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>Upload tax document</>
            )}
            <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={handleDocUpload} disabled={extracting} />
          </label>
          <span className="text-[10px] text-gray-400">Upload a tax registration or assessment document to auto-fill fields</span>
        </div>
      ) : (
        <div className="border border-surface-border rounded-xl p-4 bg-white space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">{editId ? "Edit tax obligation" : "New tax obligation"}</p>
            {aiFields.size > 0 && (
              <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                AI pre-filled · review before saving
              </span>
            )}
          </div>

          {/* Core fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Country / Jurisdiction
                {aiFields.has("country") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <input value={form.country} onChange={fClr("country")} placeholder="e.g. UAE, Egypt, UK"
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 ${aiFields.has("country") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Tax type
                {aiFields.has("taxType") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <select value={form.taxType} onChange={fClr("taxType")}
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 ${aiFields.has("taxType") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`}>
                <option value="corporate">Corporate income tax</option>
                <option value="income">Personal / employment income tax</option>
                <option value="withholding">Withholding tax</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Registered entity name
                {aiFields.has("companyName") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <input value={form.companyName} onChange={fClr("companyName")} placeholder="e.g. Reno Systems LLC"
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 ${aiFields.has("companyName") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Tax registration number
                {aiFields.has("taxId") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <input value={form.taxId} onChange={fClr("taxId")} placeholder="e.g. TIN / CRN"
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 ${aiFields.has("taxId") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Currency
                {aiFields.has("currency") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <input value={form.currency} onChange={fClr("currency")} placeholder="e.g. AED, EGP, USD"
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 ${aiFields.has("currency") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Tax rate (%)
                {aiFields.has("rate") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <input value={form.rate} onChange={fClr("rate")} type="number" min="0" max="100" step="0.1" placeholder="e.g. 9"
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 ${aiFields.has("rate") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`} />
              {(() => {
                const suggested = getSuggestedRate(form.country, form.taxType);
                if (suggested === null) return null;
                const entered = parseFloat(form.rate);
                if (!form.rate || isNaN(entered)) return (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px] text-indigo-500">Standard {form.country} corporate rate: {suggested}%</span>
                    <button type="button" onClick={() => setForm(p => ({ ...p, rate: String(suggested) }))}
                      className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 underline">Use</button>
                  </div>
                );
                if (Math.abs(entered - suggested) > 0.5) return (
                  <p className="text-[10px] text-amber-600 mt-1">
                    Standard {form.country} corporate rate is {suggested}% — confirm this is correct
                  </p>
                );
                return null;
              })()}
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Filing frequency
                {aiFields.has("frequencyMonths") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <select value={form.frequencyMonths} onChange={fClr("frequencyMonths")}
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 ${aiFields.has("frequencyMonths") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`}>
                <option value="1">Monthly</option>
                <option value="3">Quarterly</option>
                <option value="6">Semi-annual</option>
                <option value="12">Annual</option>
              </select>
              <p className="text-[10px] text-gray-400 mt-1">How often a tax return must be filed. Most corporate taxes are annual.</p>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Filing deadline (days after period end)
                {aiFields.has("filingDeadlineDays") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <input value={form.filingDeadlineDays} onChange={fClr("filingDeadlineDays")} type="number" min="1" placeholder="e.g. 90"
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 ${aiFields.has("filingDeadlineDays") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`} />
              <p className="text-[10px] text-gray-400 mt-1">
                Days you have to file after the period closes.{" "}
                {form.filingDeadlineDays && form.anchorMonth && form.frequencyMonths ? (() => {
                  const anchor = parseInt(form.anchorMonth);
                  const freq = parseInt(form.frequencyMonths);
                  const deadline = parseInt(form.filingDeadlineDays);
                  const periodEndMonth = ((anchor - 1 + freq - 1) % 12) + 1;
                  const deadlineDate = new Date(2000, periodEndMonth - 1 + Math.floor(deadline / 30), deadline % 30 || 30);
                  const periodEndName = MONTH_NAMES[periodEndMonth - 1];
                  const dueMonth = MONTH_NAMES[((periodEndMonth - 1 + Math.floor(deadline / 28)) % 12)];
                  return `e.g. period ends ${periodEndName} → return due ~${dueMonth}.`;
                })() : "e.g. 90 days = return due ~3 months after year-end."}
              </p>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Fiscal year start month
                {aiFields.has("anchorMonth") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <select value={form.anchorMonth} onChange={fClr("anchorMonth")}
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 ${aiFields.has("anchorMonth") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`}>
                {MONTH_NAMES.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
              <p className="text-[10px] text-gray-400 mt-1">
                {(() => {
                  const anchor = parseInt(form.anchorMonth || "1");
                  const freq = parseInt(form.frequencyMonths || "12");
                  const endMonth = ((anchor - 1 + freq - 1) % 12) + 1;
                  return `Each period runs ${MONTH_NAMES[anchor - 1]}–${MONTH_NAMES[endMonth - 1]}. Most companies use Jan (calendar year).`;
                })()}
              </p>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Obligation start date
                {aiFields.has("startDate") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <input value={form.startDate} onChange={fClr("startDate")} type="date"
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 ${aiFields.has("startDate") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`} />
              <p className="text-[10px] text-gray-400 mt-1">When this tax obligation first applied to your company. Periods are generated forward from this date.</p>
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Notes (optional)</label>
              <input value={form.notes} onChange={f("notes")} placeholder="e.g. Advance payment applies in Q1"
                className="w-full h-9 px-3 text-sm border border-surface-border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Periods to show ahead</label>
              <input value={form.periodsAhead} onChange={f("periodsAhead")} type="number" min="1" max="20"
                className="w-full h-9 px-3 text-sm border border-surface-border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50" />
              <p className="text-[10px] text-gray-400 mt-1">How many future periods to display on the Taxes page (e.g. 5 = next 5 years for annual filing).</p>
            </div>
          </div>

          {/* Calculation basis section */}
          <div className="border-t border-surface-border pt-4 space-y-3">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest">Calculation basis</p>

            {/* Revenue-based toggle */}
            <Toggle
              on={revenueBase}
              onToggle={() => { setRevenueBase(v => !v); if (!revenueBase) setThresholdActive(false); }}
              label="Revenue-based (simplified program)"
              description="Tax applies to total invoiced revenue — not profit. Used for special small-company programs (e.g. Egypt simplified tax). The system will estimate using your invoices."
            />

            {/* Profit threshold — only when NOT revenue-based */}
            {!revenueBase && (
              <div className="pl-11 space-y-2">
                <Toggle
                  on={thresholdActive}
                  onToggle={() => setThresholdActive(v => !v)}
                  label="Profit threshold applies"
                  description="Tax is only owed when annual profit exceeds this amount — below it the period is tax-free (e.g. UAE AED 375,000 exemption)."
                />
                {thresholdActive && (
                  <div className="pt-1">
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">
                      Tax-free profit threshold ({form.currency || "—"})
                    </label>
                    <input
                      value={form.profitThreshold}
                      onChange={f("profitThreshold")}
                      type="number" min="0" step="1000"
                      placeholder={form.currency === "AED" ? "375000" : "e.g. 500000"}
                      className="w-full h-9 px-3 text-sm border border-surface-border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
                    />
                    {form.country.toLowerCase().includes("uae") && !form.profitThreshold && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[10px] text-indigo-500">UAE standard exemption: AED 375,000</span>
                        <button type="button" onClick={() => setForm(p => ({ ...p, profitThreshold: "375000" }))}
                          className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 underline">Use</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving || !form.country || !form.currency || !form.rate || !form.startDate}
              className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : editId ? "Save changes" : "Add obligation"}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-surface-hover transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
