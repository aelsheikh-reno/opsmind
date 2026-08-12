"use client";

import { useState, useEffect, useRef } from "react";
import PartiesComboInput from "@/app/components/PartiesComboInput";
import { useRouter } from "next/navigation";
import { GOV_DOC_CATEGORIES } from "@/lib/doc-types";

// ── Constants ──────────────────────────────────────────────────────────────────

const CONTRACT_TYPES = [
  { value: "client_contract",     label: "Client Contract",     icon: "🤝" },
  { value: "lease_contract",      label: "Lease / Rental",      icon: "🏢" },
  { value: "employee_contract",   label: "Employment Contract", icon: "👤" },
  { value: "insurance",           label: "Insurance",           icon: "🛡️" },
  { value: "purchase_order",      label: "Purchase Order",      icon: "📦" },
  { value: "government_document", label: "Gov. Document",       icon: "🏛️" },
  { value: "other",               label: "Other",               icon: "📁" },
];

import { useActiveCurrencies } from "@/lib/useActiveCurrencies";

const HAS_FINANCIALS = new Set(["lease_contract", "client_contract", "insurance", "purchase_order", "employee_contract"]);
const HAS_SCHEDULE   = new Set(["lease_contract", "client_contract", "employee_contract"]);
const HAS_PERSON     = new Set(["employee_contract"]);
const HAS_GOV_DOC    = new Set(["government_document"]);

// ── Types ──────────────────────────────────────────────────────────────────────

interface ScheduleRow {
  id: string;
  dueDate: string;
  amount: string;
  currency: string;
  description: string;
}

// ── Primitives ─────────────────────────────────────────────────────────────────

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-xs font-semibold text-gray-600 mb-1.5">
      {children}
      {required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full border border-surface-border rounded-lg px-3 py-2 text-sm text-gray-900 bg-white placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-colors ${props.className ?? ""}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full border border-surface-border rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-colors ${props.className ?? ""}`}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full border border-surface-border rounded-lg px-3 py-2 text-sm text-gray-900 bg-white placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-colors resize-none ${props.className ?? ""}`}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-surface-border rounded-xl p-5 space-y-4">
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">{title}</h2>
      {children}
    </div>
  );
}

// ── Main form ──────────────────────────────────────────────────────────────────

