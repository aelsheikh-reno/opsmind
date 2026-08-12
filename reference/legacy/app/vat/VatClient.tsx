"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Payment = {
  id: string;
  paidAmount: number | null;
  paidAt: string | null;
  notes: string | null;
  documentId: string | null;
  documentName: string | null;
  customDueDate: string | null;
};

type PeriodInvoice = {
  id: string;
  referenceNumber: string | null;
  party: string | null;
  amount: number;
  vatAmount: number | null;
  currency: string;
  exchangeRate: number | null;
};

type ExistingDoc = {
  id: string;
  filename: string;
  docType: string | null;
  issueDate: string | null;
  amount: number | null;
  currency: string | null;
  referenceNumber: string | null;
};

type Period = {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  label: string;
  isPast: boolean;
  isOverdue: boolean;
  invoiceTotal: number;
  invoiceCount: number;
  vatEstimate: number;
  invoices: PeriodInvoice[];
  payment: Payment | null;
};

type ConfigData = {
  id: string;
  country: string;
  currency: string;
  rate: number;
  frequencyMonths: number;
  companyName: string | null;
  taxId: string | null;
  periods: Period[];
};

function fmt(n: number, currency: string) {
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function DueBadge({ dueDate, isPaid }: { dueDate: string; isPaid: boolean }) {
  if (isPaid) return <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Paid</span>;
  const days = daysUntil(dueDate);
  if (days < 0) return <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Overdue {Math.abs(days)}d</span>;
  if (days <= 14) return <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Due in {days}d</span>;
  return <span className="text-[10px] font-semibold text-gray-500 bg-surface-inset px-2 py-0.5 rounded-full">Due in {days}d</span>;
}

function MarkPaidModal({
  period,
  configId,
  currency,
  onClose,
}: {
  period: Period;
  configId: string;
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(period.payment?.paidAmount?.toString() ?? (period.vatEstimate > 0 ? period.vatEstimate.toFixed(2) : ""));
  const [paidAt, setPaidAt] = useState(period.payment?.paidAt?.split("T")[0] ?? new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState(period.payment?.notes ?? "");
  const [documentId, setDocumentId] = useState<string | null>(period.payment?.documentId ?? null);
  const [documentName, setDocumentName] = useState<string | null>(period.payment?.documentName ?? null);
  const [saving, setSaving] = useState(false);

  const [docMode, setDocMode] = useState<"idle" | "link">("idle");
  const [existingDocs, setExistingDocs] = useState<ExistingDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ type: "info" | "warn" | "error"; text: string } | null>(null);
  const [aiExtracted, setAiExtracted] = useState(false);

  async function openLink() {
    setDocMode("link");
    setDocsLoading(true);
    const res = await fetch("/api/vat/documents");
    if (res.ok) setExistingDocs(await res.json());
    setDocsLoading(false);
  }

  function linkDoc(doc: ExistingDoc) {
    setDocumentId(doc.id);
    setDocumentName(doc.filename);
    if (doc.amount) setAmount(doc.amount.toFixed(2));
    if (doc.issueDate) setPaidAt(doc.issueDate.split("T")[0]);
    if (doc.referenceNumber) setNotes(doc.referenceNumber);
    setAiExtracted(false);
    setDocMode("idle");
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    setAiExtracted(false);

    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/vat/extract", { method: "POST", body: fd });
    const data = await res.json();

    if (!res.ok) {
      setUploadMsg({ type: "error", text: data.error ?? "Upload failed" });
      setUploading(false);
      return;
    }

    setDocumentId(data.documentId);
    setDocumentName(file.name);

    if (data.isDuplicate) {
      setUploadMsg({ type: "warn", text: `Already in system — linked existing document.` });
    } else {
      setUploadMsg({ type: "info", text: "Document uploaded and processed by AI." });
      if (data.extracted?.paidAmount) { setAmount(data.extracted.paidAmount.toFixed(2)); setAiExtracted(true); }
      if (data.extracted?.paidAt) setPaidAt(data.extracted.paidAt);
      if (data.extracted?.notes) setNotes(data.extracted.notes);
    }

    setUploading(false);
    setDocMode("idle");
  }

  async function save() {
    setSaving(true);
    await fetch("/api/vat/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vatConfigId: configId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        dueDate: period.dueDate,
        paidAmount: parseFloat(amount),
        paidAt,
        notes: notes || null,
        documentId: documentId ?? null,
      }),
    });
    router.refresh();
    onClose();
    setSaving(false);
  }

  async function unmark() {
    if (!period.payment) return;
    setSaving(true);
    await fetch(`/api/vat/payments/${period.payment.id}`, { method: "DELETE" });
    router.refresh();
    onClose();
    setSaving(false);
  }

  const filteredDocs = existingDocs.filter((d) =>
    d.filename.toLowerCase().includes(docSearch.toLowerCase()) ||
    (d.docType ?? "").toLowerCase().includes(docSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">
          {period.payment ? "Update payment" : "Mark as paid"} — {period.label}
        </h3>
        <p className="text-[11px] text-gray-400 mb-4">
          Estimated VAT: {fmt(period.vatEstimate, currency)}
        </p>

        <div className="mb-4">
          <p className="text-[11px] font-medium text-gray-500 mb-1.5">Supporting document</p>
          {documentId ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="shrink-0 text-indigo-500">
                <rect x="1" y="1" width="9" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
                <path d="M3.5 4.5h6M3.5 6.5h6M3.5 8.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              </svg>
              <span className="text-[11px] text-indigo-700 flex-1 truncate">{documentName}</span>
              <button onClick={() => { setDocumentId(null); setDocumentName(null); setUploadMsg(null); setAiExtracted(false); }}
                className="text-indigo-400 hover:text-indigo-600 shrink-0">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={openLink}
                className="flex items-center gap-1.5 text-[11px] font-medium text-indigo-600 hover:text-indigo-800 px-3 py-1.5 rounded-lg border border-indigo-200 hover:bg-indigo-50 transition-colors">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M4.5 6.5a2.5 2.5 0 0 0 3.5.5l1.5-1.5a2.5 2.5 0 0 0-3.5-3.5L5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <path d="M7.5 5.5a2.5 2.5 0 0 0-3.5-.5L2.5 6.5a2.5 2.5 0 0 0 3.5 3.5L7 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                Link existing
              </button>
              <label className={`flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                uploading ? "text-gray-400 border-gray-200 cursor-wait" : "text-gray-600 hover:text-gray-800 border-surface-border hover:bg-surface-hover"
              }`}>
                {uploading ? (
                  <><svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10"/>
                  </svg>Processing…</>
                ) : (
                  <><svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 1v7M3 4l3-3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M1 9v1.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>Upload new</>
                )}
                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={handleUpload} disabled={uploading} />
              </label>
            </div>
          )}

          {uploadMsg && (
            <p className={`text-[10px] mt-1.5 ${uploadMsg.type === "error" ? "text-red-500" : uploadMsg.type === "warn" ? "text-amber-600" : "text-indigo-600"}`}>
              {uploadMsg.text}
            </p>
          )}
        </div>

        {docMode === "link" && (
          <div className="mb-4 border border-surface-border rounded-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-surface-border bg-surface-inset">
              <input value={docSearch} onChange={(e) => setDocSearch(e.target.value)}
                placeholder="Search documents…" autoFocus
                className="w-full text-xs bg-transparent outline-none text-gray-700 placeholder-gray-400" />
            </div>
            <div className="max-h-44 overflow-y-auto">
              {docsLoading ? (
                <p className="text-[11px] text-gray-400 p-3">Loading…</p>
              ) : filteredDocs.length === 0 ? (
                <p className="text-[11px] text-gray-400 p-3">No documents found</p>
              ) : filteredDocs.map((d) => (
                <button key={d.id} onClick={() => linkDoc(d)}
                  className="w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors border-b border-surface-border last:border-0">
                  <p className="text-[11px] font-medium text-gray-800 truncate">{d.filename}</p>
                  <p className="text-[10px] text-gray-400">
                    {d.docType ?? "—"}
                    {d.issueDate && ` · ${new Date(d.issueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
                    {d.amount && ` · ${d.currency ?? ""} ${d.amount.toLocaleString("en-US")}`}
                  </p>
                </button>
              ))}
            </div>
            <button onClick={() => setDocMode("idle")} className="w-full text-[11px] text-gray-400 hover:text-gray-600 py-2 border-t border-surface-border">
              Cancel
            </button>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1 flex items-center gap-1.5">
              Amount paid ({currency})
              {aiExtracted && <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">AI extracted</span>}
            </label>
            <input type="number" value={amount} onChange={(e) => { setAmount(e.target.value); setAiExtracted(false); }}
              className="w-full h-9 px-3 text-sm border border-surface-border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Payment date</label>
            <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)}
              className="w-full h-9 px-3 text-sm border border-surface-border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Reference / notes</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. TRN reference number"
              className="w-full h-9 px-3 text-sm border border-surface-border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50" />
          </div>
        </div>

        <div className="flex items-center gap-2 mt-5">
          <button onClick={save} disabled={saving || !amount}
            className="flex-1 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50">
            {saving ? "Saving…" : "Confirm payment"}
          </button>
          {period.payment && (
            <button onClick={unmark} disabled={saving}
              className="px-3 py-2 text-sm text-red-500 hover:text-red-700 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50">
              Unmark
            </button>
          )}
          <button onClick={onClose} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-surface-hover transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function PeriodCard({ period, configId, currency }: { period: Period; configId: string; currency: string }) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDue, setEditingDue] = useState(false);
  const [dueInput, setDueInput] = useState(period.dueDate.split("T")[0]);
  const [savingDue, setSavingDue] = useState(false);
  const [showInvoices, setShowInvoices] = useState(false);

  async function saveDueDate() {
    if (!dueInput) return;
    setSavingDue(true);
    await fetch("/api/vat/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vatConfigId: configId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        dueDate: period.dueDate,
        customDueDate: dueInput,
      }),
    });
    router.refresh();
    setEditingDue(false);
    setSavingDue(false);
  }
  const isPaid = period.payment?.paidAmount != null;
  const isFuture = !period.isPast && !period.isOverdue;

  return (
    <>
      <div className={`border rounded-xl p-4 transition-colors ${
        isPaid
          ? "border-emerald-200 bg-emerald-50/40"
          : period.isOverdue
          ? "border-red-200 bg-red-50/30"
          : isFuture
          ? "border-surface-border bg-white"
          : "border-amber-200 bg-amber-50/20"
      }`}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">{period.label}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {new Date(period.periodStart).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              {" – "}
              {new Date(period.periodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
          <DueBadge dueDate={period.dueDate} isPaid={isPaid} />
        </div>

        <div className="space-y-1.5 mb-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => period.invoiceCount > 0 && setShowInvoices(v => !v)}
              className={`flex items-center gap-1 text-left ${period.invoiceCount > 0 ? "cursor-pointer group" : "cursor-default"}`}
            >
              <span className="text-[11px] text-gray-500">
                Invoices in period
                {period.invoiceCount > 0 && (
                  <span className="ml-1 text-gray-400">({period.invoiceCount})</span>
                )}
              </span>
              {period.invoiceCount > 0 && (
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" className={`text-gray-300 group-hover:text-gray-500 transition-transform ${showInvoices ? "rotate-180" : ""}`}>
                  <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
            <span className="text-[11px] font-medium text-gray-700">{fmt(period.invoiceTotal, currency)}</span>
          </div>

          {showInvoices && period.invoices.length > 0 && (
            <div className="mt-1 space-y-1 pl-0.5">
              {period.invoices.map(inv => (
                <a
                  key={inv.id}
                  href={`/records/${inv.id}`}
                  className="flex items-center justify-between px-2.5 py-1.5 bg-white rounded-lg border border-surface-border hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors group"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-medium text-indigo-600 group-hover:text-indigo-800 truncate">
                      {inv.referenceNumber ?? inv.party ?? "Invoice"}
                    </p>
                    {inv.party && inv.referenceNumber && (
                      <p className="text-[9px] text-gray-400 truncate">{inv.party}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-[10px] font-medium text-gray-700">
                      {inv.currency !== currency ? `${inv.currency} ` : ""}{inv.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                    {inv.vatAmount != null && (
                      <p className="text-[9px] text-indigo-500">VAT {inv.vatAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                    )}
                    {inv.exchangeRate != null && (
                      <p className="text-[9px] text-amber-600 font-medium">
                        1 {inv.currency} = {inv.exchangeRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {currency}
                      </p>
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">VAT</span>
            <span className="text-sm font-bold text-gray-900">{fmt(period.vatEstimate, currency)}</span>
          </div>
          {isPaid && period.payment?.paidAmount != null && (
            <div className="flex items-center justify-between pt-1 border-t border-emerald-200">
              <span className="text-[11px] text-emerald-700 font-medium">Paid</span>
              <span className="text-[11px] font-semibold text-emerald-700">
                {fmt(period.payment.paidAmount, currency)}
                {period.payment.paidAt && (
                  <span className="text-gray-400 font-normal ml-1">
                    · {new Date(period.payment.paidAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          {editingDue ? (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={dueInput}
                onChange={(e) => setDueInput(e.target.value)}
                className="h-7 px-2 text-[11px] border border-indigo-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
              />
              <button onClick={saveDueDate} disabled={savingDue}
                className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 px-1.5 py-0.5 rounded disabled:opacity-50">
                {savingDue ? "…" : "Save"}
              </button>
              <button onClick={() => setEditingDue(false)}
                className="text-[11px] text-gray-400 hover:text-gray-600 px-1">✕</button>
            </div>
          ) : (
            <button
              onClick={() => { setDueInput(period.dueDate.split("T")[0]); setEditingDue(true); }}
              className="flex items-center gap-1 group text-left"
              title="Click to change due date for this period"
            >
              <span className={`text-[10px] ${period.payment?.customDueDate ? "text-amber-600 font-medium" : "text-gray-400"}`}>
                Due {new Date(period.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </span>
              <svg width="10" height="10" viewBox="0 0 14 14" fill="none" className="text-gray-300 group-hover:text-gray-500 transition-colors shrink-0">
                <path d="M9.5 2.5L11.5 4.5M2 10.5l1-3 7-7 2 2-7 7-3 1z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          <button
            onClick={() => setModalOpen(true)}
            className={`text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors ${
              isPaid
                ? "text-gray-500 hover:text-gray-700 hover:bg-surface-hover"
                : "text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50"
            }`}
          >
            {isPaid ? "Edit payment" : "Mark as paid"}
          </button>
        </div>
      </div>

      {modalOpen && (
        <MarkPaidModal
          period={period}
          configId={configId}
          currency={currency}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

function RecalculateButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function recalculate() {
    setLoading(true);
    router.refresh();
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
  }

  return (
    <button
      onClick={recalculate}
      disabled={loading}
      className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-surface-hover px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
    >
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className={loading ? "animate-spin" : ""}>
        <path d="M2 7a5 5 0 0 1 8.5-3.5L12 5M12 2v3H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 7a5 5 0 0 1-8.5 3.5L2 9M2 12V9h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {loading ? "Recalculating…" : "Recalculate"}
    </button>
  );
}

export default function VatClient({ configs }: { configs: ConfigData[] }) {
  if (configs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <p className="text-sm font-medium text-gray-500 mb-1">No VAT obligations configured</p>
        <p className="text-xs text-gray-400">Go to <strong>Settings → VAT obligations</strong> to add your countries.</p>
      </div>
    );
  }

  const FREQ_LABELS: Record<number, string> = { 1: "Monthly", 3: "Quarterly", 6: "Semi-annual", 12: "Annual" };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">VAT</h1>
          <p className="text-sm text-gray-400 mt-0.5">VAT filing periods · estimated from invoices</p>
        </div>
        <RecalculateButton />
      </div>

      {configs.map((config) => {
        const unpaidOverdue = config.periods.filter((p) => p.isOverdue && !p.payment).length;
        const unpaidDueSoon = config.periods.filter((p) => {
          const days = daysUntil(p.dueDate);
          return !p.payment && !p.isOverdue && days <= 30;
        }).length;

        return (
          <div key={config.id}>
            <div className="flex items-center gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-gray-900">{config.country}</h2>
                  {config.taxId && (
                    <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded font-mono">{config.taxId}</span>
                  )}
                </div>
                {config.companyName && (
                  <p className="text-xs text-gray-500">{config.companyName}</p>
                )}
                <p className="text-xs text-gray-400">
                  {(config.rate * 100).toFixed(0)}% VAT · {FREQ_LABELS[config.frequencyMonths] ?? `Every ${config.frequencyMonths}mo`} · invoices in {config.currency}
                </p>
              </div>
              {unpaidOverdue > 0 && (
                <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                  {unpaidOverdue} overdue
                </span>
              )}
              {unpaidDueSoon > 0 && unpaidOverdue === 0 && (
                <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  Due soon
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {config.periods.map((p) => (
                <PeriodCard
                  key={p.periodStart}
                  period={p}
                  configId={config.id}
                  currency={config.currency}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
