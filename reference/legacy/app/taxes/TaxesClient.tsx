"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

type PeriodInvoice = {
  id: string;
  referenceNumber: string | null;
  party: string | null;
  amount: number;
  currency: string;
  convertedAmount: number;
  exchangeRate: number | null;
};

type Payment = {
  id: string;
  paidAmount: number | null;
  paidAt: string | null;
  notes: string | null;
  documentId: string | null;
  documentName: string | null;
};

type Period = {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  label: string;
  isPast: boolean;
  isOverdue: boolean;
  revenueTotal: number;
  invoiceCount: number;
  invoices: PeriodInvoice[];
  payrollExpenses: number;
  commitmentExpenses: number;
  payment: Payment | null;
};

type ConfigData = {
  id: string;
  country: string;
  taxType: string;
  currency: string;
  rate: number;
  frequencyMonths: number;
  companyName: string | null;
  taxId: string | null;
  notes: string | null;
  revenueBase: boolean;
  thresholdActive: boolean;
  profitThreshold: number | null;
  periods: Period[];
};

const TAX_TYPE_LABELS: Record<string, string> = {
  corporate: "Corporate tax",
  income: "Income tax",
  withholding: "Withholding tax",
  other: "Tax",
};

const FREQ_LABELS: Record<number, string> = { 1: "Monthly", 3: "Quarterly", 6: "Semi-annual", 12: "Annual" };

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
  if (days <= 30) return <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Due in {days}d</span>;
  return <span className="text-[10px] font-semibold text-gray-500 bg-surface-inset px-2 py-0.5 rounded-full">Due in {days}d</span>;
}