export default function NewContractForm() {
  const router = useRouter();
  const activeCurrencies = useActiveCurrencies();

  const [docType, setDocType]                 = useState("client_contract");
  const [filename, setFilename]               = useState("");
  const [parties, setParties]                 = useState<string[]>([]);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [issueDate, setIssueDate]             = useState("");
  const [expiryDate, setExpiryDate]           = useState("");
  const [renewalDeadline, setRenewalDeadline] = useState("");
  const [amount, setAmount]                   = useState("");
  const [currency, setCurrency]               = useState("AED");
  const [paymentTerms, setPaymentTerms]       = useState("");
  const [notes, setNotes]                     = useState("");
  const [summary, setSummary]                 = useState("");

  const [employeeName, setEmployeeName]             = useState("");
  const [jobTitle, setJobTitle]                     = useState("");
  const [department, setDepartment]                 = useState("");
  const [nationality, setNationality]               = useState("");
  const [employmentType, setEmploymentType]         = useState<"fulltime" | "parttime">("fulltime");
  const [weeklyHours, setWeeklyHours]               = useState("40");
  const [payslipInContractCurrency, setPayslipInContractCurrency] = useState(false);

  const [govDocCategory, setGovDocCategory]   = useState<string>(GOV_DOC_CATEGORIES[0]);
  const [issuingAuthority, setIssuingAuthority] = useState("");

  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [baseSalary, setBaseSalary] = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Keep a ref so the date effect can read the latest baseSalary without being a dependency
  const baseSalaryRef = useRef(baseSalary);
  useEffect(() => { baseSalaryRef.current = baseSalary; }, [baseSalary]);

  // Auto-generate monthly rows for all schedule-bearing contract types when dates are set
  useEffect(() => {
    if (!HAS_SCHEDULE.has(docType) || !issueDate || !expiryDate) {
      if (HAS_SCHEDULE.has(docType)) setSchedule([]);
      return;
    }
    const start = new Date(issueDate);
    const end   = new Date(expiryDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return;

    setSchedule(prev => {
      const existingByKey = new Map(
        prev.map(r => {
          const d = new Date(r.dueDate);
          return [`${d.getFullYear()}-${d.getMonth() + 1}`, r];
        })
      );
      const rows: ScheduleRow[] = [];
      let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
      while (cursor <= endMonth) {
        const y = cursor.getFullYear();
        const m = cursor.getMonth() + 1;
        const key = `${y}-${m}`;
        const existing = existingByKey.get(key);
        rows.push(existing ?? {
          id: crypto.randomUUID(),
          dueDate: `${y}-${String(m).padStart(2, "0")}-01`,
          amount: docType === "employee_contract" ? baseSalaryRef.current : "",
          currency,
          description: "",
        });
        cursor = new Date(y, cursor.getMonth() + 1, 1);
      }
      return rows;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueDate, expiryDate, docType]);

  // Auto-fill renewal deadline to 3 months before expiry (only when expiry changes and renewal is empty/auto)
  const renewalAutoRef = useRef(true); // tracks whether renewal deadline is still auto-managed
  useEffect(() => {
    if (!expiryDate) return;
    if (!renewalAutoRef.current) return;
    const d = new Date(expiryDate);
    if (isNaN(d.getTime())) return;
    d.setMonth(d.getMonth() - 3);
    setRenewalDeadline(d.toISOString().split("T")[0]);
  }, [expiryDate]);

  function applyBaseSalary(value: string) {
    setBaseSalary(value);
    setSchedule(s => s.map(r => ({ ...r, amount: value })));
  }

  function addScheduleRow() {
    setSchedule(s => [...s, { id: crypto.randomUUID(), dueDate: "", amount: baseSalary, currency, description: "" }]);
  }

  function updateRow(id: string, field: keyof ScheduleRow, value: string) {
    setSchedule(s => s.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!filename.trim()) { setError("Title / filename is required."); return; }

    // For government documents, encode category + issuing authority into paymentTerms
    const effectivePaymentTerms = HAS_GOV_DOC.has(docType)
      ? [govDocCategory, issuingAuthority.trim()].filter(Boolean).join(" · ")
      : paymentTerms.trim() || undefined;

    setSaving(true);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType,
          filename: filename.trim(),
          parties,
          referenceNumber: referenceNumber.trim() || undefined,
          issueDate: issueDate || undefined,
          expiryDate: expiryDate || undefined,
          renewalDeadline: renewalDeadline || undefined,
          amount: HAS_PERSON.has(docType)
            ? (baseSalary ? parseFloat(baseSalary) : undefined)
            : (amount ? parseFloat(amount) : undefined),
          currency: currency || undefined,
          paymentTerms: effectivePaymentTerms,
          notes: notes.trim() || undefined,
          summary: summary.trim() || undefined,
          ...(HAS_PERSON.has(docType) && {
            employeeName: employeeName.trim() || undefined,
            jobTitle: jobTitle.trim() || undefined,
            department: department.trim() || undefined,
            nationality: nationality.trim() || undefined,
            employmentType,
            weeklyHours: weeklyHours ? parseFloat(weeklyHours) : 40,
            payslipInContractCurrency,
          }),
          ...(HAS_SCHEDULE.has(docType) && schedule.length > 0 && {
            paymentSchedule: schedule
              .filter(r => r.dueDate && r.amount)
              .map(r => ({
                dueDate: r.dueDate,
                amount: parseFloat(r.amount),
                // Employment contracts use the single contract-level currency
                currency: docType === "employee_contract" ? currency : r.currency,
                description: r.description.trim() || undefined,
              })),
          }),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to create record");
      }

      const { id } = await res.json() as { id: string };
      router.push(`/records/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  return (
    <main className="px-8 py-6 w-full max-w-5xl">

      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Create record manually</h1>
        <p className="text-sm text-gray-400 mt-0.5">Add a contract, license, or document without uploading a file.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Document type — full width */}
        <Section title="Document type">
          <div className="grid grid-cols-7 gap-2">
            {CONTRACT_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => setDocType(t.value)}
                className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border text-center transition-all text-[11px] font-medium
                  ${docType === t.value
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm"
                    : "border-surface-border bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  }`}
              >
                <span className="text-lg leading-none">{t.icon}</span>
                <span className="leading-tight">{t.label}</span>
              </button>
            ))}
          </div>
        </Section>

        {/* Two-column grid */}
        <div className="grid grid-cols-2 gap-4">

          {/* ── Left column ─────────────────────────────── */}
          <div className="space-y-4">

            <Section title="Basic info">
              <div>
                <Label required>Title / filename</Label>
                <Input value={filename} onChange={e => setFilename(e.target.value)} placeholder="e.g. Office Lease Agreement 2025" required />
              </div>
              <div>
                <Label>Reference number</Label>
                <Input value={referenceNumber} onChange={e => setReferenceNumber(e.target.value)} placeholder="Contract / ref #" />
              </div>
              <div>
                <Label>{HAS_PERSON.has(docType) ? "Counterparty / company" : "Parties"}</Label>
                <PartiesComboInput parties={parties} onChange={setParties} />
              </div>
            </Section>

            {HAS_PERSON.has(docType) && (
              <Section title="Employee details">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Full name</Label>
                    <Input value={employeeName} onChange={e => setEmployeeName(e.target.value)} placeholder="Employee full name" />
                  </div>
                  <div>
                    <Label>Job title</Label>
                    <Input value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="e.g. Senior Engineer" />
                  </div>
                  <div>
                    <Label>Department</Label>
                    <Input value={department} onChange={e => setDepartment(e.target.value)} placeholder="e.g. Engineering" />
                  </div>
                  <div>
                    <Label>Nationality</Label>
                    <Input value={nationality} onChange={e => setNationality(e.target.value)} placeholder="e.g. UAE" />
                  </div>
                </div>
                <div>
                  <Label>Employment type</Label>
                  <div className="flex gap-2">
                    {(["fulltime", "parttime"] as const).map(type => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => { setEmploymentType(type); if (type === "fulltime") setWeeklyHours("40"); }}
                        className={`flex-1 text-sm font-medium py-2 rounded-lg border transition-colors ${
                          employmentType === type
                            ? type === "fulltime"
                              ? "bg-indigo-600 border-indigo-600 text-white"
                              : "bg-amber-500 border-amber-500 text-white"
                            : "bg-white border-surface-border text-gray-500 hover:border-gray-300"
                        }`}
                      >
                        {type === "fulltime" ? "Full-time" : "Part-time"}
                      </button>
                    ))}
                  </div>
                  {employmentType === "parttime" && (
                    <div className="mt-2">
                      <Label>Weekly committed hours</Label>
                      <Input
                        type="number"
                        min="1"
                        max="39"
                        value={weeklyHours}
                        onChange={e => setWeeklyHours(e.target.value)}
                        placeholder="e.g. 20"
                      />
                      {weeklyHours && !isNaN(Number(weeklyHours)) && (
                        <p className="text-[11px] text-gray-400 mt-1">
                          ≈ {Math.round(Number(weeklyHours) * 52 / 12)} hrs/month committed
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </Section>
            )}

            {HAS_GOV_DOC.has(docType) && (
              <Section title="Document details">
                <div>
                  <Label required>Document category</Label>
                  <Select value={govDocCategory} onChange={e => setGovDocCategory(e.target.value)}>
                    {GOV_DOC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Issuing authority</Label>
                  <Input value={issuingAuthority} onChange={e => setIssuingAuthority(e.target.value)} placeholder="e.g. Ministry of Human Resources, DED" />
                </div>
              </Section>
            )}

          </div>

          {/* ── Right column ─────────────────────────────── */}
          <div className="space-y-4">

            <Section title="Dates">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Issue date</Label>
                  <Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
                </div>
                <div>
                  <Label>Expiry date</Label>
                  <Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
                </div>
                <div>
                  <Label>Renewal deadline</Label>
                  <Input type="date" value={renewalDeadline} onChange={e => { renewalAutoRef.current = false; setRenewalDeadline(e.target.value); }} />
                </div>
              </div>
            </Section>

            {HAS_FINANCIALS.has(docType) && (
              <Section title="Financials">
                {docType === "employee_contract" ? (
                  <>
                  <div className="grid grid-cols-[100px_1fr] gap-3 items-end">
                    <div>
                      <Label>Currency</Label>
                      <Select value={currency} onChange={e => setCurrency(e.target.value)}>
                        {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                      </Select>
                    </div>
                    <div>
                      <Label>Basic salary</Label>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={baseSalary}
                        onChange={e => applyBaseSalary(e.target.value)}
                        placeholder="e.g. 15,000 — fills all months"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-sm text-gray-700">Payslips in {currency || "contract currency"}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={payslipInContractCurrency}
                      onClick={() => setPayslipInContractCurrency(v => !v)}
                      className={`relative w-9 h-5 rounded-full transition-colors ${payslipInContractCurrency ? "bg-indigo-600" : "bg-gray-200"}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${payslipInContractCurrency ? "translate-x-4" : ""}`} />
                    </button>
                  </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Total amount</Label>
                        <Input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
                      </div>
                      <div>
                        <Label>Currency</Label>
                        <Select value={currency} onChange={e => setCurrency(e.target.value)}>
                          {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label>Payment terms</Label>
                      <Input value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} placeholder="e.g. Net 30, quarterly, upfront" />
                    </div>
                  </>
                )}
              </Section>
            )}

            {HAS_SCHEDULE.has(docType) && (
              <Section title={docType === "employee_contract" ? "Monthly salary" : "Payment schedule"}>

                {/* Employment contract: auto-generated month rows */}
                {docType === "employee_contract" ? (
                  <>
                    {/* Month rows */}
                    {schedule.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-2">
                        {!issueDate || !expiryDate
                          ? "Set issue and expiry dates above to auto-fill months."
                          : "No months in range."}
                      </p>
                    ) : (
                      <div className="border border-surface-border rounded-lg overflow-hidden">
                        <div className="grid grid-cols-[1fr_120px] gap-px bg-surface-border text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-3 py-1.5 bg-surface-inset">
                          <span>Month</span>
                          <span className="text-right">{currency || "Amount"}</span>
                        </div>
                        <div className="divide-y divide-surface-border">
                          {schedule.map(row => {
                            const d = new Date(row.dueDate);
                            const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
                            return (
                              <div key={row.id} className="grid grid-cols-[1fr_120px] gap-3 items-center px-3 py-1.5 hover:bg-surface-hover">
                                <span className="text-sm text-gray-700">{label}</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={row.amount}
                                  onChange={e => updateRow(row.id, "amount", e.target.value)}
                                  placeholder="0"
                                  className="text-sm text-right border border-transparent hover:border-surface-border focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 rounded-md px-2 py-1 focus:outline-none w-full bg-transparent"
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  /* Lease / client contract: manual rows with date + description + amount + currency */
                  <>
                    {schedule.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-3">
                        {!issueDate || !expiryDate
                          ? "Set issue and expiry dates above to auto-fill months."
                          : "No months in range."}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {schedule.map(row => (
                          <div key={row.id} className="grid grid-cols-[130px_1fr_90px_80px_28px] gap-2 items-center">
                            <Input type="date" value={row.dueDate} onChange={e => updateRow(row.id, "dueDate", e.target.value)} />
                            <Input value={row.description} onChange={e => updateRow(row.id, "description", e.target.value)} placeholder="Description" />
                            <Input type="number" min="0" step="any" value={row.amount} onChange={e => updateRow(row.id, "amount", e.target.value)} placeholder="Amount" />
                            <Select value={row.currency} onChange={e => updateRow(row.id, "currency", e.target.value)}>
                              {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                            </Select>
                            <button type="button" onClick={() => setSchedule(s => s.filter(r => r.id !== row.id))} className="w-7 h-7 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors rounded">×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button type="button" onClick={addScheduleRow} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      Add installment
                    </button>
                  </>
                )}
              </Section>
            )}

            <Section title="Notes">
              <div>
                <Label>Summary</Label>
                <Textarea rows={5} value={summary} onChange={e => setSummary(e.target.value)} placeholder="Brief description of this document…" />
              </div>
              <div>
                <Label>Internal notes</Label>
                <Textarea rows={6} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any internal notes or context…" />
              </div>
            </Section>

          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <div className="flex items-center justify-between pt-2 pb-8">
          <button type="button" onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
          >
            {saving ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="white" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Saving…
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Create record
              </>
            )}
          </button>
        </div>

      </form>
    </main>
  );
}
