"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type VatConfig = {
  id: string;
  country: string;
  currency: string;
  rate: number;
  frequencyMonths: number;
  filingDeadlineDays: number;
  anchorMonth: number;
  startDate: string;
  active: boolean;
  companyName?: string | null;
  taxId?: string | null;
  periodsAhead: number;
};

const COUNTRY_VAT_RATES: Record<string, number> = {
  "uae": 5, "united arab emirates": 5,
  "saudi arabia": 15, "ksa": 15, "saudi": 15,
  "egypt": 14,
  "uk": 20, "united kingdom": 20, "great britain": 20,
  "germany": 19,
  "france": 20,
  "italy": 22,
  "spain": 21,
  "netherlands": 21,
  "bahrain": 10,
  "oman": 5,
  "jordan": 16,
  "kenya": 16,
  "nigeria": 7.5,
  "south africa": 15,
  "australia": 10,
  "india": 18,
  "singapore": 9,
};

function getSuggestedRate(country: string): number | null {
  return COUNTRY_VAT_RATES[country.toLowerCase().trim()] ?? null;
}

const FREQ_LABELS: Record<number, string> = { 1: "Monthly", 3: "Quarterly", 6: "Semi-annual", 12: "Annual" };
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toInputDate(iso: string) {
  return iso.split("T")[0];
}

const EMPTY_FORM = {
  country: "", currency: "", rate: "", frequencyMonths: "3",
  filingDeadlineDays: "28", anchorMonth: "1", startDate: "",
  companyName: "", taxId: "", periodsAhead: "5",
};

