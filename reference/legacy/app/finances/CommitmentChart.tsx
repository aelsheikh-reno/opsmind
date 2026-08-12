"use client";

import { useState } from "react";
import Link from "next/link";

export type InvoiceDetail = {
  id: string;
  vendor: string;
  referenceNumber: string | null;
  amount: number;
  currency: string;
  isPaid: boolean;
};

export type PayrollItem = {
  id: string;
  employeeName: string;
  amount: number;
  currency: string;
};

export type PaymentItem = {
  id: string;
  documentId: string;
  label: string;
  amount: number;
  currency: string;
};

export type ExpenseItem = {
  id: string;
  name: string;
  amount: number;
  currency: string;
  usdAmount: number;
  expenseType: string | null;
  personName: string | null;
  isPaid: boolean;
};

export type VatItem = {
  configId: string;
  country: string;
  currency: string;
  amount: number;
  usdAmount: number;
  periodLabel: string;
};

export type TaxItem = {
  configId: string;
  country: string;
  taxType: string;
  currency: string;
  amount: number;
  usdAmount: number;
  periodLabel: string;
  isEstimate: boolean;
};

export type MonthBar = {
  key: string;
  label: string;
  payroll: number;
  lease: number;
  expense: number;
  vat: number;
  paidVat: number;
  tax: number;
  paidTax: number;
  total: number;
  paidPayroll: number;
  paidLease: number;
  capitalUsd: number;
  payrollCount: number;
  leaseCount: number;
  expenseCount: number;
  vatCount: number;
  taxCount: number;
  payrollItems: PayrollItem[];
  leaseItems: PaymentItem[];
  expenseItems: ExpenseItem[];
  expensePaid: number;
  expenseUnpaid: number;
  vatItems: VatItem[];
  paidVatItems: { country: string; currency: string; amount: number; periodLabel: string }[];
  taxItems: TaxItem[];
  paidTaxItems: TaxItem[];
  receivable: number;
  collected: number;
  pending: number;
  receivableCount: number;
  receivableInvoices: InvoiceDetail[];
  paidExpenses: number;
};

const EXPENSE_SEGS = [
  { key: "payroll" as const, label: "Payroll",       color: "#6366f1" },
  { key: "lease"   as const, label: "Lease / rent",  color: "#f97316" },
  { key: "expense" as const, label: "Claims",        color: "#f59e0b" },
  { key: "vat"     as const, label: "VAT liability", color: "#f43f5e" },
  { key: "tax"     as const, label: "Tax liability", color: "#7c3aed" },
];

