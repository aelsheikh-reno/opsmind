"use client";

import { useState, useMemo } from "react";
import type { Expense, ExpenseAttachment, Person } from "@prisma/client";

type PersonStub = Pick<Person, "id" | "name" | "jobTitle">;
type ExpenseRow = Expense & { attachments: ExpenseAttachment[]; person: PersonStub | null };

const KNOWN_COLORS: Record<string, string> = {
  Supplies:          "#6366f1",
  Travel:            "#f59e0b",
  "Food & Beverage": "#f97316",
  SaaS:              "#14b8a6",
  Other:             "#9ca3af",
};

const PALETTE = [
  "#a78bfa", "#ef4444", "#10b981", "#3b82f6", "#ec4899",
  "#06b6d4", "#84cc16", "#f43f5e", "#64748b", "#e879f9",
  "#fb923c", "#34d399", "#60a5fa", "#f472b6", "#22d3ee",
];

function typeColor(type: string): string {
  if (KNOWN_COLORS[type]) return KNOWN_COLORS[type];
  let h = 0;
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function toUSD(amount: number, currency: string, rates: Record<string, number>): number {
  if (currency === "USD") return amount;
  const rate = rates[currency];
  return rate ? amount / rate : 0;
}

function expenseToUSD(
  e: { amount: number | null; currency: string; dueOn: Date | null; asanaCreatedAt: Date | null },
  monthRates: Record<string, Record<string, number>>,
  liveRates: Record<string, number>,
): number {
  if (e.amount == null) return 0;
  if (e.currency === "USD") return e.amount;
  const d = e.dueOn ?? e.asanaCreatedAt;
  const key = d
    ? `${new Date(d).getFullYear()}-${String(new Date(d).getMonth() + 1).padStart(2, "0")}`
    : null;
  const rates = (key && monthRates[key]) ? monthRates[key] : liveRates;
  return toUSD(e.amount, e.currency, rates);
}

function fmtK(v: number) {
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`;
  return `$${Math.round(v)}`;
}

type MonthData = {
  key: string;   // YYYY-MM
  label: string; // "Jan 26"
  year: number;
  total: number;
  byType: Record<string, number>;
  currencies: Set<string>;
  items: ExpenseRow[];
};

type Range = "3m" | "6m" | "12m" | "all";

export default function ExpensesChart({
  expenses,
  rates,
  monthRates,
  ratesSyncedAt,
}: {
  expenses: ExpenseRow[];
  rates: Record<string, number>;
  monthRates: Record<string, Record<string, number>>;
  ratesSyncedAt: string | null;
}) {
  const [clicked, setClicked] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("12m");
  const [yearFilter, setYearFilter] = useState<string>("all");

  const withAmount = expenses.filter((e) => e.amount != null);
  if (withAmount.length === 0) return null;

  // ── Build full month map ──────────────────────────────────────────────────
  const allMonthMap = useMemo(() => {
    const map = new Map<string, MonthData>();
    for (const e of withAmount) {
      const d = e.dueOn ?? e.asanaCreatedAt;
      if (!d) continue;
      const date = new Date(d);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const label = date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
      const year = date.getFullYear();
      const usd = expenseToUSD(e, monthRates, rates);
      const type = e.expenseType ?? "Other";
      if (!map.has(key)) map.set(key, { key, label, year, total: 0, byType: {}, currencies: new Set(), items: [] });
      const m = map.get(key)!;
      m.total += usd;
      m.byType[type] = (m.byType[type] ?? 0) + usd;
      m.currencies.add(e.currency);
      m.items.push(e);
    }
    return map;
  }, [withAmount, rates]);

  const allMonths = Array.from(allMonthMap.values()).sort((a, b) => a.key.localeCompare(b.key));
  const availableYears = Array.from(new Set(allMonths.map((m) => m.year))).sort((a, b) => b - a);

  // ── Apply filters ─────────────────────────────────────────────────────────
  const now = new Date();
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const months = useMemo(() => {
    let filtered = allMonths;

    // Year filter
    if (yearFilter !== "all") {
      filtered = filtered.filter((m) => m.year === parseInt(yearFilter));
    }

    // Range filter (applied on top of year filter only when "all years")
    if (yearFilter === "all" && range !== "all") {
      const cutoff = new Date(now);
      if (range === "3m")  cutoff.setMonth(cutoff.getMonth() - 3);
      if (range === "6m")  cutoff.setMonth(cutoff.getMonth() - 6);
      if (range === "12m") cutoff.setMonth(cutoff.getMonth() - 12);
      const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;
      filtered = filtered.filter((m) => m.key >= cutoffKey);
    }

    return filtered;
  }, [allMonths, yearFilter, range]);

  const allTypes = useMemo(
    () => Array.from(new Set(months.flatMap((m) => Object.keys(m.byType)))),
    [months]
  );

  // Exchange rates note — currencies present in filtered data
  const presentCurrencies = useMemo(() => {
    const s = new Set<string>();
    for (const m of months) m.currencies.forEach((c) => s.add(c));
    return Array.from(s).filter((c) => c !== "USD" && rates[c]);
  }, [months, rates]);

  // ── SVG layout ────────────────────────────────────────────────────────────
  const W = 900, H = 280;
  const padL = 54, padR = 16, padT = 20, padB = 24;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const slotW  = months.length > 0 ? chartW / months.length : chartW;
  const barW   = Math.min(slotW * 0.55, 44);

  const maxVal = Math.max(...months.map((m) => m.total), 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const niceMax   = Math.ceil(maxVal / magnitude) * magnitude;

  function yPos(v: number) {
    return padT + chartH - (v / niceMax) * chartH;
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax);
  const clickedMonth = months.find((m) => m.key === clicked) ?? null;

  return (
    <div className="bg-white border border-surface-border rounded-xl p-5 mb-6">

      {/* ── Header ── */}
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Claimed expenses</h2>
        <p className="text-xs text-gray-400 mt-0.5">USD equivalent</p>
      </div>

      {/* ── Legend (matches CommitmentChart style) ── */}
      <div className="flex items-center gap-5 mb-3 flex-wrap">
        {allTypes.map((t) => (
          <span key={t} className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="w-2.5 h-2.5 rounded-sm inline-block shrink-0" style={{ background: typeColor(t) }} />
            {t}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-3 text-[10px] text-gray-400 italic">
          {presentCurrencies.length > 0 && (
            <span className="not-italic border-l border-gray-200 pl-3">
              Historical rates per month from settings
            </span>
          )}
          <span>Click a month to see details</span>
        </span>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Rolling range (only when year = all) */}
        {yearFilter === "all" && (
          <div className="flex items-center bg-surface-inset rounded-lg p-0.5 border border-surface-border gap-0.5">
            <span className="pl-2 pr-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Rolling</span>
            {(["3m", "6m", "12m", "all"] as Range[]).map((r) => {
              const active = range === r;
              return (
                <button
                  key={r}
                  onClick={() => { setRange(r); setClicked(null); }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    active ? "bg-white text-gray-900 shadow-sm border border-gray-200" : "text-gray-500 hover:text-gray-800"
                  }`}
                >
                  {r === "all" ? "All" : r === "3m" ? "3 mo" : r === "6m" ? "6 mo" : "12 mo"}
                </button>
              );
            })}
          </div>
        )}

        {/* Year filter */}
        {availableYears.length > 1 && (
          <div className="flex items-center bg-surface-inset rounded-lg p-0.5 border border-surface-border gap-0.5">
            <span className="pl-2 pr-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">FY</span>
            <button
              onClick={() => { setYearFilter("all"); setClicked(null); }}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                yearFilter === "all" ? "bg-white text-gray-900 shadow-sm border border-gray-200" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              All
            </button>
            {availableYears.map((y) => {
              const active = yearFilter === String(y);
              return (
                <button
                  key={y}
                  onClick={() => { setYearFilter(String(y)); setClicked(null); }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    active ? "bg-white text-gray-900 shadow-sm border border-gray-200" : "text-gray-500 hover:text-gray-800"
                  }`}
                >
                  {y}
                </button>
              );
            })}
          </div>
        )}

        <span className="text-xs text-gray-400 ml-auto">
          {months.length} month{months.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Chart ── */}
      {months.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-sm text-gray-400">No data for selected period</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
          {/* Y grid + labels */}
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={yPos(v)} y2={yPos(v)} stroke="#f3f4f6" strokeWidth="1" />
              <text x={padL - 6} y={yPos(v) + 3.5} textAnchor="end" fontSize="10" fill="#9ca3af">
                {fmtK(v)}
              </text>
            </g>
          ))}

          {/* Bars */}
          {months.map((m, i) => {
            const cx   = padL + (i + 0.5) * slotW;
            const bx   = cx - barW / 2;
            const isActive = m.key === clicked;

            // Stacked segments bottom-up
            const segs: { type: string; y: number; h: number }[] = [];
            let stackTop = yPos(0);
            for (const t of allTypes) {
              const val = m.byType[t] ?? 0;
              if (val <= 0) continue;
              const h = (val / niceMax) * chartH;
              stackTop -= h;
              segs.push({ type: t, y: stackTop, h });
            }
            const topY = segs.length > 0 ? segs[segs.length - 1].y : yPos(0);

            return (
              <g key={m.key} onClick={() => setClicked(isActive ? null : m.key)} className="cursor-pointer">
                {/* Column highlight */}
                <rect
                  x={cx - slotW / 2 + 1} width={slotW - 2}
                  y={padT} height={chartH}
                  fill={isActive ? "#f3f4f6" : "transparent"}
                  rx="3"
                />
                {/* Stacked bar segments */}
                {segs.map((seg, si) => (
                  <rect
                    key={seg.type}
                    x={bx} y={seg.y}
                    width={barW} height={seg.h}
                    fill={typeColor(seg.type)}
                    opacity={isActive ? 1 : 0.82}
                    rx={si === segs.length - 1 ? 3 : 0}
                    ry={si === segs.length - 1 ? 3 : 0}
                  />
                ))}

                {/* Total label above bar when active */}
                {isActive && (
                  <text x={cx} y={topY - 6} textAnchor="middle" fontSize="10" fill="#111827" fontWeight="700">
                    {fmtK(m.total)}
                  </text>
                )}

                {/* X axis month label */}
                <text
                  x={cx} y={H - 8}
                  textAnchor="middle" fontSize="10"
                  fill={isActive ? "#111827" : "#9ca3af"}
                  fontWeight={isActive ? "700" : "400"}
                >
                  {m.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {/* ── Detail panel ── */}
      {clickedMonth && (() => {
        const clickedRates = monthRates[clickedMonth.key] ?? rates;
        const RATE_ORDER = ["AED", "USD", "EGP"];
        const rateParts = RATE_ORDER
          .filter((c) => c !== "USD" && clickedRates[c])
          .map((c) => `1 USD = ${clickedRates[c].toFixed(2)} ${c}`);
        return (
        <div className="mt-4 pt-4 border-t border-surface-border">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">{clickedMonth.label}</span>
              <span className="text-xs text-gray-400 bg-surface-inset px-2 py-0.5 rounded-full">
                {clickedMonth.items.length} expense{clickedMonth.items.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-gray-900">
                ${clickedMonth.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <button
                onClick={() => setClicked(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-surface-hover transition-colors"
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          </div>
          {rateParts.length > 0 && (
            <p className="text-[10px] text-gray-400 mb-3">{rateParts.join(" · ")}</p>
          )}

          {/* Type breakdown chips */}
          <div className="flex flex-wrap gap-2 mb-3">
            {allTypes.filter((t) => (clickedMonth.byType[t] ?? 0) > 0).map((t) => (
              <div
                key={t}
                className="flex items-center gap-2 bg-surface-inset rounded-lg px-3 py-1.5"
                style={{ borderLeft: `3px solid ${typeColor(t)}` }}
              >
                <span className="text-[10px] font-semibold text-gray-500">{t}</span>
                <span className="text-xs font-bold text-gray-900">
                  ${clickedMonth.byType[t].toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
            ))}
          </div>

          {/* Item rows */}
          <div className="space-y-0.5">
            {clickedMonth.items.map((e) => {
              const usd   = expenseToUSD(e, monthRates, rates);
              const color = typeColor(e.expenseType ?? "Other");
              return (
                <div key={e.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-hover transition-colors">
                  {e.expenseType && (
                    <span
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: color + "22", color }}
                    >
                      {e.expenseType}
                    </span>
                  )}
                  <span className="text-xs text-gray-700 flex-1 truncate">{e.name}</span>
                  {e.person && (
                    <span className="text-[10px] text-gray-400 shrink-0">{e.person.name}</span>
                  )}
                  <span className="text-xs font-semibold text-gray-900 tabular-nums shrink-0">
                    ${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                  {e.currency !== "USD" && (
                    <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
                      {e.currency} {e.amount!.toLocaleString("en-US")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}
    </div>
  );
}