export default function VatConfigSection({ configs }: { configs: VatConfig[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
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
    const res = await fetch("/api/vat/config-extract", { method: "POST", body: fd });
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
    if (ex.rate != null)       { next.rate = String(ex.rate); filled.add("rate"); }
    if (ex.frequencyMonths)    { next.frequencyMonths = String(ex.frequencyMonths); filled.add("frequencyMonths"); }
    if (ex.filingDeadlineDays) { next.filingDeadlineDays = String(ex.filingDeadlineDays); filled.add("filingDeadlineDays"); }
    if (ex.anchorMonth)        { next.anchorMonth = String(ex.anchorMonth); filled.add("anchorMonth"); }
    if (ex.startDate)          { next.startDate = ex.startDate; filled.add("startDate"); }

    setForm(next);
    setAiFields(filled);
    setEditId(null);
    setShowForm(true);
    setExtractMsg({ type: "info", text: `Fields pre-filled from document${ex.referenceNumber ? ` · Ref: ${ex.referenceNumber}` : ""}. Review and confirm.` });
    setExtracting(false);
    // reset input
    e.target.value = "";
  }

  function openAdd() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setAiFields(new Set());
    setExtractMsg(null);
    setShowForm(true);
  }

  function openEdit(c: VatConfig) {
    setAiFields(new Set());
    setExtractMsg(null);
    setEditId(c.id);
    setForm({
      country: c.country,
      currency: c.currency,
      rate: String(c.rate * 100),
      frequencyMonths: String(c.frequencyMonths),
      filingDeadlineDays: String(c.filingDeadlineDays),
      anchorMonth: String(c.anchorMonth),
      startDate: toInputDate(c.startDate),
      companyName: c.companyName ?? "",
      taxId: c.taxId ?? "",
      periodsAhead: String(c.periodsAhead ?? 5),
    });
    setShowForm(true);
  }

  async function save() {
    if (!form.country || !form.currency || !form.rate || !form.startDate) return;
    setSaving(true);
    const body = {
      country: form.country,
      currency: form.currency,
      rate: parseFloat(form.rate) / 100,
      frequencyMonths: parseInt(form.frequencyMonths),
      filingDeadlineDays: parseInt(form.filingDeadlineDays),
      anchorMonth: parseInt(form.anchorMonth),
      startDate: form.startDate,
      companyName: form.companyName || null,
      taxId: form.taxId || null,
      periodsAhead: parseInt(form.periodsAhead) || 5,
    };
    const res = await fetch(
      editId ? `/api/vat/configs/${editId}` : "/api/vat/configs",
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
    await fetch(`/api/vat/configs/${id}`, { method: "DELETE" });
    router.refresh();
    setDeleting(null);
  }

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <div>
      <p className="text-xs text-gray-500 mb-4">
        Configure VAT obligations per country. The system will calculate estimated VAT from invoices for each filing period.
      </p>

      {configs.length > 0 && (
        <div className="space-y-2 mb-4">
          {configs.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-3 bg-surface-inset border border-surface-border rounded-lg">
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">{c.country}</p>
                    {c.taxId && (
                      <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded font-mono">{c.taxId}</span>
                    )}
                  </div>
                  {c.companyName && (
                    <p className="text-[11px] text-gray-500">{c.companyName}</p>
                  )}
                  <p className="text-[11px] text-gray-400">
                    {c.currency} · {(c.rate * 100).toFixed(0)}% VAT · {FREQ_LABELS[c.frequencyMonths] ?? `Every ${c.frequencyMonths}mo`} · due {c.filingDeadlineDays}d after period · starts {MONTH_NAMES[c.anchorMonth - 1]}
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
              </svg>Upload VAT document</>
            )}
            <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={handleDocUpload} disabled={extracting} />
          </label>
          <span className="text-[10px] text-gray-400">Upload a VAT certificate or registration document to auto-fill fields</span>
        </div>
      ) : (
        <div className="border border-surface-border rounded-xl p-4 bg-white space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">{editId ? "Edit obligation" : "New VAT obligation"}</p>
            {aiFields.size > 0 && (
              <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                AI pre-filled · review before saving
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Registered entity name
                {aiFields.has("companyName") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <input value={form.companyName} onChange={(e) => { setAiFields(p => { const n = new Set(p); n.delete("companyName"); return n; }); f("companyName")(e); }} placeholder="e.g. Reno Systems LLC"
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 ${aiFields.has("companyName") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Tax registration number
                {aiFields.has("taxId") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <input value={form.taxId} onChange={(e) => { setAiFields(p => { const n = new Set(p); n.delete("taxId"); return n; }); f("taxId")(e); }} placeholder="e.g. TRN 100123456"
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 ${aiFields.has("taxId") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Country / Entity
                {aiFields.has("country") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <input value={form.country} onChange={(e) => { setAiFields(p => { const n = new Set(p); n.delete("country"); return n; }); f("country")(e); }} placeholder="e.g. UAE, Egypt"
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 ${aiFields.has("country") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Invoice currency
                {aiFields.has("currency") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <input value={form.currency} onChange={(e) => { setAiFields(p => { const n = new Set(p); n.delete("currency"); return n; }); f("currency")(e); }} placeholder="e.g. AED, EGP"
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 ${aiFields.has("currency") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                VAT rate (%)
                {aiFields.has("rate") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <input value={form.rate} onChange={(e) => { setAiFields(p => { const n = new Set(p); n.delete("rate"); return n; }); f("rate")(e); }} type="number" min="0" max="100" step="0.1" placeholder="e.g. 5"
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 ${aiFields.has("rate") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`} />
              {(() => {
                const suggested = getSuggestedRate(form.country);
                if (!suggested) return null;
                const entered = parseFloat(form.rate);
                if (!form.rate || isNaN(entered)) {
                  return (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[10px] text-indigo-500">Standard {form.country} rate: {suggested}%</span>
                      <button type="button" onClick={() => setForm(p => ({ ...p, rate: String(suggested) }))}
                        className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 underline">Use</button>
                    </div>
                  );
                }
                if (Math.abs(entered - suggested) > 0.1) {
                  return (
                    <p className="text-[10px] text-amber-600 mt-1">
                      Standard {form.country} rate is {suggested}% — confirm this is correct
                    </p>
                  );
                }
                return null;
              })()}
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Filing frequency
                {aiFields.has("frequencyMonths") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <select value={form.frequencyMonths} onChange={(e) => { setAiFields(p => { const n = new Set(p); n.delete("frequencyMonths"); return n; }); f("frequencyMonths")(e); }}
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 ${aiFields.has("frequencyMonths") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`}>
                <option value="1">Monthly</option>
                <option value="3">Quarterly</option>
                <option value="6">Semi-annual</option>
                <option value="12">Annual</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Filing deadline (days after period)
                {aiFields.has("filingDeadlineDays") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <input value={form.filingDeadlineDays} onChange={(e) => { setAiFields(p => { const n = new Set(p); n.delete("filingDeadlineDays"); return n; }); f("filingDeadlineDays")(e); }} type="number" min="1" placeholder="28"
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 ${aiFields.has("filingDeadlineDays") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Period start anchor month
                {aiFields.has("anchorMonth") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <select value={form.anchorMonth} onChange={(e) => { setAiFields(p => { const n = new Set(p); n.delete("anchorMonth"); return n; }); f("anchorMonth")(e); }}
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 ${aiFields.has("anchorMonth") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`}>
                {MONTH_NAMES.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1">
                Obligation start date
                {aiFields.has("startDate") && <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 px-1 rounded">AI</span>}
              </label>
              <input value={form.startDate} onChange={(e) => { setAiFields(p => { const n = new Set(p); n.delete("startDate"); return n; }); f("startDate")(e); }} type="date"
                className={`w-full h-9 px-3 text-sm border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 ${aiFields.has("startDate") ? "border-indigo-300 bg-indigo-50/30" : "border-surface-border"}`} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Periods to show ahead</label>
              <input value={form.periodsAhead} onChange={f("periodsAhead")} type="number" min="1" max="20"
                className="w-full h-9 px-3 text-sm border border-surface-border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50" />
              <p className="text-[10px] text-gray-400 mt-1">How many future periods to display on the VAT page (e.g. 5 = next 5 quarters for quarterly filing).</p>
            </div>
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
