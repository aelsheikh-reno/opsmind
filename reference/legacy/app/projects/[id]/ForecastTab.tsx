"use client";

import { useMemo, useState, useEffect } from "react";

// ── Local types (subset of what ProjectDetailClient uses) ─────────────────────

type TeamMember = {
  id: string; name: string; costPerHour: number | null;
  billingRate: number | null; currency: string; hidden: boolean;
  allocationPercent: number | null;
  person: { name: string } | null;
};

type MonthAllocation = {
  id?: string; memberName: string; startDate: string; endDate: string; allocationPercent: number;
};

type TimesheetEntry = {
  employeeName: string; hoursLogged: number; hourlyRate: number | null; currency: string;
};

type TimesheetImport = { id: string; month: string; entries: TimesheetEntry[] };

type Milestone = { id: string; completionPercent: number | null; completedAt: string | null };

export type ForecastTabProps = {
  projectId: string;
  projectCurrency: string;
  contractValue: number | null;
  endDate: string | null;
  startDate: string | null;
  teamMembers: TeamMember[];
  allocations: MonthAllocation[];
  timesheets: TimesheetImport[];
  fxRates: Record<string, number>;
  milestones: Milestone[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function toUSD(amount: number, from: string, rates: Record<string, number>): number {
  if (!amount || from === "USD") return amount;
  return amount / (rates[from] ?? 1);
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en", { month: "short", year: "2-digit" });
}

function addMonths(ym: string, n: number): string {
  let [y, m] = ym.split("-").map(Number);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1)  { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function genMonths(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ey, em] = to.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

function getAlloc(name: string, month: string, allocs: MonthAllocation[]): number | null {
  const candidates = allocs.filter(a =>
    a.memberName.toLowerCase() === name.toLowerCase() &&
    month >= a.startDate.slice(0, 7) &&
    month <= a.endDate.slice(0, 7)
  );
  if (!candidates.length) return null;
  // Prefer a record that is exactly this one month (per-month override wins over spanning).
  const exact = candidates.find(
    a => a.startDate.slice(0, 7) === month && a.endDate.slice(0, 7) === month,
  );
  return (exact ?? candidates[0]).allocationPercent;
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent, warn, ok }: {
  label: string; value: string; sub?: string;
  accent?: boolean; warn?: boolean; ok?: boolean;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${
      warn ? "border-red-200 bg-red-50"
      : ok  ? "border-green-200 bg-green-50"
      : "border-surface-border bg-white"
    }`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">{label}</p>
      <p className={`text-lg font-bold tabular-nums leading-tight ${
        warn ? "text-red-700" : ok ? "text-green-700" : accent ? "text-indigo-700" : "text-gray-900"
      }`}>{value}</p>
      {sub && <p className={`text-[10px] mt-0.5 ${warn ? "text-red-500" : ok ? "text-green-600" : "text-gray-400"}`}>{sub}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type AiSuggestion = {
  overall_reasoning: string;
  cost_warning: boolean;
  suggestions: {
    memberName: string;
    months: { ym: string; allocationPercent: number }[];
  }[];
};

export default function ForecastTab({
  projectId, projectCurrency, contractValue, endDate,
  teamMembers, allocations, timesheets, fxRates, milestones,
}: ForecastTabProps) {
  const now = new Date();
  const [aiResult, setAiResult] = useState<AiSuggestion | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [hoveredBar, setHoveredBar] = useState<{ month: string; cost: number; x: number; h: number } | null>(null);

  // Load persisted suggestion on mount
  useEffect(() => {
    fetch(`/api/projects/${projectId}/ai-suggestion`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setAiResult(data as AiSuggestion); })
      .catch(() => {});
  }, [projectId]);

  async function fetchAiSuggestions() {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/forecast-suggestions`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setAiError(data.error ?? "Request failed"); return; }
      setAiResult(data as AiSuggestion);
      // Persist so it survives page refreshes; each generation overwrites the previous
      fetch(`/api/projects/${projectId}/ai-suggestion`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).catch(() => {});
    } catch {
      setAiError("Network error, please try again.");
    } finally {
      setAiLoading(false);
    }
  }
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Active members with a cost rate
  const active = useMemo(
    () => teamMembers.filter(m => !m.hidden && (m.costPerHour ?? 0) > 0),
    [teamMembers],
  );

  // Name lookup: team member name OR linked person name → member, so timesheet
  // entries imported under the person's system name still resolve correctly.
  const memberByName = useMemo(() => {
    const map = new Map<string, typeof active[number]>();
    for (const m of active) {
      map.set(m.name.toLowerCase(), m);
      if (m.person?.name) map.set(m.person.name.toLowerCase(), m);
    }
    return map;
  }, [active]);

  // Allocations with memberName resolved to the canonical team member name so
  // getAlloc() works even when a record was stored under a person-name alias.
  const normalizedAllocations = useMemo(
    () => allocations.map(a => {
      const mem = memberByName.get(a.memberName.toLowerCase());
      return mem ? { ...a, memberName: mem.name } : a;
    }),
    [allocations, memberByName],
  );

  // Forecast horizon: project end date or +6 months, whichever is further
  const horizonEnd = useMemo(() => {
    const fallback = addMonths(currentMonth, 5);
    if (!endDate) return fallback;
    const ed = endDate.slice(0, 7);
    return ed > currentMonth ? ed : fallback;
  }, [endDate, currentMonth]);

  // Window start: earliest timesheet month or 3 months back
  const windowStart = useMemo(() => {
    const tsMonths = timesheets.map(t => t.month).sort();
    const earliest = tsMonths[0] ?? currentMonth;
    const threeBack = addMonths(currentMonth, -3);
    return earliest < threeBack ? threeBack : earliest;
  }, [timesheets, currentMonth]);

  const allMonths = useMemo(() => genMonths(windowStart, horizonEnd), [windowStart, horizonEnd]);

  // Per-month data
  type MemberRow = {
    name: string; allocPct: number | null; projHours: number; projCost: number;
    actHours: number; actCost: number;
  };
  type MonthDatum = {
    month: string; label: string; isPast: boolean; isCurrent: boolean; isFuture: boolean;
    actCost: number; projCost: number; dispCost: number;
    members: MemberRow[]; hasGap: boolean;
  };

  const data = useMemo((): MonthDatum[] => {
    return allMonths.map(month => {
      const isPast    = month < currentMonth;
      const isCurrent = month === currentMonth;
      const isFuture  = month > currentMonth;
      const ts = timesheets.find(t => t.month === month);

      // Actual cost from timesheets.
      // Use costPerHour (the member's cost rate) as the primary rate — hourlyRate on
      // entries is the billing rate, not the cost rate. Also match by linked person name
      // so entries imported under a different display name still resolve correctly.
      let actCost = 0;
      const actByName: Record<string, { h: number; c: number }> = {};
      if (ts) {
        for (const e of ts.entries) {
          const mem = memberByName.get(e.employeeName.toLowerCase());
          const rate = mem?.costPerHour ?? e.hourlyRate ?? 0;
          const cur  = mem?.currency || e.currency || "USD";
          const cost = toUSD(e.hoursLogged * rate, cur, fxRates);
          actCost += cost;
          // Store under canonical team member name for member-row matching below
          const key = mem?.name ?? e.employeeName;
          if (!actByName[key]) actByName[key] = { h: 0, c: 0 };
          actByName[key].h += e.hoursLogged;
          actByName[key].c += cost;
        }
      }

      // Projected cost from allocations
      let projCost = 0;
      const members: MemberRow[] = active.map(m => {
        const alloc = getAlloc(m.name, month, normalizedAllocations);
        const hours = alloc != null ? Math.round(160 * alloc / 100) : 0;
        const cost  = alloc != null ? toUSD((m.costPerHour ?? 0) * hours, m.currency, fxRates) : 0;
        projCost += cost;
        const act = actByName[m.name] ?? { h: 0, c: 0 };
        return { name: m.name, allocPct: alloc, projHours: hours, projCost: cost, actHours: act.h, actCost: act.c };
      });

      const dispCost = isPast ? actCost : projCost;
      const hasGap   = isFuture && members.some(r => r.allocPct == null);

      return { month, label: monthLabel(month), isPast, isCurrent, isFuture, actCost, projCost, dispCost, members, hasGap };
    });
  }, [allMonths, timesheets, active, normalizedAllocations, fxRates, currentMonth]);

  // Totals — computed independently of the chart window so they cover ALL timesheets
  // and ALL future months up to the project end date.
  const { costToDate, projRemaining, totalEst } = useMemo(() => {
    // Actual spend: every timesheet ever (not just those in the chart window)
    let costToDate = 0;
    for (const ts of timesheets) {
      for (const e of ts.entries) {
        const mem = memberByName.get(e.employeeName.toLowerCase());
        const rate = mem?.costPerHour ?? e.hourlyRate ?? 0;
        const cur  = mem?.currency || e.currency || "USD";
        costToDate += toUSD(e.hoursLogged * rate, cur, fxRates);
      }
    }

    // Projected: current month's unspent portion + every future month through project end date
    let projRemaining = 0;
    const forecastEnd = endDate ? endDate.slice(0, 7) : addMonths(currentMonth, 5);

    // Current month: add (allocated hours – already logged hours) × rate per member
    const currentTs = timesheets.find(t => t.month === currentMonth);
    const currentActHours: Record<string, number> = {};
    if (currentTs) {
      for (const e of currentTs.entries) {
        const mem = memberByName.get(e.employeeName.toLowerCase());
        const key = mem?.name ?? e.employeeName;
        currentActHours[key] = (currentActHours[key] ?? 0) + e.hoursLogged;
      }
    }
    for (const m of active) {
      const alloc = getAlloc(m.name, currentMonth, normalizedAllocations);
      if (alloc == null) continue;
      const allocatedHours = Math.round(160 * alloc / 100);
      const loggedHours = currentActHours[m.name] ?? 0;
      const remainingHours = Math.max(0, allocatedHours - loggedHours);
      projRemaining += toUSD((m.costPerHour ?? 0) * remainingHours, m.currency, fxRates);
    }

    // Future months: every month from next month through project end date
    const futureStart = addMonths(currentMonth, 1);
    if (futureStart <= forecastEnd) {
      for (const month of genMonths(futureStart, forecastEnd)) {
        for (const m of active) {
          const alloc = getAlloc(m.name, month, normalizedAllocations);
          if (alloc == null) continue;
          const hours = Math.round(160 * alloc / 100);
          projRemaining += toUSD((m.costPerHour ?? 0) * hours, m.currency, fxRates);
        }
      }
    }

    return { costToDate, projRemaining, totalEst: costToDate + projRemaining };
  }, [timesheets, memberByName, fxRates, currentMonth, endDate, active, normalizedAllocations]);

  const futureMths = useMemo(() => data.filter(d => d.isFuture), [data]);

  // Milestone completion
  const donePct = useMemo(() => {
    if (!milestones.length) return null;
    return Math.round(milestones.filter(m => m.completedAt != null).length / milestones.length * 100);
  }, [milestones]);

  // Contract value in USD
  const budgetUSD = contractValue != null ? toUSD(contractValue, projectCurrency, fxRates) : null;
  const budgetGap = budgetUSD != null ? budgetUSD - totalEst : null;

  // Months remaining
  const monthsLeft = useMemo(() => {
    if (!endDate) return null;
    const ed = new Date(endDate);
    return Math.max(0, (ed.getFullYear() - now.getFullYear()) * 12 + (ed.getMonth() - now.getMonth()));
  }, [endDate]);

  // Recommendations: members with gaps in future months
  const recs = useMemo(() => {
    return active
      .map(m => {
        // Suggested % = last known allocation (most recent month), else 100
        const lastAlloc = normalizedAllocations
          .filter(a => a.memberName.toLowerCase() === m.name.toLowerCase())
          .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
        const sugPct = lastAlloc?.allocationPercent ?? m.allocationPercent ?? 100;

        const gapMonths = futureMths
          .filter(md => getAlloc(m.name, md.month, normalizedAllocations) == null)
          .map(md => md.label);

        if (!gapMonths.length) return null;

        const addedCost = toUSD((m.costPerHour ?? 0) * 160 * sugPct / 100, m.currency, fxRates) * gapMonths.length;
        return { name: m.name, gapMonths, sugPct, addedCost };
      })
      .filter(Boolean) as { name: string; gapMonths: string[]; sugPct: number; addedCost: number }[];
  }, [active, futureMths, normalizedAllocations, fxRates]);

  const totalAddedIfFilled = recs.reduce((s, r) => s + r.addedCost, 0);

  // Chart
  const CHART_H = 110;
  const maxCost = Math.max(...data.map(d => Math.max(d.actCost, d.projCost)), 1);
  const barCount = data.length;
  const barW = Math.max(16, Math.min(36, Math.floor(560 / barCount) - 4));
  const chartW = barCount * (barW + 4) + 20;

  if (active.length === 0) {
    return (
      <div className="rounded-xl border border-surface-border bg-white px-8 py-16 text-center">
        <p className="text-sm text-gray-400">Add team members with hourly cost rates to see a cost forecast.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Cost to date"         value={fmt(costToDate)}    sub="actual spend" />
        <KpiCard label="Projected remaining"  value={fmt(projRemaining)} sub="from set allocations" accent />
        <KpiCard label="Total estimated"      value={fmt(totalEst)}      sub="actual + projected" />
        {budgetUSD != null ? (
          <KpiCard
            label="Contract value"
            value={fmt(budgetUSD)}
            sub={budgetGap != null
              ? (budgetGap >= 0 ? `${fmt(budgetGap)} under budget` : `${fmt(Math.abs(budgetGap))} over budget`)
              : undefined}
            warn={budgetGap != null && budgetGap < 0}
            ok={budgetGap != null && budgetGap >= 0}
          />
        ) : (
          <KpiCard
            label="Months remaining"
            value={monthsLeft != null ? `${monthsLeft} mo` : "Open-ended"}
            sub={donePct != null ? `${donePct}% milestones done` : endDate ? `due ${new Date(endDate).toLocaleDateString("en", { month: "short", year: "numeric" })}` : "No end date set"}
          />
        )}
      </div>

      {/* ── Burn rate chart ── */}
      <div className="bg-white border border-surface-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Monthly burn rate</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Actual spend (past) vs projected cost (future)</p>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-2 rounded-sm bg-indigo-500 inline-block" />Actual
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-2 rounded-sm bg-indigo-200 inline-block" />Projected
            </span>
            {data.some(d => d.hasGap) && (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-amber-300 inline-block" />Gap
              </span>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${chartW} ${CHART_H + 22}`}
            style={{ height: CHART_H + 22, minWidth: chartW }}
            className="w-full"
          >
            {data.map((d, i) => {
              const x = 10 + i * (barW + 4);
              // Past: show actual spend. Current + future: show projected (allocation-based).
              // Actual spend for the current month is already shown in the "Cost to date" KPI.
              const cost = d.isPast ? d.actCost : d.projCost;
              const h = Math.max(2, (cost / maxCost) * CHART_H);
              const fill = d.isPast
                ? "#6366f1"
                : d.isCurrent
                ? "#818cf8"
                : d.hasGap ? "#fcd34d"
                : "#c7d2fe";
              const isHovered = hoveredBar?.month === d.month;
              return (
                <g
                  key={d.month}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHoveredBar({ month: d.month, cost, x, h })}
                  onMouseLeave={() => setHoveredBar(null)}
                >
                  <rect x={x} y={CHART_H - h} width={barW} height={h} rx={3} fill={fill} opacity={isHovered ? 0.85 : 1} />
                  <text
                    x={x + barW / 2} y={CHART_H + 15}
                    textAnchor="middle" fontSize={7.5}
                    fill={d.isCurrent ? "#6366f1" : "#9ca3af"}
                    fontWeight={d.isCurrent ? "700" : "400"}
                  >
                    {d.label}
                  </text>
                  {/* Cost label inside all tall bars */}
                  {h > 22 && cost > 0 && (
                    <text
                      x={x + barW / 2} y={CHART_H - h + 11}
                      textAnchor="middle" fontSize={7} fontWeight="600"
                      fill={d.isPast || d.isCurrent ? "white" : d.hasGap ? "#92400e" : "#4338ca"}
                    >
                      {fmt(cost)}
                    </text>
                  )}
                </g>
              );
            })}
            <line x1={8} x2={chartW - 4} y1={CHART_H} y2={CHART_H} stroke="#f3f4f6" strokeWidth={1} />
            {/* Hover tooltip — rendered last so it appears above all bars */}
            {hoveredBar && hoveredBar.cost > 0 && (() => {
              const tipW = 58;
              const tipH = 22;
              const tipX = Math.min(Math.max(hoveredBar.x + barW / 2 - tipW / 2, 2), chartW - tipW - 2);
              const tipY = Math.max(CHART_H - hoveredBar.h - tipH - 6, 2);
              return (
                <g pointerEvents="none">
                  <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={4} fill="#1f2937" />
                  <text x={tipX + tipW / 2} y={tipY + 14} textAnchor="middle" fontSize={8.5} fill="white" fontWeight="600">
                    {fmt(hoveredBar.cost)}
                  </text>
                </g>
              );
            })()}
          </svg>
        </div>
      </div>

      {/* ── Resource cost forecast table ── */}
      {futureMths.length > 0 && (
        <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border">
            <h3 className="text-sm font-semibold text-gray-800">Resource cost forecast</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">Projected monthly cost per team member based on allocation %</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-surface-inset border-b border-surface-border">
                  <th className="sticky left-0 bg-surface-inset px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide min-w-[160px]">Member</th>
                  {futureMths.map(md => (
                    <th key={md.month} className={`px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wide min-w-[90px] ${md.isCurrent ? "text-indigo-500" : "text-gray-400"}`}>
                      <div>{md.label}</div>
                      {md.hasGap && <div className="text-amber-400 text-[9px] font-normal">⚠ gaps</div>}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wide min-w-[90px]">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {active.map(member => {
                  let memberTotal = 0;
                  return (
                    <tr key={member.id} className="hover:bg-surface-hover/30 transition-colors">
                      <td className="sticky left-0 bg-white px-4 py-3">
                        <div className="font-medium text-gray-800 text-[11px]">{member.name}</div>
                        <div className="text-[10px] text-gray-400">${member.costPerHour}/hr · {Math.round(160)} h cap</div>
                      </td>
                      {futureMths.map(md => {
                        const row = md.members.find(r => r.name === member.name);
                        const alloc = row?.allocPct ?? null;
                        const cost  = row?.projCost ?? 0;
                        memberTotal += cost;
                        return (
                          <td key={md.month} className={`px-3 py-3 text-center ${alloc == null ? "bg-amber-50" : ""}`}>
                            {alloc != null ? (
                              <div>
                                <div className="font-semibold text-gray-700">{alloc}%</div>
                                <div className="text-[10px] text-gray-400 mt-0.5">{Math.round(160 * alloc / 100)}h · {fmt(cost)}</div>
                              </div>
                            ) : (
                              <span className="text-amber-400 text-base leading-none" title="No allocation set">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-right font-semibold text-gray-700">{fmt(memberTotal)}</td>
                    </tr>
                  );
                })}

                {/* Monthly total row */}
                <tr className="bg-surface-inset border-t-2 border-surface-border">
                  <td className="sticky left-0 bg-surface-inset px-4 py-2.5 text-[11px] font-semibold text-gray-600">Monthly total</td>
                  {futureMths.map(md => (
                    <td key={md.month} className="px-3 py-2.5 text-center">
                      <div className="text-[11px] font-semibold text-gray-800">{fmt(md.projCost)}</div>
                      {md.hasGap && <div className="text-[9px] text-amber-500">incomplete</div>}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right text-[11px] font-semibold text-indigo-700">{fmt(projRemaining)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Allocation recommendations — hidden when AI suggestions are loaded (AI is more accurate) ── */}
      {recs.length > 0 && !aiResult ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2.5L13.5 12.5H2.5L8 2.5Z" stroke="#d97706" strokeWidth="1.4" strokeLinejoin="round" fill="none" />
              <path d="M8 6.5v3" stroke="#d97706" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="8" cy="11" r="0.8" fill="#d97706" />
            </svg>
            <h3 className="text-sm font-semibold text-amber-800">Recommended allocations to complete the project</h3>
          </div>

          <p className="text-[11px] text-amber-700">
            {recs.length === 1
              ? `1 team member has months with no allocation set.`
              : `${recs.length} team members have months with no allocation set.`}{" "}
            Based on each member&apos;s most recent allocation, here&apos;s what to set:
          </p>

          <div className="space-y-2.5">
            {recs.map(rec => (
              <div key={rec.name} className="bg-white border border-amber-100 rounded-lg px-4 py-3 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold text-gray-800">{rec.name}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Set to <span className="font-semibold text-indigo-700">{rec.sugPct}%</span> for:{" "}
                    {rec.gapMonths.join(", ")}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] font-semibold text-gray-700">{fmt(rec.addedCost)}</p>
                  <p className="text-[9px] text-gray-400">added cost</p>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-amber-200 pt-3 flex items-center justify-between">
            <p className="text-[11px] text-amber-700">
              If all gaps are filled at suggested rates:
            </p>
            <div className="text-right">
              <p className="text-sm font-bold text-amber-800">{fmt(totalEst + totalAddedIfFilled)}</p>
              <p className="text-[10px] text-amber-600">new total estimated cost</p>
            </div>
          </div>
          {budgetUSD != null && (
            <p className={`text-[11px] font-medium ${budgetUSD >= totalEst + totalAddedIfFilled ? "text-green-700" : "text-red-600"}`}>
              {budgetUSD >= totalEst + totalAddedIfFilled
                ? `✓ Still within contract budget (${fmt(budgetUSD - totalEst - totalAddedIfFilled)} to spare)`
                : `⚠ Projected to exceed contract budget by ${fmt(totalEst + totalAddedIfFilled - budgetUSD)}`}
            </p>
          )}
        </div>
      ) : futureMths.length > 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 flex items-center gap-3">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="#16a34a" strokeWidth="1.4" fill="none" />
            <path d="M5 8l2.5 2.5L11 5" stroke="#16a34a" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <p className="text-[11px] font-semibold text-green-800">Allocation coverage is complete</p>
            <p className="text-[10px] text-green-700 mt-0.5">All team members have allocations set through the forecast period. Estimated cost to complete: <span className="font-semibold">{fmt(projRemaining)}</span>.</p>
          </div>
        </div>
      ) : null}

      {/* ── AI allocation suggestions ── */}
      {endDate && futureMths.length > 0 && (
        <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <path d="M7.5 1.5C7.5 1.5 9 4 9 6.5C9 8 8.5 9 7.5 9.5C6.5 9 6 8 6 6.5C6 4 7.5 1.5 7.5 1.5Z" fill="#6366f1" opacity="0.7"/>
                  <path d="M7.5 9.5V13.5M5 11.5H10" stroke="#6366f1" strokeWidth="1.3" strokeLinecap="round"/>
                  <path d="M3 6C1.5 6.5 1 7.5 1.5 8.5C2 9.5 3.5 9.5 5 9" stroke="#6366f1" strokeWidth="1.1" strokeLinecap="round" opacity="0.6"/>
                  <path d="M12 6C13.5 6.5 14 7.5 13.5 8.5C13 9.5 11.5 9.5 10 9" stroke="#6366f1" strokeWidth="1.1" strokeLinecap="round" opacity="0.6"/>
                </svg>
                <h3 className="text-sm font-semibold text-gray-800">AI allocation suggestions</h3>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Budget-aware recommendations for all remaining months — considers actual spend, contract value, and milestone progress
              </p>
            </div>
            <button
              onClick={fetchAiSuggestions}
              disabled={aiLoading}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors shrink-0"
            >
              {aiLoading ? (
                <>
                  <svg className="animate-spin" width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="5" stroke="white" strokeWidth="1.5" strokeDasharray="8 6" />
                  </svg>
                  Thinking…
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 1L7.2 4.2L10.5 4.5L8.1 6.6L8.9 10L6 8.3L3.1 10L3.9 6.6L1.5 4.5L4.8 4.2L6 1Z" stroke="white" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
                  </svg>
                  {aiResult ? "Regenerate" : "Get suggestions"}
                </>
              )}
            </button>
          </div>

          {aiError && (
            <div className="px-5 py-4 text-sm text-red-600 bg-red-50 border-b border-red-100">{aiError}</div>
          )}

          {!aiResult && !aiLoading && !aiError && (
            <div className="px-5 py-8 text-center text-sm text-gray-400">
              Click &ldquo;Get suggestions&rdquo; to ask the AI to recommend allocation percentages
              for each team member through the project end date.
            </div>
          )}

          {aiLoading && (
            <div className="px-5 py-10 flex items-center justify-center gap-3 text-sm text-gray-400">
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="10 8" />
              </svg>
              Analysing project data and generating recommendations…
            </div>
          )}

          {aiResult && (
            <div className="divide-y divide-surface-border">
              {/* Reasoning */}
              <div className={`px-5 py-4 flex gap-3 ${aiResult.cost_warning ? "bg-amber-50" : "bg-indigo-50/40"}`}>
                <svg className="shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="6" stroke={aiResult.cost_warning ? "#d97706" : "#6366f1"} strokeWidth="1.3" fill="none"/>
                  <path d="M7 4v4M7 9.5v.5" stroke={aiResult.cost_warning ? "#d97706" : "#6366f1"} strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <p className={`text-[11px] leading-relaxed ${aiResult.cost_warning ? "text-amber-800" : "text-indigo-800"}`}>
                  {aiResult.overall_reasoning}
                </p>
              </div>

              {/* Per-member suggestion table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-surface-inset border-b border-surface-border">
                      <th className="sticky left-0 bg-surface-inset px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide min-w-[150px]">Member</th>
                      {futureMths.map(md => (
                        <th key={md.month} className="px-3 py-2.5 text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wide min-w-[80px]">
                          {md.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {aiResult.suggestions.map(sug => {
                      const member = active.find(m => m.name.toLowerCase() === sug.memberName.toLowerCase());
                      return (
                        <tr key={sug.memberName} className="hover:bg-surface-hover/30 transition-colors">
                          <td className="sticky left-0 bg-white px-4 py-3">
                            <div className="font-medium text-gray-800 text-[11px]">{sug.memberName}</div>
                            {member && <div className="text-[10px] text-gray-400">${member.costPerHour}/hr</div>}
                          </td>
                          {futureMths.map(md => {
                            const mo = sug.months.find(x => x.ym === md.month);
                            const pct = mo?.allocationPercent ?? null;
                            const existing = getAlloc(sug.memberName, md.month, normalizedAllocations);
                            const changed = pct != null && existing != null && pct !== existing;
                            const isNew = pct != null && existing == null;
                            return (
                              <td key={md.month} className="px-3 py-3 text-center">
                                {pct != null ? (
                                  <div>
                                    <div className={`font-semibold text-sm ${
                                      changed ? "text-amber-600" : isNew ? "text-indigo-600" : "text-gray-700"
                                    }`}>
                                      {pct}%
                                    </div>
                                    {changed && (
                                      <div className="text-[9px] text-gray-400 mt-0.5">was {existing}%</div>
                                    )}
                                    {isNew && (
                                      <div className="text-[9px] text-indigo-400 mt-0.5">new</div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Cost impact */}
              {(() => {
                const sugCost = aiResult.suggestions.reduce((total, sug) => {
                  const member = active.find(m => m.name.toLowerCase() === sug.memberName.toLowerCase());
                  if (!member) return total;
                  return total + sug.months.reduce((s, mo) => {
                    const hours = Math.round(160 * mo.allocationPercent / 100);
                    return s + toUSD((member.costPerHour ?? 0) * hours, member.currency, fxRates);
                  }, 0);
                }, 0);
                const budgetUSD2 = contractValue != null ? toUSD(contractValue, projectCurrency, fxRates) : null;
                const newTotal = costToDate + sugCost;
                const overBudget = budgetUSD2 != null && newTotal > budgetUSD2;
                return (
                  <div className={`px-5 py-3 flex items-center justify-between text-[11px] ${overBudget ? "bg-red-50" : "bg-surface-inset"}`}>
                    <span className="text-gray-500">Projected total cost with AI suggestions applied</span>
                    <div className="text-right">
                      <span className={`font-bold ${overBudget ? "text-red-700" : "text-gray-800"}`}>{fmt(newTotal)}</span>
                      {budgetUSD2 != null && (
                        <div className={`text-[10px] ${overBudget ? "text-red-500" : "text-green-600"}`}>
                          {overBudget
                            ? `${fmt(newTotal - budgetUSD2)} over contract`
                            : `${fmt(budgetUSD2 - newTotal)} under contract`}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