function MarkPaidModal({
  period,
  configId,
  currency,
  taxTypeLabel,
  estimate,
  onClose,
}: {
  period: Period;
  configId: string;
  currency: string;
  taxTypeLabel: string;
  estimate: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(period.payment?.paidAmount?.toString() ?? (estimate != null && estimate > 0 ? estimate.toFixed(2) : ""));
  const [paidAt, setPaidAt] = useState(period.payment?.paidAt?.split("T")[0] ?? new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState(period.payment?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch("/api/tax/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taxConfigId: configId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        dueDate: period.dueDate,
        paidAmount: amount ? parseFloat(amount) : null,
        paidAt,
        notes: notes || null,
      }),
    });
    router.refresh();
    onClose();
    setSaving(false);
  }

  async function unmark() {
    if (!period.payment) return;
    setSaving(true);
    await fetch(`/api/tax/payments/${period.payment.id}`, { method: "DELETE" });
    router.refresh();
    onClose();
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">
          {period.payment ? "Update payment" : "Mark as paid"} — {period.label}
        </h3>
        <p className="text-[11px] text-gray-400 mb-4">{taxTypeLabel}</p>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Amount paid ({currency})</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter actual amount paid"
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
              placeholder="e.g. Tax return reference number"
              className="w-full h-9 px-3 text-sm border border-surface-border rounded-lg bg-surface-inset focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50" />
          </div>
        </div>

        <div className="flex items-center gap-2 mt-5">
          <button onClick={save} disabled={saving}
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

function InvoiceList({ invoices, currency }: { invoices: PeriodInvoice[]; currency: string }) {
  return (
    <div className="mt-1 space-y-1">
      {invoices.map(inv => (
        <a
          key={inv.id}
          href={`/records/${inv.id}`}
          className="flex items-center justify-between px-2.5 py-1.5 bg-white rounded-lg border border-surface-border hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors group/inv"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium text-indigo-600 group-hover/inv:text-indigo-800 truncate">
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
            {inv.currency !== currency && (
              <>
                <p className="text-[9px] text-gray-500">{currency} {inv.convertedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                {inv.exchangeRate != null && (
                  <p className="text-[9px] text-amber-600 font-medium">
                    1 {inv.currency} = {inv.exchangeRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {currency}
                  </p>
                )}
              </>
            )}
          </div>
        </a>
      ))}
    </div>
  );
}

function EditDueDateButton({ period, configId, currency }: { period: Period; configId: string; currency: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(period.dueDate.split("T")[0]);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function open() {
    setValue(period.dueDate.split("T")[0]);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function save() {
    if (!value) { setEditing(false); return; }
    setSaving(true);
    if (period.payment) {
      await fetch(`/api/tax/payments/${period.payment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueDate: value }),
      });
    } else {
      await fetch("/api/tax/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taxConfigId: configId,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          dueDate: value,
        }),
      });
    }
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="date"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          className="h-7 px-2 text-xs border border-indigo-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        <button onClick={save} disabled={saving}
          className="text-[10px] font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50">
          {saving ? "…" : "Save"}
        </button>
        <button onClick={() => setEditing(false)} className="text-[10px] text-gray-400 hover:text-gray-600">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group">
      <span className="text-[10px] text-gray-400">
        Due {new Date(period.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
      </span>
      <button
        onClick={open}
        title="Edit due date"
        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-indigo-500 p-0.5"
      >
        <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
          <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

function PeriodCard({ period, configId, currency, taxTypeLabel, rate, revenueBase, thresholdActive, profitThreshold, canWrite }: {
  period: Period;
  configId: string;
  currency: string;
  taxTypeLabel: string;
  rate: number;
  revenueBase: boolean;
  thresholdActive: boolean;
  profitThreshold: number | null;
  canWrite: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [showInvoices, setShowInvoices] = useState(false);
  const isPaid = period.payment != null && (period.payment.paidAmount != null || period.payment.paidAt != null);
  const isFuture = !period.isPast && !period.isOverdue;

  // Revenue-based: tax = revenue × rate
  const revenueEstimate = revenueBase && period.revenueTotal > 0
    ? Math.round(period.revenueTotal * rate)
    : null;

  // Profit-based: rough estimate using system data
  const totalExpenses = period.payrollExpenses + period.commitmentExpenses;
  const hasExpenseData = period.revenueTotal > 0 || totalExpenses > 0;
  const estimatedProfit = Math.max(0, period.revenueTotal - totalExpenses);
  const taxableProfit = thresholdActive && profitThreshold != null
    ? Math.max(0, estimatedProfit - profitThreshold)
    : estimatedProfit;
  const profitEstimate = !revenueBase
    ? (hasExpenseData ? Math.round(taxableProfit * rate) : null)
    : null;

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
          {revenueBase ? (
            // ── Revenue-based mode ──────────────────────────────────
            <>
              {period.invoiceCount > 0 && (
                <div>
                  <button
                    onClick={() => setShowInvoices(v => !v)}
                    className="flex items-center justify-between w-full text-left group"
                  >
                    <span className="flex items-center gap-1 text-[11px] text-gray-500">
                      Revenue (tax base)
                      <span className="text-gray-400">({period.invoiceCount})</span>
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" className={`text-gray-300 group-hover:text-gray-500 transition-transform ${showInvoices ? "rotate-180" : ""}`}>
                        <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                    <span className="text-[11px] font-medium text-gray-700">{fmt(period.revenueTotal, currency)}</span>
                  </button>
                  {showInvoices && <InvoiceList invoices={period.invoices} currency={currency} />}
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">Rate on revenue</span>
                <span className="text-[11px] font-medium text-gray-700">{(rate * 100).toFixed(1)}%</span>
              </div>
              {revenueEstimate != null && (
                <div className="flex items-center justify-between pt-1 border-t border-violet-100">
                  <span className="text-[11px] text-violet-700 font-medium">Est. tax</span>
                  <span className="text-sm font-bold text-violet-700">{fmt(revenueEstimate, currency)}</span>
                </div>
              )}
            </>
          ) : (
            // ── Profit-based mode ────────────────────────────────────
            <>
              {period.invoiceCount > 0 && (
                <div>
                  <button
                    onClick={() => setShowInvoices(v => !v)}
                    className="flex items-center justify-between w-full text-left group"
                  >
                    <span className="flex items-center gap-1 text-[11px] text-gray-500">
                      Revenue
                      <span className="text-gray-400">({period.invoiceCount} inv.)</span>
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" className={`text-gray-300 group-hover:text-gray-500 transition-transform ${showInvoices ? "rotate-180" : ""}`}>
                        <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                    <span className="text-[11px] font-medium text-gray-700">{fmt(period.revenueTotal, currency)}</span>
                  </button>
                  {showInvoices && <InvoiceList invoices={period.invoices} currency={currency} />}
                </div>
              )}
              {period.payrollExpenses > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">Payroll</span>
                  <span className="text-[11px] font-medium text-gray-500">− {fmt(period.payrollExpenses, currency)}</span>
                </div>
              )}
              {period.commitmentExpenses > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">Commitments</span>
                  <span className="text-[11px] font-medium text-gray-500">− {fmt(period.commitmentExpenses, currency)}</span>
                </div>
              )}
              {thresholdActive && profitThreshold != null && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">Tax-free below</span>
                  <span className="text-[11px] font-medium text-amber-700">{fmt(profitThreshold, currency)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">Rate on profit</span>
                <span className="text-[11px] font-medium text-gray-700">{(rate * 100).toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-amber-100">
                <span className="text-[11px] text-amber-700 font-medium flex items-center gap-1">
                  Rough est.
                  <span
                    title="Calculated from system invoices (all currencies, converted at live FX rates), payroll and commitments. Does not include depreciation, COGS, or other costs. Verify with your accountant."
                    className="cursor-help opacity-60 hover:opacity-100"
                  >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M8 7.5v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <circle cx="8" cy="5.5" r="0.75" fill="currentColor" />
                    </svg>
                  </span>
                </span>
                {profitEstimate != null
                  ? <span className="text-sm font-bold text-amber-700">{fmt(profitEstimate, currency)}</span>
                  : <span className="text-[11px] text-gray-400 italic">No invoice data yet</span>
                }
              </div>
            </>
          )}

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
          {canWrite
            ? <EditDueDateButton period={period} configId={configId} currency={currency} />
            : <span className="text-[10px] text-gray-400">
                Due {new Date(period.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </span>
          }
          {canWrite && (
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
          )}
        </div>
      </div>

      {modalOpen && (
        <MarkPaidModal
          period={period}
          configId={configId}
          currency={currency}
          taxTypeLabel={taxTypeLabel}
          estimate={revenueEstimate ?? profitEstimate}
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

export default function TaxesClient({ configs, canWrite }: { configs: ConfigData[]; canWrite: boolean }) {
  if (configs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <p className="text-sm font-medium text-gray-500 mb-1">No tax obligations configured</p>
        <p className="text-xs text-gray-400">Go to <strong>Settings → Tax obligations</strong> to add your countries.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Taxes</h1>
          <p className="text-sm text-gray-400 mt-0.5">Corporate and other tax filing periods · track due dates and payments</p>
        </div>
        <RecalculateButton />
      </div>

      {configs.map((config) => {
        const taxTypeLabel = TAX_TYPE_LABELS[config.taxType] ?? config.taxType;
        const unpaidOverdue = config.periods.filter((p) => p.isOverdue && !p.payment).length;
        const unpaidDueSoon = config.periods.filter((p) => {
          const days = daysUntil(p.dueDate);
          return !p.payment && !p.isOverdue && days <= 60;
        }).length;

        return (
          <div key={config.id}>
            <div className="flex items-center gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-gray-900">{config.country}</h2>
                  <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">
                    {taxTypeLabel}
                  </span>
                  {config.revenueBase && (
                    <span className="text-[10px] font-medium text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded-full">Revenue-based</span>
                  )}
                  {!config.revenueBase && config.thresholdActive && config.profitThreshold != null && (
                    <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">
                      Threshold {config.currency} {config.profitThreshold.toLocaleString("en-US")}
                    </span>
                  )}
                  {config.taxId && (
                    <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded font-mono">{config.taxId}</span>
                  )}
                </div>
                {config.companyName && (
                  <p className="text-xs text-gray-500">{config.companyName}</p>
                )}
                <p className="text-xs text-gray-400">
                  {(config.rate * 100).toFixed(1)}%
                  {config.revenueBase ? " on revenue" : config.thresholdActive ? " on profit above threshold" : " on profit"}
                  {" · "}{FREQ_LABELS[config.frequencyMonths] ?? `Every ${config.frequencyMonths}mo`} · {config.currency}
                  {config.notes && ` · ${config.notes}`}
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
                  taxTypeLabel={taxTypeLabel}
                  rate={config.rate}
                  revenueBase={config.revenueBase}
                  thresholdActive={config.thresholdActive}
                  profitThreshold={config.profitThreshold}
                  canWrite={canWrite}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
