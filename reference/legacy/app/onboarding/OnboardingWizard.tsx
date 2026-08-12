"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// ── Constants ─────────────────────────────────────────────────────────────────

const CURRENCIES = [
  { code: "AED", name: "UAE Dirham",       flag: "🇦🇪" },
  { code: "EGP", name: "Egyptian Pound",   flag: "🇪🇬" },
  { code: "EUR", name: "Euro",             flag: "🇪🇺" },
  { code: "GBP", name: "British Pound",    flag: "🇬🇧" },
  { code: "SAR", name: "Saudi Riyal",      flag: "🇸🇦" },
  { code: "QAR", name: "Qatari Riyal",     flag: "🇶🇦" },
  { code: "KWD", name: "Kuwaiti Dinar",    flag: "🇰🇼" },
  { code: "INR", name: "Indian Rupee",     flag: "🇮🇳" },
  { code: "PKR", name: "Pakistani Rupee",  flag: "🇵🇰" },
  { code: "CHF", name: "Swiss Franc",      flag: "🇨🇭" },
  { code: "JPY", name: "Japanese Yen",     flag: "🇯🇵" },
  { code: "TRY", name: "Turkish Lira",     flag: "🇹🇷" },
];

const FREQ_OPTIONS = [
  { months: "1",  label: "Monthly"     },
  { months: "3",  label: "Quarterly"   },
  { months: "6",  label: "Semi-annual" },
  { months: "12", label: "Annual"      },
];

const TAX_TYPES = [
  { value: "corporate",   label: "Corporate"   },
  { value: "income",      label: "Income"      },
  { value: "withholding", label: "Withholding" },
  { value: "other",       label: "Other"       },
];

const STEPS = ["Organisation", "Currencies", "Payroll", "Taxes & VAT", "Templates"];

// ── Types ─────────────────────────────────────────────────────────────────────

type ObligationDraft = {
  id: string;
  obligationType: "vat" | "tax";
  taxType: string;
  country: string;
  currency: string;
  rate: string;
  frequencyMonths: string;
  filingDeadlineDays: string;
  startDate: string;
  companyName: string;
  taxId: string;
};