function fmt(v: number) {
  if (v === 0) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

// Full precision format for individual line items — matches the claims page display.
function fmtItem(v: number) {
  if (v === 0) return "—";
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function fmtSigned(v: number) {
  const abs = Math.abs(v);
  const s   = v >= 0 ? "+" : "−";
  if (abs >= 1_000_000) return `${s}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${s}$${(abs / 1_000).toFixed(1)}K`;
  return `${s}$${Math.round(abs).toLocaleString("en-US")}`;
}

function fmtAxis(v: number) {
  const abs  = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

const RECEIVABLE_COLOR    = "#10b981";
const BALANCE_HIST_COLOR  = "#10b981";
const BALANCE_PROJ_COLOR  = "#6366f1";

export default function CommitmentChart({
  months,
  projectedOpeningBalance = 0,
  clicked,
  onClickedChange,
  fxNotes = [],
}: {
  months: MonthBar[];
  projectedOpeningBalance?: number;
  clicked: string | null;
  onClickedChange: (key: string | null) => void;
  fxNotes?: string[];
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  // ── Bar scale ──────────────────────────────────────────────────────────────
  const maxVal    = Math.max(...months.map(m => Math.max(m.total + m.paidPayroll + m.paidLease + m.paidTax, m.receivable)), 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const niceMax   = Math.ceil(maxVal / magnitude) * magnitude;

  const W = 720, H = 220;
  const padL = 54, padR = 52, padT = 10, padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const slotW  = chartW / months.length;

  const barW   = slotW * 0.38;
  const gapOut = slotW * 0.08;
  const gapIn  = slotW * 0.08;
  const expX   = gapOut;
  const recX   = gapOut + barW + gapIn;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => f * niceMax);

  function yPos(v: number) {
    return padT + chartH - (v / niceMax) * chartH;
  }

  // ── Projected balance (schedule-based, starts from zero) ─────────────────
  // All income (collected + pending + capital injections) minus all liabilities
  // (paid or not) per month. Paid status is irrelevant — every scheduled item
  // is treated as settled in its month.
  const balances: number[] = [];
  let bal = projectedOpeningBalance;
  for (const m of months) {
    const income   = m.collected + m.pending + m.capitalUsd;
    const expenses = m.total + m.paidExpenses;
    bal += income - expenses;
    balances.push(Math.round(bal));
  }

  const allBals  = [projectedOpeningBalance, ...balances];
  const rawMin   = Math.min(...allBals);
  const rawMax   = Math.max(...allBals);
  const rangeBal = rawMax - rawMin || Math.abs(rawMax) || 1;
  const balPad   = rangeBal * 0.25;
  const balMin   = rawMin - balPad;
  const balMax   = rawMax + balPad;
  const balRange = balMax - balMin;

  function yBal(v: number) {
    return padT + chartH - ((v - balMin) / balRange) * chartH;
  }

  const now2    = new Date();
  const todayYM = now2.getFullYear() * 12 + now2.getMonth() + 1;

  type BPt = { x: number; y: number; projected: boolean };
  const balPoints: BPt[] = [
    { x: padL, y: yBal(projectedOpeningBalance), projected: false },
    ...months.map((m, i) => {
      const [y, mo] = m.key.split("-").map(Number);
      return { x: padL + (i + 0.5) * slotW, y: yBal(balances[i]), projected: y * 12 + mo > todayYM };
    }),
  ];

  let lastHistIdx = 0;
  for (let i = 0; i < balPoints.length; i++) {
    if (!balPoints[i].projected) lastHistIdx = i;
  }
  const histPoints = balPoints.slice(0, lastHistIdx + 1);
  const projPoints = balPoints.slice(lastHistIdx);

  const ptStr = (pts: BPt[]) => pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const firstFutureIdx = months.findIndex(m => {
    const [y, mo] = m.key.split("-").map(Number);
    return y * 12 + mo > todayYM;
  });
  const todaySepX = firstFutureIdx > 0 ? padL + firstFutureIdx * slotW : null;

  const balAxisTicks = [0, 0.25, 0.5, 0.75, 1].map(f => balMin + f * balRange);

  // ── Derived click state ──────────────────────────────────────────────────
  const clickedBar = months.find(m => m.key === clicked) ?? null;
  const clickedIdx = months.findIndex(m => m.key === clicked);
  const clickedBal = clickedIdx >= 0 ? balances[clickedIdx] : null;
  const clickedIsProjected = clickedIdx >= 0 && (() => {
    const [y, mo] = months[clickedIdx].key.split("-").map(Number);
    return y * 12 + mo > todayYM;
  })();

  return (
    <div onMouseLeave={() => setHovered(null)}>
      {/* Legend */}
      <div className="flex items-center gap-5 mb-3 flex-wrap">
        {EXPENSE_SEGS.map(s => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="w-2.5 h-2.5 rounded-sm inline-block shrink-0" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] text-gray-500 pl-2 border-l border-gray-200">
          <span className="w-2.5 h-2.5 rounded-sm inline-block shrink-0" style={{ background: RECEIVABLE_COLOR }} />
          Receivables
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-gray-500 pl-2 border-l border-gray-200">
          <svg width="18" height="10" className="shrink-0">
            <line x1="0" y1="5" x2="10" y2="5" stroke={BALANCE_HIST_COLOR} strokeWidth="1.5" />
            <line x1="10" y1="5" x2="18" y2="5" stroke={BALANCE_PROJ_COLOR} strokeWidth="1.5" strokeDasharray="3 2" />
          </svg>
          Projected balance
        </span>
        <span className="ml-auto flex items-center gap-3 text-[10px] text-gray-400 italic">
          {fxNotes.length > 0 && (
            <span className="not-italic border-l border-gray-200 pl-3">
              {fxNotes.join(" · ")}
            </span>
          )}
          <span>Click a month to see details</span>
        </span>
      </div>

      {/* SVG chart — responsive, scales with container */}
      <div className="w-full" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">

          {/* Grid + left Y-axis labels */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line x1={padL} y1={yPos(tick)} x2={W - padR} y2={yPos(tick)}
                stroke="#f1f5f9" strokeWidth="1" />
              <text x={padL - 5} y={yPos(tick) + 3.5}
                textAnchor="end" fontSize="9.5" fill="#cbd5e1">
                {fmtAxis(tick)}
              </text>
            </g>
          ))}

          {/* Right Y-axis labels (balance scale) */}
          {balAxisTicks.map((tick, i) => (
            <text key={i} x={W - padR + 5} y={yBal(tick) + 3.5}
              textAnchor="start" fontSize="8.5" fill="#a5b4fc">
              {fmtAxis(Math.round(tick))}
            </text>
          ))}

          {/* Bars */}
          {months.map((m, i) => {
            const slotX   = padL + i * slotW;
            const isH     = hovered === m.key;
            const isC     = clicked === m.key;
            let   curY    = padT + chartH;

            return (
              <g
                key={m.key}
                onMouseEnter={() => setHovered(m.key)}
                onClick={() => onClickedChange(clicked === m.key ? null : m.key)}
                style={{ cursor: "pointer" }}
              >
                {/* Slot background on hover or click */}
                {(isH || isC) && (
                  <rect x={slotX + 2} y={padT} width={slotW - 4} height={chartH}
                    fill={isC ? "#6366f1" : "#6366f1"} fillOpacity={isC ? 0.07 : 0.04} rx="3" />
                )}

                {/* Expense segments (stacked) */}
                {EXPENSE_SEGS.map(seg => {
                  const val = m[seg.key];
                  if (val === 0) return null;
                  const h = (val / niceMax) * chartH;
                  curY -= h;
                  return (
                    <rect key={seg.key} x={slotX + expX} y={curY} width={barW} height={h}
                      fill={seg.color} opacity={(isH || isC) ? 1 : 0.82} />
                  );
                })}
                {/* Paid payroll segment (historical — dimmed) */}
                {m.paidPayroll > 0 && (() => {
                  const h = (m.paidPayroll / niceMax) * chartH;
                  curY -= h;
                  return (
                    <rect x={slotX + expX} y={curY} width={barW} height={h}
                      fill="#6366f1" opacity={(isH || isC) ? 0.45 : 0.28} />
                  );
                })()}
                {/* Paid lease segment (historical — dimmed) */}
                {m.paidLease > 0 && (() => {
                  const h = (m.paidLease / niceMax) * chartH;
                  curY -= h;
                  return (
                    <rect x={slotX + expX} y={curY} width={barW} height={h}
                      fill="#f97316" opacity={(isH || isC) ? 0.45 : 0.28} />
                  );
                })()}
                {/* Paid tax segment (historical — dimmed) */}
                {m.paidTax > 0 && (() => {
                  const h = (m.paidTax / niceMax) * chartH;
                  curY -= h;
                  return (
                    <rect x={slotX + expX} y={curY} width={barW} height={h}
                      fill="#7c3aed" opacity={(isH || isC) ? 0.45 : 0.28} />
                  );
                })()}
                {m.total === 0 && m.paidPayroll === 0 && m.paidLease === 0 && m.paidTax === 0 && (
                  <rect x={slotX + expX} y={padT + chartH - 1} width={barW} height={1} fill="#e2e8f0" />
                )}

                {/* Receivable bar */}
                {m.receivable > 0 && (() => {
                  const h = (m.receivable / niceMax) * chartH;
                  return (
                    <rect x={slotX + recX} y={yPos(m.receivable)} width={barW} height={h}
                      fill={RECEIVABLE_COLOR} opacity={(isH || isC) ? 1 : 0.82} />
                  );
                })()}
                {m.receivable === 0 && (
                  <rect x={slotX + recX} y={padT + chartH - 1} width={barW} height={1} fill="#e2e8f0" />
                )}

                {/* Selected indicator — bottom accent line */}
                {isC && (
                  <rect x={slotX + 2} y={padT + chartH + 2} width={slotW - 4} height={2}
                    fill="#6366f1" rx="1" />
                )}

                {/* Month label */}
                <text x={slotX + slotW / 2} y={H - 4}
                  textAnchor="middle" fontSize="9"
                  fill={isC ? "#6366f1" : isH ? "#6366f1" : "#94a3b8"}
                  fontWeight={(isH || isC) ? "600" : "400"}>
                  {m.label}
                </text>
              </g>
            );
          })}

          {/* Today separator */}
          {todaySepX !== null && (
            <g>
              <line x1={todaySepX} y1={padT} x2={todaySepX} y2={padT + chartH}
                stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 2" />
              <text x={todaySepX + 3} y={padT + 9} fontSize="7.5" fill="#94a3b8">Today</text>
            </g>
          )}

          {/* Balance line — historical */}
          {histPoints.length > 1 && (
            <polyline points={ptStr(histPoints)}
              fill="none" stroke={BALANCE_HIST_COLOR} strokeWidth="1.8"
              strokeLinejoin="round" strokeLinecap="round" />
          )}

          {/* Balance line — projected */}
          {projPoints.length > 1 && (
            <polyline points={ptStr(projPoints)}
              fill="none" stroke={BALANCE_PROJ_COLOR} strokeWidth="1.8"
              strokeDasharray="5 3" strokeLinejoin="round" strokeLinecap="round" />
          )}

          {/* Balance dots */}
          {balPoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? 2 : 2.5}
              fill={i === 0 ? "#94a3b8" : p.projected ? BALANCE_PROJ_COLOR : BALANCE_HIST_COLOR}
              stroke="white" strokeWidth="1"
              opacity={clickedIdx === i - 1 ? 1 : 0.75} />
          ))}

        </svg>
      </div>

      {/* Hint when nothing is clicked */}
      {!clickedBar && (
        <p className="text-[11px] text-gray-400 px-1 pt-2">
          Click a month bar to see the cashflow breakdown
        </p>
      )}

      {/* ── Month detail card (shown on click) ─────────────────────────────── */}
      {clickedBar && (() => {
        const fullExpenses      = clickedBar.total + clickedBar.paidPayroll + clickedBar.paidLease + clickedBar.paidTax;
        const totalIncome       = clickedBar.receivable + clickedBar.capitalUsd;
        const net               = totalIncome - fullExpenses;
        const collectedInvoices = clickedBar.receivableInvoices.filter(i => i.isPaid);
        const pendingInvoices   = clickedBar.receivableInvoices.filter(i => !i.isPaid);

        return (
          <div className="mt-3 bg-white border border-surface-border rounded-xl overflow-hidden shadow-sm">

            {/* Card header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-border bg-surface-inset">
              <div className="flex items-center gap-4 flex-wrap">
                {/* Month + projected badge */}
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-gray-900">{clickedBar.label}</h3>
                    {clickedIsProjected
                      ? <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">Projected</span>
                      : <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">Historical</span>
                    }
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Out: <span className="font-medium text-gray-600">{fmt(fullExpenses)}</span>
                    <span className="mx-1.5 text-gray-300">·</span>
                    In: <span className="font-medium text-emerald-600">{fmt(totalIncome)}</span>
                  </p>
                </div>

                <div className="w-px h-8 bg-gray-200 shrink-0" />

                {/* Net */}
                <div>
                  <p className="text-[10px] text-gray-400 mb-0.5">Net this month</p>
                  <p className={`text-lg font-bold tabular-nums leading-none ${net >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {fmtSigned(net)}
                  </p>
                </div>

                {/* Cash balance */}
                {clickedBal !== null && (
                  <>
                    <div className="w-px h-8 bg-gray-200 shrink-0" />
                    <div>
                      <p className="text-[10px] text-gray-400 mb-0.5">
                        Cash balance {clickedIsProjected ? "(projected)" : "after"}
                      </p>
                      <p className={`text-lg font-bold tabular-nums leading-none ${clickedBal >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {fmtSigned(clickedBal)}
                      </p>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={() => onClickedChange(null)}
                className="ml-4 text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors shrink-0"
                aria-label="Close"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M2 2l7 7M9 2l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Two-column body: Expenses | Income */}
            <div className="grid grid-cols-2 divide-x divide-surface-border">

              {/* ── Expenses column ── */}
              <div className="px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Expenses</span>
                  <span className="text-sm font-bold text-gray-900 tabular-nums">{fmt(fullExpenses)}</span>
                </div>

                {fullExpenses === 0 && (
                  <p className="text-[11px] text-gray-400 italic">No expenses this month</p>
                )}

                <div className="space-y-3">
                  {clickedBar.payrollItems.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: "#6366f1" }} />
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#6366f1" }}>Payroll</span>
                        </div>
                        <span className="text-[10px] font-semibold text-gray-500 tabular-nums">{fmt(clickedBar.payroll)}</span>
                      </div>
                      <div className="space-y-0.5">
                        {clickedBar.payrollItems.map(p => (
                          <div key={p.id} className="flex items-center justify-between px-2.5 py-1.5 bg-indigo-50/40 rounded-lg">
                            <span className="text-[10px] font-medium text-gray-700">{p.employeeName}</span>
                            <span className="text-[10px] text-gray-500 tabular-nums">{p.currency} {p.amount.toLocaleString("en-US")}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {clickedBar.leaseItems.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: "#f97316" }} />
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#f97316" }}>Lease / rent</span>
                        </div>
                        <span className="text-[10px] font-semibold text-gray-500 tabular-nums">{fmt(clickedBar.lease)}</span>
                      </div>
                      <div className="space-y-0.5">
                        {clickedBar.leaseItems.map(p => (
                          <Link key={p.id} href={`/records/${p.documentId}`}
                            className="flex items-center justify-between px-2.5 py-1.5 bg-orange-50/40 rounded-lg hover:bg-orange-50 transition-colors group">
                            <span className="text-[10px] font-medium text-gray-700 group-hover:text-orange-700">{p.label}</span>
                            <span className="text-[10px] text-gray-500 tabular-nums">{p.currency} {p.amount.toLocaleString("en-US")}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {clickedBar.expenseItems.length > 0 && (() => {
                    const paidItems   = clickedBar.expenseItems.filter(e => e.isPaid);
                    const unpaidItems = clickedBar.expenseItems.filter(e => !e.isPaid);
                    return (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: "#f59e0b" }} />
                            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#f59e0b" }}>Claims</span>
                          </div>
                          <span className="text-[10px] font-semibold text-gray-500 tabular-nums">{fmt(clickedBar.expense)}</span>
                        </div>

                        <div className="space-y-2">
                          {unpaidItems.length > 0 && (
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-amber-400" />
                                  <span className="text-[9px] font-semibold text-amber-600 uppercase tracking-wider">Unpaid</span>
                                </div>
                                <span className="text-[9px] font-semibold text-amber-600 tabular-nums">{fmt(clickedBar.expenseUnpaid)}</span>
                              </div>
                              <div className="space-y-0.5">
                                {unpaidItems.map(e => (
                                  <Link key={e.id} href="/expenses"
                                    className="flex items-center justify-between px-2.5 py-1.5 bg-amber-50/40 rounded-lg hover:bg-amber-50 transition-colors group">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      {e.expenseType && (
                                        <span className="text-[9px] text-amber-600 bg-amber-100 px-1 py-px rounded shrink-0">{e.expenseType}</span>
                                      )}
                                      <div className="min-w-0">
                                        <span className="text-[10px] font-medium text-gray-700 group-hover:text-amber-700 truncate block">{e.name}</span>
                                        {e.personName && (
                                          <span className="text-[9px] text-gray-400 truncate block">{e.personName}</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                      <span className="text-[10px] font-semibold text-gray-800 tabular-nums">{fmtItem(e.usdAmount)}</span>
                                      {e.currency !== "USD" && (
                                        <span className="text-[9px] text-gray-400 tabular-nums">{e.currency} {e.amount.toLocaleString("en-US")}</span>
                                      )}
                                    </div>
                                  </Link>
                                ))}
                              </div>
                            </div>
                          )}

                          {paidItems.length > 0 && (
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-emerald-500" />
                                  <span className="text-[9px] font-semibold text-emerald-600 uppercase tracking-wider">Paid</span>
                                </div>
                                <span className="text-[9px] font-semibold text-emerald-600 tabular-nums">{fmt(clickedBar.expensePaid)}</span>
                              </div>
                              <div className="space-y-0.5">
                                {paidItems.map(e => (
                                  <Link key={e.id} href="/expenses"
                                    className="flex items-center justify-between px-2.5 py-1.5 bg-emerald-50/30 rounded-lg hover:bg-emerald-50 transition-colors group opacity-70">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      {e.expenseType && (
                                        <span className="text-[9px] text-gray-400 bg-gray-100 px-1 py-px rounded shrink-0">{e.expenseType}</span>
                                      )}
                                      <div className="min-w-0">
                                        <span className="text-[10px] font-medium text-gray-400 line-through truncate block">{e.name}</span>
                                        {e.personName && (
                                          <span className="text-[9px] text-gray-300 truncate block">{e.personName}</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                      <span className="text-[10px] font-medium text-gray-400 tabular-nums line-through">{fmtItem(e.usdAmount)}</span>
                                      <span className="text-[9px] font-bold text-emerald-500">✓</span>
                                    </div>
                                  </Link>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {clickedBar.vatItems.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: "#f43f5e" }} />
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#f43f5e" }}>VAT liability</span>
                        </div>
                        <span className="text-[10px] font-semibold text-gray-500 tabular-nums">{fmt(clickedBar.vat)}</span>
                      </div>
                      <div className="space-y-0.5">
                        {clickedBar.vatItems.map(item => (
                          <Link key={`${item.configId}-${item.periodLabel}`} href="/vat"
                            className="flex items-center justify-between px-2.5 py-1.5 bg-rose-50/40 rounded-lg hover:bg-rose-50 transition-colors group">
                            <div>
                              <span className="text-[10px] font-medium text-gray-700 group-hover:text-rose-700">{item.country}</span>
                              <span className="text-[9px] text-gray-400 ml-1.5">{item.periodLabel}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                              <span className="text-[10px] font-semibold text-gray-800 tabular-nums">{fmtItem(item.usdAmount)}</span>
                              {item.currency !== "USD" && (
                                <span className="text-[9px] text-gray-400 tabular-nums">{item.currency} {item.amount.toLocaleString("en-US")}</span>
                              )}
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {clickedBar.taxItems.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: "#7c3aed" }} />
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#7c3aed" }}>Tax due</span>
                        </div>
                        <span className="text-[10px] font-semibold text-gray-500 tabular-nums">{fmt(clickedBar.tax)}</span>
                      </div>
                      <div className="space-y-0.5">
                        {clickedBar.taxItems.map(item => (
                          <Link key={`${item.configId}-${item.periodLabel}`} href="/taxes"
                            className="flex items-center justify-between px-2.5 py-1.5 bg-violet-50/40 rounded-lg hover:bg-violet-50 transition-colors group">
                            <div>
                              <span className="text-[10px] font-medium text-gray-700 group-hover:text-violet-700">{item.country} · {item.taxType}</span>
                              <span className="text-[9px] text-gray-400 ml-1.5">{item.periodLabel}</span>
                              {item.isEstimate && <span className="text-[9px] text-violet-400 ml-1">(est.)</span>}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                              <span className="text-[10px] font-semibold text-gray-800 tabular-nums">{fmtItem(item.usdAmount)}</span>
                              {item.currency !== "USD" && (
                                <span className="text-[9px] text-gray-400 tabular-nums">{item.currency} {item.amount.toLocaleString("en-US")}</span>
                              )}
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {clickedBar.paidTaxItems.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm shrink-0 opacity-50" style={{ background: "#7c3aed" }} />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Tax paid</span>
                        </div>
                        <span className="text-[10px] font-semibold text-gray-500 tabular-nums">{fmt(clickedBar.paidTax)}</span>
                      </div>
                      <div className="space-y-0.5">
                        {clickedBar.paidTaxItems.map((item, i) => (
                          <Link key={`paid-${item.configId}-${item.periodLabel}-${i}`} href="/taxes"
                            className="flex items-center justify-between px-2.5 py-1.5 bg-gray-50 rounded-lg hover:bg-violet-50/40 transition-colors group">
                            <div>
                              <span className="text-[10px] font-medium text-gray-500 group-hover:text-violet-700">{item.country} · {item.taxType}</span>
                              <span className="text-[9px] text-gray-400 ml-1.5">{item.periodLabel}</span>
                              <span className="text-[9px] text-emerald-500 ml-1">paid</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                              <span className="text-[10px] font-semibold text-gray-600 tabular-nums">{fmtItem(item.usdAmount)}</span>
                              {item.currency !== "USD" && (
                                <span className="text-[9px] text-gray-400 tabular-nums">{item.currency} {item.amount.toLocaleString("en-US")}</span>
                              )}
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Income column ── */}
              <div className="px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Income</span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: RECEIVABLE_COLOR }}>{fmt(totalIncome)}</span>
                </div>

                {totalIncome === 0 && (
                  <p className="text-[11px] text-gray-400 italic">No income this month</p>
                )}

                <div className="space-y-3">
                  {collectedInvoices.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0 bg-emerald-500" />
                          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Collected</span>
                        </div>
                        <span className="text-[10px] font-semibold text-emerald-600 tabular-nums">{fmt(clickedBar.collected)}</span>
                      </div>
                      <div className="space-y-0.5">
                        {collectedInvoices.map(inv => (
                          <Link key={inv.id} href={`/records/${inv.id}`}
                            className="flex items-center justify-between px-2.5 py-1.5 bg-emerald-50/40 rounded-lg hover:bg-emerald-50 transition-colors group">
                            <span className="text-[10px] font-medium text-gray-700 group-hover:text-emerald-700">{inv.vendor}</span>
                            <div className="flex items-center gap-2">
                              {inv.referenceNumber && (
                                <span className="text-[9px] font-mono text-gray-300">#{inv.referenceNumber}</span>
                              )}
                              <span className="text-[10px] text-gray-500 tabular-nums">{inv.currency} {inv.amount.toLocaleString("en-US")}</span>
                              <span className="text-[9px] font-bold text-emerald-500">✓</span>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {pendingInvoices.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0 bg-amber-400" />
                          <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">
                            {clickedIsProjected ? "Expected" : "Pending"}
                          </span>
                        </div>
                        <span className="text-[10px] font-semibold text-amber-600 tabular-nums">{fmt(clickedBar.pending)}</span>
                      </div>
                      <div className="space-y-0.5">
                        {pendingInvoices.map(inv => (
                          <Link key={inv.id} href={`/records/${inv.id}`}
                            className="flex items-center justify-between px-2.5 py-1.5 bg-amber-50/40 rounded-lg hover:bg-amber-50 transition-colors group">
                            <span className="text-[10px] font-medium text-gray-700 group-hover:text-amber-700">{inv.vendor}</span>
                            <div className="flex items-center gap-2">
                              {inv.referenceNumber && (
                                <span className="text-[9px] font-mono text-gray-300">#{inv.referenceNumber}</span>
                              )}
                              <span className="text-[10px] text-gray-500 tabular-nums">{inv.currency} {inv.amount.toLocaleString("en-US")}</span>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {clickedBar.capitalUsd > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0 bg-blue-500" />
                          <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Capital injection</span>
                        </div>
                        <span className="text-[10px] font-semibold text-blue-600 tabular-nums">{fmt(clickedBar.capitalUsd)}</span>
                      </div>
                      <div className="px-2.5 py-1.5 bg-blue-50/40 rounded-lg">
                        <span className="text-[10px] text-gray-500">Equity / capital inflow recorded this month</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        );
      })()}
    </div>
  );
}
