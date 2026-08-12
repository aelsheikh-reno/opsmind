"use client";

import { useState, useRef, useEffect } from "react";
import CommitmentChart, { MonthBar } from "./CommitmentChart";

type Props = {
  monthBars: MonthBar[];
  totalCollectedUsd: number;
  totalPendingUsd: number;
  totalUsd: number;
  paidExpensesUsd: number;
  netActualUsd: number;
  unlinkedCount: number;
  periodLabel: string;
  projectedOpeningBalance?: number;
  fxNotes?: string[];
  monthFxNotes?: Record<string, string[]>;
};

function fmtUsd(v: number) {
  if (v <= 0) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function fmtSigned(v: number) {
  const abs = Math.abs(v);
  const s   = v >= 0 ? "+" : "−";
  if (abs >= 1_000_000) return `${s}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${s}$${(abs / 1_000).toFixed(1)}K`;
  return `${s}$${Math.round(abs).toLocaleString("en-US")}`;
}

function InfoPopover({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        onClick={() => setOpen(o => !o)}
        className={`transition-colors ${open ? "text-gray-500" : "text-gray-300 hover:text-gray-400"}`}
        aria-label="More information"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 7.5v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="5.5" r="0.75" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-50 w-60 bg-white border border-surface-border rounded-xl shadow-lg p-3.5">
          <p className="text-[11px] text-gray-500 leading-relaxed">{content}</p>
        </div>
      )}
    </div>
  );
}

export default function FinanceKPIs({
  monthBars,
  totalCollectedUsd,
  totalPendingUsd,
  totalUsd,
  paidExpensesUsd,
  netActualUsd,
  unlinkedCount,
  periodLabel,
  projectedOpeningBalance = 0,
  fxNotes = [],
  monthFxNotes = {},
}: Props) {
  const [clicked, setClicked] = useState<string | null>(null);

  const sel          = monthBars.find(m => m.key === clicked) ?? null;
  const activeFxNotes = clicked ? (monthFxNotes[clicked] ?? fxNotes) : fxNotes;
  const clickedIdx = sel ? monthBars.findIndex(m => m.key === clicked) : -1;

  const dispCollected = sel ? sel.collected : totalCollectedUsd;
  const dispForecast  = sel ? sel.pending   : totalPendingUsd;
  const dispExpenses  = sel ? sel.total     : totalUsd;

  // Projected balance: schedule-based, carries forward from projectedOpeningBalance.
  // Every month: all invoice income (collected + pending) + capital injections
  // minus all liabilities (paid or not). Paid status is irrelevant here —
  // this shows the financial state assuming every commitment is met on schedule.
  const runningBalances = monthBars.reduce<number[]>((acc, m) => {
    const prev     = acc.length > 0 ? acc[acc.length - 1] : projectedOpeningBalance;
    const income   = m.collected + m.pending + m.capitalUsd;
    const expenses = m.total + m.paidExpenses;
    return [...acc, Math.round(prev + income - expenses)];
  }, []);
  const endBalance     = runningBalances[runningBalances.length - 1] ?? 0;
  const dispProjected  = clickedIdx >= 0 ? runningBalances[clickedIdx] : endBalance;
  const dispProjColor  = dispProjected >= 0 ? "text-emerald-600" : "text-red-500";
  const dispProjBorder = "border-surface-border";

  const clearBadge = sel ? (
    <button
      onClick={() => setClicked(null)}
      className="flex items-center gap-1 text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full hover:bg-gray-200 transition-colors"
    >
      {sel.label}
      <svg width="7" height="7" viewBox="0 0 8 8" fill="none">
        <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>
  ) : null;

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-5 gap-4">

        {/* Collected */}
        <div className="relative bg-white border border-surface-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Collected</p>
              <InfoPopover content="Invoices from clients that have been marked as paid within the selected period. This is real cash received — not an estimate." />
            </div>
            {clearBadge}
          </div>
          <p className="text-2xl font-bold text-emerald-600 tabular-nums">{fmtUsd(dispCollected)}</p>
          <p className="text-xs text-gray-400 mt-1">
            {sel ? "paid invoices this month" : `paid invoices · ${periodLabel}`}
          </p>
        </div>

        {/* Forecast */}
        <div className="relative bg-white border border-surface-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Forecast</p>
              <InfoPopover content="Invoices issued to clients that are due within the period but not yet paid. Represents expected income if clients pay on time." />
            </div>
            {clearBadge}
          </div>
          <p className="text-2xl font-bold text-indigo-500 tabular-nums">{fmtUsd(dispForecast)}</p>
          <p className="text-xs text-gray-400 mt-1">
            {sel ? "pending invoices this month" : `pending invoices · ${periodLabel}`}
          </p>
        </div>

        {/* Expenses */}
        <div className="relative bg-white border border-surface-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Expenses</p>
              <InfoPopover content="Remaining unpaid commitments within the period — payroll, lease, and client payment schedules not yet settled. Expenses already paid are shown separately in the subtitle." />
            </div>
            {clearBadge}
          </div>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{fmtUsd(dispExpenses)}</p>
          <p className="text-xs text-gray-400 mt-1">
            {sel
              ? "committed this month"
              : <>remaining unpaid{paidExpensesUsd > 0 && <span className="ml-1 text-gray-300">· {fmtUsd(paidExpensesUsd)} paid</span>}</>
            }
          </p>
        </div>

        {/* Projected balance */}
        <div className={`relative bg-white border rounded-xl p-4 ${dispProjBorder}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Projected balance</p>
              <InfoPopover content="Schedule-based financial position starting from zero. Each month adds all invoice income and capital injections, then subtracts all liabilities — regardless of whether they are marked paid. Click a month bar to see the projected balance at that month's end." />
            </div>
            {clearBadge}
          </div>
          <p className={`text-2xl font-bold tabular-nums ${dispProjColor}`}>
            {fmtSigned(dispProjected)}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {sel ? "projected balance end of month" : `all income − all liabilities · ${periodLabel}`}
          </p>
        </div>

        {/* Without invoice — always period total, not month-specific */}
        <div className={`relative bg-white border rounded-xl p-4 ${unlinkedCount > 0 ? "border-amber-200" : "border-surface-border"}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Without invoice</p>
              <InfoPopover content="Client payment schedule entries that have no linked invoice for the period. These are financial commitments lacking supporting documentation — they should be matched to an invoice or investigated." />
            </div>
          </div>
          <p className={`text-2xl font-bold tabular-nums ${unlinkedCount > 0 ? "text-amber-600" : "text-gray-900"}`}>
            {unlinkedCount}
          </p>
          <p className="text-xs text-gray-400 mt-1">vendor payments · {periodLabel}</p>
        </div>

      </div>

      {/* Chart card */}
      <div className="bg-white border border-surface-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-900">Expenses vs. receivables by month</h2>
          <span className="text-[10px] text-gray-400 bg-surface-inset px-2 py-1 rounded-full">
            All invoices · USD equivalent
          </span>
        </div>
        <CommitmentChart
          months={monthBars}
          projectedOpeningBalance={projectedOpeningBalance}
          clicked={clicked}
          onClickedChange={setClicked}
          fxNotes={activeFxNotes}
        />
      </div>
    </>
  );
}