function emptyDraft(): ObligationDraft {
  return {
    id: Math.random().toString(36).slice(2),
    obligationType: "vat",
    taxType: "corporate",
    country: "",
    currency: "USD",
    rate: "",
    frequencyMonths: "3",
    filingDeadlineDays: "30",
    startDate: new Date().toISOString().split("T")[0],
    companyName: "",
    taxId: "",
  };
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="flex items-center mb-8">
      {STEPS.map((label, i) => {
        const idx = i + 1;
        const done   = idx < step;
        const active = idx === step;
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex items-center gap-1.5 shrink-0">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                done   ? "bg-indigo-600 text-white" :
                active ? "bg-indigo-600 text-white ring-4 ring-indigo-100" :
                         "bg-gray-100 text-gray-400"
              }`}>
                {done ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2.5 2.5 3.5-3.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : idx}
              </div>
              <span className={`text-[11px] font-medium ${active ? "text-gray-800" : done ? "text-gray-500" : "text-gray-400"}`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-2 transition-colors ${done ? "bg-indigo-400" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 4: Obligation form ────────────────────────────────────────────────────

function ObligationForm({
  draft,
  onChange,
  onAdd,
  onCancel,
  activeCurrencies,
}: {
  draft: ObligationDraft;
  onChange: (d: ObligationDraft) => void;
  onAdd: () => void;
  onCancel: () => void;
  activeCurrencies: string[];
}) {
  const set = (k: keyof ObligationDraft, v: string) => onChange({ ...draft, [k]: v });
  const allCurrencies = ["USD", ...activeCurrencies.filter((c) => c !== "USD")];
  const isValid = draft.country.trim() && draft.rate && draft.currency;

  return (
    <div className="border border-indigo-200 rounded-xl p-4 bg-indigo-50/30 space-y-3">
      {/* Type toggle */}
      <div className="flex gap-2">
        {(["vat", "tax"] as const).map((t) => (
          <button
            key={t}
            onClick={() => set("obligationType", t)}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              draft.obligationType === t
                ? "bg-indigo-600 text-white"
                : "bg-white border border-surface-border text-gray-500 hover:border-gray-300"
            }`}
          >
            {t === "vat" ? "VAT" : "Tax"}
          </button>
        ))}
      </div>

      {/* Tax sub-type */}
      {draft.obligationType === "tax" && (
        <div className="flex flex-wrap gap-1.5">
          {TAX_TYPES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => set("taxType", value)}
              className={`px-3 py-1 text-[11px] font-semibold rounded-full transition-colors ${
                draft.taxType === value
                  ? "bg-indigo-600 text-white"
                  : "bg-white border border-surface-border text-gray-500 hover:border-gray-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Country + Currency */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Country</label>
          <input
            autoFocus
            type="text"
            placeholder="e.g. UAE"
            value={draft.country}
            onChange={(e) => set("country", e.target.value)}
            className="w-full h-9 px-3 text-sm border border-surface-border rounded-lg bg-white focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Currency</label>
          <select
            value={draft.currency}
            onChange={(e) => set("currency", e.target.value)}
            className="w-full h-9 px-3 text-sm border border-surface-border rounded-lg bg-white focus:outline-none focus:border-indigo-400"
          >
            {allCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Rate + Frequency */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Rate %</label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            placeholder="e.g. 5"
            value={draft.rate}
            onChange={(e) => set("rate", e.target.value)}
            className="w-full h-9 px-3 text-sm border border-surface-border rounded-lg bg-white focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 tabular-nums"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Filing deadline</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={180}
              value={draft.filingDeadlineDays}
              onChange={(e) => set("filingDeadlineDays", e.target.value)}
              className="w-full h-9 px-3 text-sm border border-surface-border rounded-lg bg-white focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 tabular-nums"
            />
            <span className="text-xs text-gray-400 shrink-0">days</span>
          </div>
        </div>
      </div>

      {/* Frequency */}
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Frequency</label>
        <div className="flex gap-1.5">
          {FREQ_OPTIONS.map(({ months, label }) => (
            <button
              key={months}
              onClick={() => set("frequencyMonths", months)}
              className={`flex-1 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${
                draft.frequencyMonths === months
                  ? "bg-indigo-600 text-white"
                  : "bg-white border border-surface-border text-gray-500 hover:border-gray-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Start date */}
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Start date</label>
        <input
          type="date"
          value={draft.startDate}
          onChange={(e) => set("startDate", e.target.value)}
          className="w-full h-9 px-3 text-sm border border-surface-border rounded-lg bg-white focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50"
        />
      </div>

      {/* Company name + Tax ID (optional) */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
            Company name <span className="text-gray-300 font-normal normal-case">(optional)</span>
          </label>
          <input
            type="text"
            placeholder="Registered entity"
            value={draft.companyName}
            onChange={(e) => set("companyName", e.target.value)}
            className="w-full h-9 px-3 text-sm border border-surface-border rounded-lg bg-white focus:outline-none focus:border-indigo-400"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
            {draft.obligationType === "vat" ? "TRN / VAT ID" : "Tax ID"} <span className="text-gray-300 font-normal normal-case">(optional)</span>
          </label>
          <input
            type="text"
            placeholder="Registration number"
            value={draft.taxId}
            onChange={(e) => set("taxId", e.target.value)}
            className="w-full h-9 px-3 text-sm border border-surface-border rounded-lg bg-white focus:outline-none focus:border-indigo-400"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onAdd}
          disabled={!isValid}
          className="flex-1 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-40"
        >
          Add obligation
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-400 hover:text-gray-600 border border-surface-border rounded-lg"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export default function OnboardingWizard() {
  const router = useRouter();

  // Step state
  const [step, setStep]     = useState(0);
  const [saving, setSaving] = useState(false);
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [seeding, setSeeding]             = useState(false);
  const [seedError, setSeedError]         = useState("");

  // Step 1
  const [entityName, setEntityName] = useState("");

  // Step 2
  const [currencies, setCurrencies] = useState<string[]>(["AED", "EGP"]);

  // Step 3
  const [payrollDay,       setPayrollDay]       = useState("25");
  const [horizonYear,      setHorizonYear]       = useState(String(new Date().getFullYear() + 1));
  const [lockOnProcessing, setLockOnProcessing]  = useState(true);

  // Step 4
  const [obligations,   setObligations]   = useState<ObligationDraft[]>([]);
  const [showAddForm,   setShowAddForm]   = useState(false);
  const [draftObl,      setDraftObl]      = useState<ObligationDraft>(emptyDraft());

  // Step 5
  const [templateFile, setTemplateFile] = useState<File | null>(null);

  const toggleCurrency = (code: string) =>
    setCurrencies((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );

  const addObligation = () => {
    setObligations((prev) => [...prev, draftObl]);
    setDraftObl(emptyDraft());
    setShowAddForm(false);
  };

  const removeObligation = (id: string) =>
    setObligations((prev) => prev.filter((o) => o.id !== id));

  const finish = async () => {
    setSaving(true);

    // Save base settings
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityName,
        currencies,
        payrollDay:        parseInt(payrollDay)  || null,
        horizonYear:       parseInt(horizonYear) || null,
        lockOnProcessing,
      }),
    });

    // Save obligations
    await Promise.allSettled(
      obligations.map((o) =>
        fetch(o.obligationType === "vat" ? "/api/vat/configs" : "/api/tax/configs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            country:           o.country,
            currency:          o.currency,
            rate:              parseFloat(o.rate),
            frequencyMonths:   parseInt(o.frequencyMonths),
            filingDeadlineDays: parseInt(o.filingDeadlineDays),
            startDate:         o.startDate,
            companyName:       o.companyName || null,
            taxId:             o.taxId       || null,
            taxType:           o.taxType,
          }),
        })
      )
    );

    // Upload template if provided
    if (templateFile) {
      const fd = new FormData();
      fd.append("file", templateFile);
      await fetch("/api/contract-templates", { method: "POST", body: fd }).catch(() => {});
    }

    setSaving(false);
    setStep(6);
    setShowDemoModal(true);
  };

  const loadDemoData = async () => {
    setSeeding(true);
    setSeedError("");
    const res = await fetch("/api/seed-demo", { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSeedError(data?.error ?? "Seeding failed. Please try again.");
      setSeeding(false);
      return;
    }
    router.push("/dashboard");
  };

  // ── Welcome ──────────────────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-200">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect x="4" y="4" width="24" height="24" rx="6" stroke="white" strokeWidth="2" fill="none" />
              <path d="M10 16h12M10 11h8M10 21h6" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">Welcome to OpsMind</h1>
          <p className="text-gray-500 mb-10 leading-relaxed">
            Your operations command centre. Let&apos;s configure your workspace — it only takes a couple of minutes.
          </p>
          <button
            onClick={() => setStep(1)}
            className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-md shadow-indigo-200 transition-all hover:shadow-lg hover:-translate-y-0.5"
          >
            Get started →
          </button>
        </div>
      </div>
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────────────
  if (step === 6) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 flex items-center justify-center p-6">
        {/* Demo data modal */}
        {showDemoModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className="relative bg-white rounded-2xl shadow-2xl border border-surface-border w-full max-w-sm p-7 text-center">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-5">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <rect x="3" y="7" width="22" height="16" rx="2.5" stroke="#4f46e5" strokeWidth="1.6" fill="none"/>
                  <path d="M3 11h22" stroke="#4f46e5" strokeWidth="1.4"/>
                  <path d="M8 15.5h4M8 18.5h8" stroke="#4f46e5" strokeWidth="1.3" strokeLinecap="round"/>
                  <path d="M18 4l3 3-3 3M21 7H14" stroke="#4f46e5" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Explore with sample data?</h3>
              <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                Load a realistic dataset — invoices, contracts, payroll runs, expenses, and lease schedules — to see how OpsMind works before adding your own.
              </p>

              {seedError && (
                <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 mb-4">{seedError}</p>
              )}

              <div className="flex flex-col gap-2.5">
                <button
                  onClick={loadDemoData}
                  disabled={seeding}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {seeding ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 14 14" className="animate-spin" fill="none">
                        <circle cx="7" cy="7" r="5.5" stroke="white" strokeWidth="1.5" strokeDasharray="8 8"/>
                      </svg>
                      Loading sample data…
                    </>
                  ) : (
                    "Load sample data"
                  )}
                </button>
                <button
                  onClick={() => router.push("/dashboard")}
                  disabled={seeding}
                  className="w-full py-3 text-sm font-medium text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
                >
                  Start with my own data →
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-6">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M8 16l6 6 10-10" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">You&apos;re all set!</h2>
          <p className="text-gray-500 mb-8">OpsMind is ready. Here&apos;s what&apos;s been configured:</p>
          <div className="bg-white rounded-xl border border-surface-border p-5 text-left space-y-3 mb-8">
            {entityName && (
              <div className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-xs shrink-0">🏢</span>
                <div>
                  <p className="text-xs text-gray-400">Organisation</p>
                  <p className="text-sm font-semibold text-gray-800">{entityName}</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-xs shrink-0">💱</span>
              <div>
                <p className="text-xs text-gray-400">Exchange rates tracked</p>
                <p className="text-sm font-semibold text-gray-800">USD base · {currencies.join(", ") || "—"}</p>
              </div>
            </div>
            {payrollDay && (
              <div className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-xs shrink-0">📅</span>
                <div>
                  <p className="text-xs text-gray-400">Payroll processing</p>
                  <p className="text-sm font-semibold text-gray-800">Day {payrollDay} of each month</p>
                </div>
              </div>
            )}
            {obligations.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-xs shrink-0">🧾</span>
                <div>
                  <p className="text-xs text-gray-400">Tax obligations</p>
                  <p className="text-sm font-semibold text-gray-800">
                    {obligations.map((o) => `${o.obligationType.toUpperCase()} ${o.country}`).join(", ")}
                  </p>
                </div>
              </div>
            )}
            {templateFile && (
              <div className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-xs shrink-0">📄</span>
                <div>
                  <p className="text-xs text-gray-400">Contract template</p>
                  <p className="text-sm font-semibold text-gray-800 truncate max-w-[260px]">{templateFile.name}</p>
                </div>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-400 mb-6">You can adjust all settings and add more obligations at any time in Settings.</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-md shadow-indigo-200 transition-all hover:shadow-lg hover:-translate-y-0.5"
          >
            Open OpsMind →
          </button>
        </div>
      </div>
    );
  }

  // ── Wizard steps (1–5) ───────────────────────────────────────────────────────
  const canContinue =
    step === 1 ? entityName.trim().length > 0 :
    step === 2 ? currencies.length > 0 :
    true;

  const isLastStep = step === 5;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-surface-border overflow-hidden">
        <div className="px-8 pt-8">
          <ProgressBar step={step} />

          {/* ── Step 1: Organisation ── */}
          {step === 1 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Your organisation</h2>
              <p className="text-sm text-gray-400 mb-6">This name appears across the app and in documents.</p>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Company name</label>
              <input
                autoFocus
                type="text"
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && entityName.trim() && setStep(2)}
                placeholder="e.g. Reno Holdings"
                className="w-full h-11 px-4 text-sm border border-surface-border rounded-xl bg-surface-inset focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50"
              />
            </div>
          )}

          {/* ── Step 2: Currencies ── */}
          {step === 2 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Currencies</h2>
              <p className="text-sm text-gray-400 mb-1">Select all currencies your organisation works with.</p>
              <p className="text-xs text-indigo-600 bg-indigo-50 rounded-lg px-3 py-2 mb-4">
                <strong>USD</strong> is always your base. Exchange rates for selected currencies will be tracked automatically.
              </p>
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-indigo-200 bg-indigo-50/50 mb-2 opacity-70">
                <span className="text-xl">🇺🇸</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">USD</p>
                  <p className="text-xs text-gray-400">US Dollar · base currency</p>
                </div>
                <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2.5 2.5 3.5-3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-1.5 max-h-60 overflow-y-auto pr-1">
                {CURRENCIES.map(({ code, name, flag }) => {
                  const selected = currencies.includes(code);
                  return (
                    <button
                      key={code}
                      onClick={() => toggleCurrency(code)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                        selected ? "border-indigo-300 bg-indigo-50/60" : "border-surface-border bg-white hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <span className="text-xl">{flag}</span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-800">{code}</p>
                        <p className="text-xs text-gray-400">{name}</p>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                        selected ? "border-indigo-600 bg-indigo-600" : "border-gray-300"
                      }`}>
                        {selected && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5l2.5 2.5 3.5-3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Step 3: Payroll ── */}
          {step === 3 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Payroll settings</h2>
              <p className="text-sm text-gray-400 mb-6">Controls payroll scheduling and exchange rate locking.</p>
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Processing day
                    </label>
                    <input
                      type="number" min={1} max={31}
                      value={payrollDay}
                      onChange={(e) => setPayrollDay(e.target.value)}
                      className="w-full h-11 px-4 text-sm border border-surface-border rounded-xl bg-surface-inset focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Horizon year
                    </label>
                    <input
                      type="number"
                      min={new Date().getFullYear()}
                      max={new Date().getFullYear() + 10}
                      value={horizonYear}
                      onChange={(e) => setHorizonYear(e.target.value)}
                      className="w-full h-11 px-4 text-sm border border-surface-border rounded-xl bg-surface-inset focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 tabular-nums"
                    />
                  </div>
                </div>
                <div className="flex items-start gap-4 p-4 rounded-xl border border-surface-border bg-surface-inset">
                  <button
                    role="switch"
                    aria-checked={lockOnProcessing}
                    onClick={() => setLockOnProcessing((v) => !v)}
                    className={`mt-0.5 relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${lockOnProcessing ? "bg-indigo-600" : "bg-gray-300"}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${lockOnProcessing ? "translate-x-4" : "translate-x-0"}`} />
                  </button>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Lock rate when processing payroll</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Captures the live USD rate the moment you mark a payroll run as processed so historical totals stay accurate.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: Taxes & VAT ── */}
          {step === 4 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Taxes & VAT obligations</h2>
              <p className="text-sm text-gray-400 mb-4">
                Add your filing schedules so OpsMind can track upcoming deadlines and payment status.
              </p>

              {obligations.length > 0 && (
                <div className="space-y-2 mb-3">
                  {obligations.map((o) => (
                    <div key={o.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-surface-border bg-surface-inset">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        o.obligationType === "vat"
                          ? "bg-violet-100 text-violet-700"
                          : "bg-blue-100 text-blue-700"
                      }`}>
                        {o.obligationType === "vat" ? "VAT" : o.taxType.toUpperCase()}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{o.country} · {o.currency}</p>
                        <p className="text-xs text-gray-400">{o.rate}% · {FREQ_OPTIONS.find(f => f.months === o.frequencyMonths)?.label}</p>
                      </div>
                      <button
                        onClick={() => removeObligation(o.id)}
                        className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showAddForm ? (
                <ObligationForm
                  draft={draftObl}
                  onChange={setDraftObl}
                  onAdd={addObligation}
                  onCancel={() => { setShowAddForm(false); setDraftObl(emptyDraft()); }}
                  activeCurrencies={currencies}
                />
              ) : (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm font-medium text-gray-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
                >
                  + Add obligation
                </button>
              )}
            </div>
          )}

          {/* ── Step 5: Contract templates ── */}
          {step === 5 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Contract templates</h2>
              <p className="text-sm text-gray-400 mb-4">
                Upload a DOCX employment contract. OpsMind will detect placeholders so you can generate contracts from it.
              </p>

              {templateFile ? (
                <div className="flex items-center gap-3 px-4 py-4 rounded-xl border border-emerald-200 bg-emerald-50/40">
                  <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect x="2" y="1" width="10" height="13" rx="1.5" stroke="#059669" strokeWidth="1.3" fill="none" />
                      <path d="M5 5h6M5 7.5h6M5 10h4" stroke="#059669" strokeWidth="1.1" strokeLinecap="round" />
                      <path d="M10 1v3.5h3.5" stroke="#059669" strokeWidth="1.1" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{templateFile.name}</p>
                    <p className="text-xs text-gray-400">{(templateFile.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button
                    onClick={() => setTemplateFile(null)}
                    className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ) : (
                <label className="block cursor-pointer">
                  <input
                    type="file"
                    accept=".docx"
                    className="sr-only"
                    onChange={(e) => setTemplateFile(e.target.files?.[0] ?? null)}
                  />
                  <div className="flex flex-col items-center gap-3 px-6 py-10 rounded-xl border-2 border-dashed border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors text-center">
                    <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M10 3v10M6 7l4-4 4 4" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M3 15h14" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700">Click to upload a DOCX template</p>
                      <p className="text-xs text-gray-400 mt-0.5">Microsoft Word .docx files only</p>
                    </div>
                  </div>
                </label>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-8 py-5 flex items-center justify-between border-t border-surface-border mt-6">
          <button
            onClick={() => { setShowAddForm(false); setStep(step - 1); }}
            className="text-sm font-medium text-gray-400 hover:text-gray-600 transition-colors"
          >
            ← Back
          </button>

          <div className="flex items-center gap-3">
            {/* Skip — shown on steps 4 and 5 only */}
            {(step === 4 || step === 5) && (
              <button
                onClick={() => isLastStep ? finish() : setStep(step + 1)}
                className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                Skip for now
              </button>
            )}

            {isLastStep ? (
              <button
                onClick={finish}
                disabled={saving}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-40"
              >
                {saving ? "Setting up…" : "Finish setup →"}
              </button>
            ) : (
              <button
                onClick={() => setStep(step + 1)}
                disabled={!canContinue || showAddForm}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-40"
              >
                Continue →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
