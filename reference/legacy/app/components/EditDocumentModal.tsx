"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PartiesComboInput from "./PartiesComboInput";
import { GOV_DOC_CATEGORIES } from "@/lib/doc-types";

const CONTRACT_TYPES = [
  { value: "client_contract",     label: "Client Contract",     icon: "🤝" },
  { value: "lease_contract",      label: "Lease / Rental",      icon: "🏢" },
  { value: "employee_contract",   label: "Employment Contract", icon: "👤" },
  { value: "insurance",           label: "Insurance",           icon: "🛡️" },
  { value: "purchase_order",      label: "Purchase Order",      icon: "📦" },
  { value: "government_document", label: "Gov. Document",       icon: "🏛️" },
  { value: "invoice",             label: "Invoice",             icon: "🧾" },
  { value: "other",               label: "Other",               icon: "📁" },
];

import { useActiveCurrencies } from "@/lib/useActiveCurrencies";
const HAS_FINANCIALS = new Set(["lease_contract", "client_contract", "employee_contract", "insurance", "purchase_order", "invoice", "invoice_report"]);
const HAS_GOV_DOC    = new Set(["government_document"]);

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


export interface EditDocumentData {
  id: string;
  filename: string;
  docType: string | null;
  parties: string[];
  referenceNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  renewalDeadline: string | null;
  amount: number | null;
  currency: string | null;
  paymentTerms: string | null;
  summary: string | null;
  notes: string | null;
}

function parseGovDocPaymentTerms(stored: string | null): { category: string; authority: string } {
  const parts = (stored ?? "").split(" · ");
  return {
    category:  parts[0] || GOV_DOC_CATEGORIES[0],
    authority: parts[1] || "",
  };
}

export default function EditDocumentModal({ doc }: { doc: EditDocumentData }) {
  const router = useRouter();
  const activeCurrencies = useActiveCurrencies();
  const [open, setOpen] = useState(false);

  const [docType, setDocType]                 = useState(doc.docType ?? "other");
  const [filename, setFilename]               = useState(doc.filename);
  const [parties, setParties]                 = useState<string[]>(doc.parties);
  const [referenceNumber, setReferenceNumber] = useState(doc.referenceNumber ?? "");
  const [issueDate, setIssueDate]             = useState(doc.issueDate ?? "");
  const [expiryDate, setExpiryDate]           = useState(doc.expiryDate ?? "");
  const [renewalDeadline, setRenewalDeadline] = useState(doc.renewalDeadline ?? "");
  const [amount, setAmount]                   = useState(doc.amount != null ? String(doc.amount) : "");
  const [currency, setCurrency]               = useState(doc.currency ?? "AED");
  const [paymentTerms, setPaymentTerms]       = useState(doc.paymentTerms ?? "");
  const [summary, setSummary]                 = useState(doc.summary ?? "");
  const [notes, setNotes]                     = useState(doc.notes ?? "");

  const initGov = parseGovDocPaymentTerms(doc.docType === "government_document" ? doc.paymentTerms : null);
  const [govDocCategory, setGovDocCategory]       = useState<string>(initGov.category);
  const [issuingAuthority, setIssuingAuthority]   = useState(initGov.authority);

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  function openModal() {
    // reset to current doc values each time modal opens
    setDocType(doc.docType ?? "other");
    setFilename(doc.filename);
    setParties(doc.parties);
    setReferenceNumber(doc.referenceNumber ?? "");
    setIssueDate(doc.issueDate ?? "");
    setExpiryDate(doc.expiryDate ?? "");
    setRenewalDeadline(doc.renewalDeadline ?? "");
    setAmount(doc.amount != null ? String(doc.amount) : "");
    setCurrency(doc.currency ?? "AED");
    setPaymentTerms(doc.paymentTerms ?? "");
    setSummary(doc.summary ?? "");
    setNotes(doc.notes ?? "");
    const g = parseGovDocPaymentTerms(doc.docType === "government_document" ? doc.paymentTerms : null);
    setGovDocCategory(g.category);
    setIssuingAuthority(g.authority);
    setError(null);
    setSaving(false);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!filename.trim()) { setError("Title / filename is required."); return; }

    const effectivePaymentTerms = HAS_GOV_DOC.has(docType)
      ? [govDocCategory, issuingAuthority.trim()].filter(Boolean).join(" · ") || null
      : paymentTerms.trim() || null;

    setSaving(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType,
          filename: filename.trim(),
          parties,
          referenceNumber: referenceNumber.trim() || null,
          issueDate: issueDate || null,
          expiryDate: expiryDate || null,
          renewalDeadline: renewalDeadline || null,
          amount: amount ? parseFloat(amount) : null,
          currency: currency || null,
          paymentTerms: effectivePaymentTerms,
          summary: summary.trim() || null,
          notes: notes.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to save");
      }

      setSaving(false);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={openModal}
        className="flex items-center gap-1.5 bg-white border border-gray-200 hover:bg-surface-hover text-gray-700 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
          <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
        Edit
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative bg-surface-1 rounded-2xl shadow-2xl w-full max-w-6xl flex flex-col max-h-[90vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border shrink-0">
              <div>
                <h2 className="text-base font-bold text-gray-900">Edit record</h2>
                <p className="text-xs text-gray-400 mt-0.5">{doc.filename}</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors p-1.5 rounded-lg hover:bg-gray-100">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Scrollable body */}
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="overflow-y-auto flex-1 px-6 py-5">

                {/* Document type — full width */}
                <Section title="Document type">
                  <div className="grid grid-cols-6 gap-2">
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
                <div className="grid grid-cols-2 gap-4 mt-4">

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
                        <Label>Parties</Label>
                        <PartiesComboInput parties={parties} onChange={setParties} />
                      </div>
                    </Section>

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
                          <Input type="date" value={renewalDeadline} onChange={e => setRenewalDeadline(e.target.value)} />
                        </div>
                      </div>
                    </Section>

                    {HAS_FINANCIALS.has(docType) && (
                      <Section title="Financials">
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
                  <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
                )}
              </div>

              {/* Footer — sticky */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-surface-border shrink-0 bg-surface-inset rounded-b-2xl">
                <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
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
                      Save changes
                    </>
                  )}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}
    </>
  );
}
