"use client";

import { useMemo, useState, useEffect } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Entry = {
  employeeName: string;
  hoursLogged: number;
  milestoneId: string | null;
  serviceId: string | null;
  date: string | null;
};

type Member = {
  name: string;
  allocationPercent: number | null;
};

type Milestone = { id: string; name: string };
type Service = { id: string; name: string };

type AllocationRecord = {
  id?: string;
  memberName: string;
  startDate: string; // ISO or "YYYY-MM-DD"
  endDate: string;   // ISO or "YYYY-MM-DD"
  allocationPercent: number;
};

function expandAllocToMonths(a: AllocationRecord): string[] {
  const months: string[] = [];
  const start = new Date(a.startDate);
  const end = new Date(a.endDate);
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endUTC = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cur <= endUTC) {
    months.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return months;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HOURS_PER_MONTH = 160;

const MILESTONE_PALETTE = [
  "#818cf8", "#34d399", "#fb923c", "#f472b6",
  "#60a5fa", "#a78bfa", "#2dd4bf", "#fbbf24", "#f87171", "#38bdf8",
];
const NO_MILESTONE_COLOR = "#cbd5e1";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtHours(h: number) {
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}


function formatMonthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-AE", { month: "short", year: "2-digit" });
}

function utilColor(pct: number | null) {
  if (pct == null) return { bg: "bg-gray-50", text: "text-gray-400", bar: "bg-gray-200" };
  if (pct > 100)  return { bg: "bg-red-50",    text: "text-red-600",    bar: "bg-red-400"    };
  if (pct >= 80)  return { bg: "bg-green-50",  text: "text-green-700",  bar: "bg-green-500"  };
  if (pct >= 40)  return { bg: "bg-amber-50",  text: "text-amber-700",  bar: "bg-amber-400"  };
  return              { bg: "bg-gray-50",   text: "text-gray-500",   bar: "bg-gray-300"   };
}

// ── KPI chip ──────────────────────────────────────────────────────────────────

function KpiChip({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">{label}</span>
      <span className="text-sm font-bold text-gray-800">{value}</span>
      {sub && <span className="text-[10px] text-gray-400">{sub}</span>}
    </div>
  );
}

// ── By-Member view (horizontal stacked bars, capacity-aware) ──────────────────

function ByMemberView({
  entries,
  memberMap,
  milestones,
  services,
  allocations,
  isTM = false,
  isPS = false,
}: {
  entries: Entry[];
  memberMap: Map<string, Member>;
  milestones: Milestone[];
  services?: Service[];
  allocations: AllocationRecord[];
  isTM?: boolean;
  isPS?: boolean;
}) {
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [hoveredSeg, setHoveredSeg] = useState<{ personName: string; key: string; centerX: number } | null>(null);

  // For PS projects use services as the grouping entities, otherwise milestones
  const entities: (Milestone | Service)[] = isPS ? (services ?? []) : milestones;

  const milestoneColorMap = useMemo(() => {
    const m = new Map<string, string>();
    entities.forEach((e, i) => m.set(e.id, MILESTONE_PALETTE[i % MILESTONE_PALETTE.length]));
    return m;
  }, [entities]);  // eslint-disable-line react-hooks/exhaustive-deps

  const milestoneNameMap = useMemo(() => {
    const m = new Map<string, string>();
    entities.forEach(e => m.set(e.id, e.name));
    return m;
  }, [entities]);  // eslint-disable-line react-hooks/exhaustive-deps

  const allocMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of allocations) {
      for (const month of expandAllocToMonths(a)) {
        if (!m.has(`${a.memberName}|${month}`)) m.set(`${a.memberName}|${month}`, a.allocationPercent);
      }
    }
    return m;
  }, [allocations]);

  const people = useMemo(() => {
    const byMsAgg        = new Map<string, Map<string, number>>(); // person → milestone → hours
    const byMonAgg       = new Map<string, Map<string, number>>(); // person → month → hours
    const unassignedMon  = new Map<string, Map<string, number>>(); // person → month → unassigned hours
    for (const e of entries) {
      if (!byMsAgg.has(e.employeeName)) {
        byMsAgg.set(e.employeeName, new Map());
        byMonAgg.set(e.employeeName, new Map());
        unassignedMon.set(e.employeeName, new Map());
      }
      const groupId = isPS ? (e.serviceId ?? "__none__") : (e.milestoneId ?? "__none__");
      byMsAgg.get(e.employeeName)!.set(groupId, (byMsAgg.get(e.employeeName)!.get(groupId) ?? 0) + e.hoursLogged);
      if (e.date) {
        const month = e.date.slice(0, 7);
        byMonAgg.get(e.employeeName)!.set(month, (byMonAgg.get(e.employeeName)!.get(month) ?? 0) + e.hoursLogged);
        const unassigned = isPS ? !e.serviceId : !e.milestoneId;
        if (!isTM && unassigned) {
          unassignedMon.get(e.employeeName)!.set(month, (unassignedMon.get(e.employeeName)!.get(month) ?? 0) + e.hoursLogged);
        }
      }
    }

    return Array.from(byMsAgg.entries()).map(([name, byMs]) => {
      const member = memberMap.get(name);
      const byMonth = byMonAgg.get(name) ?? new Map<string, number>();
      const unassignedByMonth = new Map(
        [...(unassignedMon.get(name) ?? new Map()).entries()].sort(([a], [b]) => a.localeCompare(b))
      );
      const activeMonths = Array.from(byMonth.keys()).sort();

      // Capacity is based on assigned months (allocation records), not just months with logged time.
      // e.g. assigned 6 months at 100% → cap = 960h, even if only 3 months of timesheets imported.
      const assignedMonths = [
        ...new Set(
          allocations.filter(a => a.memberName === name).flatMap(a => expandAllocToMonths(a))
        ),
      ].sort();
      const capacityMonths = assignedMonths.length > 0 ? assignedMonths : activeMonths;
      const capacity = capacityMonths.reduce((sum, month) => {
        const alloc = (allocMap.get(`${name}|${month}`) ?? member?.allocationPercent ?? 100) / 100;
        return sum + HOURS_PER_MONTH * alloc;
      }, 0);

      const totalHours = Array.from(byMs.values()).reduce((s, h) => s + h, 0);
      const utilPct = capacity > 0 ? Math.round((totalHours / capacity) * 100) : null;
      return {
        name, byMs, byMonth, unassignedByMonth, activeMonths, assignedMonthCount: capacityMonths.length, totalHours,
        capacity: capacity > 0 ? capacity : null, utilPct,
      };
    }).sort((a, b) => b.totalHours - a.totalHours);
  }, [entries, memberMap, allocMap, allocations, isTM, isPS]);

  const usedMsIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) {
      const id = isPS ? e.serviceId : e.milestoneId;
      if (id) s.add(id);
    }
    return s;
  }, [entries, isPS]);

  const noneLabel = isPS ? "No service" : "No milestone";
  const entityLabel = isPS ? "By service" : "By milestone";
  const hasNoMilestone = !isTM && entries.some(e => !(isPS ? e.serviceId : e.milestoneId));
  const maxBarValue = Math.max(...people.map(p => Math.max(p.totalHours, p.capacity ?? 0)), 1);

  return (
    <div className="space-y-1.5">
      {/* Column headers */}
      <div className="flex items-center gap-3 pb-1.5 border-b border-gray-100">
        <div className="w-44 shrink-0 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Member</div>
        <div className="flex-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Hours logged vs capacity</div>
        <div className="w-36 shrink-0 text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Utilization</div>
      </div>

      {people.map(p => {
        const isExpanded = expandedName === p.name;
        const orderedKeys = [
          ...entities.map(e => e.id).filter(id => p.byMs.has(id)),
          ...(!isTM && p.byMs.has("__none__") ? ["__none__"] : []),
        ];
        const capacityWidthPct = p.capacity != null ? Math.min(100, (p.capacity / maxBarValue) * 100) : 100;
        const actualWidthPct   = Math.min(capacityWidthPct, (p.totalHours / maxBarValue) * 100);
        const overflowWidthPct = p.capacity != null && p.totalHours > p.capacity
          ? Math.min(100, (p.totalHours / maxBarValue) * 100) - capacityWidthPct
          : 0;
        const isOver = p.utilPct != null && p.utilPct > 100;
        const { bg, text } = utilColor(p.utilPct);

        return (
          <div key={p.name} className={`rounded-xl transition-colors ${isExpanded ? "bg-indigo-50/50 ring-1 ring-indigo-100" : "hover:bg-gray-50/80"}`}>
            {/* ── Clickable row ── */}
            <div
              className="flex items-center gap-3 px-2 py-2.5 cursor-pointer select-none"
              onClick={() => setExpandedName(n => n === p.name ? null : p.name)}
            >
              {/* Name */}
              <div className="w-44 shrink-0 flex items-start gap-1.5">
                <svg
                  width="10" height="10" viewBox="0 0 10 10" fill="none"
                  className={`shrink-0 mt-1 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                >
                  <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div className="min-w-0">
                  <span className="text-[11px] font-semibold text-gray-700 truncate block" title={p.name}>{p.name}</span>
                  <span className="text-[9px] text-gray-400">
                    {p.assignedMonthCount} month{p.assignedMonthCount !== 1 ? "s" : ""} · {fmtHours(p.totalHours)}
                  </span>
                  {!isTM && (p.byMs.get("__none__") ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-0.5 mt-0.5 text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                      <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M6 1L11 10H1L6 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M6 5v2M6 8.2v.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                      {fmtHours(p.byMs.get("__none__")!)} unassigned
                      {p.unassignedByMonth.size > 0 && (
                        <span className="font-normal text-amber-500 ml-0.5">
                          ({Array.from(p.unassignedByMonth.keys()).map(m => formatMonthLabel(m)).join(", ")})
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>

              {/* Bar */}
              {(() => {
                // Precompute center-x (% of outer bar width) for each segment
                let acc = 0;
                const segCenters = orderedKeys.map(key => {
                  const w = ((p.byMs.get(key) ?? 0) / p.totalHours) * actualWidthPct;
                  const cx = acc + w / 2;
                  acc += w;
                  return { key, cx };
                });

                const tooltip = hoveredSeg?.personName === p.name ? (() => {
                  const { key, centerX } = hoveredSeg;
                  const hrs  = p.byMs.get(key) ?? 0;
                  const pct  = Math.round((hrs / p.totalHours) * 100);
                  const isNone = key === "__none__";
                  const color  = isNone ? NO_MILESTONE_COLOR : (milestoneColorMap.get(key) ?? NO_MILESTONE_COLOR);
                  const label  = isNone ? noneLabel : (milestoneNameMap.get(key) ?? key);
                  const clampedLeft = Math.min(Math.max(centerX, 8), 92);
                  return (
                    <div
                      className="absolute bottom-full mb-2 z-20 pointer-events-none"
                      style={{ left: `${clampedLeft}%`, transform: "translateX(-50%)" }}
                    >
                      <div className="bg-gray-900 text-white rounded-xl px-3 py-2 shadow-xl text-[10px] whitespace-nowrap">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
                          <span className="font-semibold text-white">{label}</span>
                          {isNone && (
                            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" className="text-amber-400 shrink-0">
                              <path d="M6 1L11 10H1L6 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                              <path d="M6 5v2M6 8.2v.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                            </svg>
                          )}
                        </div>
                        <div className="text-gray-300 tabular-nums">{fmtHours(hrs)} <span className="text-gray-500">·</span> {pct}% of total</div>
                        {isNone && p.unassignedByMonth.size > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-gray-700">
                            {Array.from(p.unassignedByMonth.entries()).map(([month, mh]) => (
                              <span key={month} className="text-[9px] text-amber-400 bg-gray-800 rounded px-1.5 py-0.5">
                                {formatMonthLabel(month)}: {fmtHours(mh)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="w-2.5 h-2.5 bg-gray-900 rotate-45 mx-auto -mt-1.5 rounded-sm" />
                    </div>
                  );
                })() : null;

                return (
                  <div className="flex-1 relative h-7 bg-gray-100 rounded-full">
                    {/* Stacked bar */}
                    <div
                      className="absolute inset-y-0 left-0 flex rounded-full overflow-hidden"
                      style={{ width: `${actualWidthPct}%` }}
                    >
                      {segCenters.map(({ key, cx }) => (
                        <div
                          key={key}
                          className="h-full shrink-0 cursor-default"
                          style={{
                            width: `${((p.byMs.get(key) ?? 0) / p.totalHours) * 100}%`,
                            background: key === "__none__" ? NO_MILESTONE_COLOR : (milestoneColorMap.get(key) ?? NO_MILESTONE_COLOR),
                          }}
                          onMouseEnter={e => { e.stopPropagation(); setHoveredSeg({ personName: p.name, key, centerX: cx }); }}
                          onMouseLeave={() => setHoveredSeg(null)}
                        />
                      ))}
                    </div>
                    {/* Over-capacity overflow bar */}
                    {isOver && overflowWidthPct > 0 && (
                      <div
                        className="absolute inset-y-0 bg-red-400/50 rounded-r-full border-l-2 border-red-500"
                        style={{ left: `${capacityWidthPct}%`, width: `${overflowWidthPct}%` }}
                      />
                    )}
                    {/* Capacity line + label */}
                    {p.capacity != null && (
                      <div
                        className="absolute top-0 bottom-0 flex items-stretch justify-center -translate-x-1/2"
                        style={{ left: `${capacityWidthPct}%` }}
                      >
                        <div className="w-0.5 my-0.5 bg-gray-500/40 rounded-full" />
                        <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[8px] font-semibold text-gray-400 bg-white border border-gray-200 rounded px-1 py-0.5 shadow-sm pointer-events-none">
                          {fmtHours(p.capacity)} cap
                        </span>
                      </div>
                    )}
                    {/* Inline hours label */}
                    {actualWidthPct > 15 && (
                      <span
                        className="absolute inset-y-0 flex items-center pr-2 text-[9px] font-bold text-white/90 pointer-events-none"
                        style={{ right: `${100 - actualWidthPct}%` }}
                      >
                        {fmtHours(p.totalHours)}
                      </span>
                    )}
                    {/* Tooltip */}
                    {tooltip}
                  </div>
                );
              })()}

              {/* Utilization badge */}
              <div className={`w-36 shrink-0 text-right rounded-lg px-2.5 py-1.5 ${bg}`}>
                {p.utilPct != null ? (
                  <>
                    <span className={`text-sm font-bold ${text}`}>{p.utilPct}%</span>
                    <span className="text-[9px] text-gray-400 ml-1">util</span>
                    <div className="text-[9px] text-gray-400 mt-0.5 tabular-nums">
                      {fmtHours(p.totalHours)} / {fmtHours(p.capacity!)} cap
                    </div>
                  </>
                ) : (
                  <span className="text-sm font-bold text-gray-700">{fmtHours(p.totalHours)}</span>
                )}
              </div>
            </div>

            {/* ── Expanded detail panel ── */}
            {isExpanded && (
              <div className="mx-3 mb-3 rounded-xl bg-white border border-indigo-100 shadow-sm overflow-hidden">
                <div className="grid grid-cols-2 divide-x divide-indigo-50">

                  {/* Monthly breakdown */}
                  <div className="p-3">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Month by month</p>
                    <div className="flex flex-wrap gap-2">
                      {p.activeMonths.map(month => {
                        const hrs = p.byMonth.get(month) ?? 0;
                        const alloc = allocMap.get(`${p.name}|${month}`) ?? memberMap.get(p.name)?.allocationPercent ?? 100;
                        const cap = Math.round(HOURS_PER_MONTH * alloc / 100);
                        const mpct = cap > 0 ? Math.round((hrs / cap) * 100) : null;
                        const { bg: mbg, text: mtext, bar: mbar } = utilColor(mpct);
                        return (
                          <div key={month} className={`rounded-lg px-3 py-2 ${mbg} min-w-[76px] text-center`}>
                            <div className="text-[10px] font-semibold text-gray-500 mb-0.5">{formatMonthLabel(month)}</div>
                            <div className="text-sm font-bold text-gray-800">{fmtHours(hrs)}</div>
                            <div className="h-1 bg-gray-200 rounded-full mt-1.5 mx-1 overflow-hidden">
                              <div className={`h-full rounded-full ${mbar}`} style={{ width: `${Math.min(100, mpct ?? 0)}%` }} />
                            </div>
                            <div className="text-[9px] text-gray-400 mt-0.5">{cap}h cap</div>
                            {mpct != null && <div className={`text-[9px] font-bold ${mtext}`}>{mpct}%</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Service / Milestone breakdown */}
                  <div className="p-3">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">{entityLabel}</p>
                    <div className="space-y-2">
                      {orderedKeys.map(key => {
                        const hrs = p.byMs.get(key) ?? 0;
                        const sharePct = Math.round((hrs / p.totalHours) * 100);
                        const isNone = key === "__none__";
                        const color = isNone ? NO_MILESTONE_COLOR : (milestoneColorMap.get(key) ?? NO_MILESTONE_COLOR);
                        const label = isNone ? noneLabel : (milestoneNameMap.get(key) ?? key);
                        return (
                          <div key={key} className={isNone ? "rounded-lg bg-amber-50 border border-amber-100 px-2 py-1.5 -mx-2" : ""}>
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} />
                              <span className={`text-[10px] truncate flex-1 ${isNone ? "font-semibold text-amber-700" : "text-gray-600"}`} title={label}>{label}</span>
                              {isNone && (
                                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" className="text-amber-500 shrink-0">
                                  <path d="M6 1L11 10H1L6 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                                  <path d="M6 5v2M6 8.2v.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                                </svg>
                              )}
                              <span className={`text-[10px] font-semibold tabular-nums shrink-0 ${isNone ? "text-amber-700" : "text-gray-700"}`}>{fmtHours(hrs)}</span>
                              <span className="text-[9px] text-gray-400 w-7 text-right shrink-0">{sharePct}%</span>
                            </div>
                            <div className="h-1 bg-gray-100 rounded-full overflow-hidden ml-4">
                              <div className="h-full rounded-full" style={{ width: `${sharePct}%`, background: color }} />
                            </div>
                            {isNone && p.unassignedByMonth.size > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5 ml-4">
                                {Array.from(p.unassignedByMonth.entries()).map(([month, mh]) => (
                                  <span key={month} className="text-[9px] font-semibold text-amber-700 bg-white border border-amber-200 rounded-md px-1.5 py-0.5 tabular-nums">
                                    {formatMonthLabel(month)}: {fmtHours(mh)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-3 border-t border-gray-100 mt-1">
        {entities.filter(e => usedMsIds.has(e.id)).map((e, i) => (
          <span key={e.id} className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0 inline-block" style={{ background: MILESTONE_PALETTE[i % MILESTONE_PALETTE.length] }} />
            {e.name}
          </span>
        ))}
        {hasNoMilestone && (
          <span className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0 inline-block" style={{ background: NO_MILESTONE_COLOR }} />{noneLabel}
          </span>
        )}
        <span className="flex items-center gap-1.5 text-[10px] text-gray-400 ml-auto">
          <span className="w-0.5 h-3 bg-gray-500/40 inline-block" />Capacity
        </span>
        <span className="text-[10px] text-green-600">≥80% on track</span>
        <span className="text-[10px] text-red-500">&gt;100% over capacity</span>
      </div>
    </div>
  );
}

// ── By-Month matrix view ───────────────────────────────────────────────────────

function ByMonthView({
  entries,
  memberMap,
  allocations,
  isTM = false,
}: {
  entries: Entry[];
  memberMap: Map<string, Member>;
  allocations: AllocationRecord[];
  isTM?: boolean;
}) {
  // Build allocMap: "name|month" → percent (expanded from date ranges)
  const allocMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of allocations) {
      for (const month of expandAllocToMonths(a)) {
        if (!m.has(`${a.memberName}|${month}`)) m.set(`${a.memberName}|${month}`, a.allocationPercent);
      }
    }
    return m;
  }, [allocations]);

  function getAlloc(name: string, month: string): number | null {
    return allocMap.get(`${name}|${month}`) ?? memberMap.get(name)?.allocationPercent ?? null;
  }

  // Aggregate: person → month → hours (+ unassigned hours)
  const { people, months } = useMemo(() => {
    const hoursMap      = new Map<string, Map<string, number>>(); // person → month → hours
    const unassignedMap = new Map<string, Map<string, number>>(); // person → month → unassigned hours
    const monthSet = new Set<string>();
    for (const e of entries) {
      if (!e.date) continue;
      const month = e.date.slice(0, 7);
      monthSet.add(month);
      if (!hoursMap.has(e.employeeName)) {
        hoursMap.set(e.employeeName, new Map());
        unassignedMap.set(e.employeeName, new Map());
      }
      hoursMap.get(e.employeeName)!.set(month, (hoursMap.get(e.employeeName)!.get(month) ?? 0) + e.hoursLogged);
      if (!isTM && !e.milestoneId) {
        unassignedMap.get(e.employeeName)!.set(month, (unassignedMap.get(e.employeeName)!.get(month) ?? 0) + e.hoursLogged);
      }
    }
    const months = Array.from(monthSet).sort();
    const people = Array.from(hoursMap.entries())
      .map(([name, byMonth]) => ({ name, byMonth, unassignedByMonth: unassignedMap.get(name) ?? new Map<string, number>() }))
      .sort((a, b) => {
        const ta = Array.from(a.byMonth.values()).reduce((s, h) => s + h, 0);
        const tb = Array.from(b.byMonth.values()).reduce((s, h) => s + h, 0);
        return tb - ta;
      });
    return { people, months };
  }, [entries, isTM]);

  if (months.length === 0) {
    return <p className="text-xs text-gray-400 text-center py-4">No dated entries to show.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse" style={{ minWidth: months.length * 100 + 160 }}>
        <thead>
          <tr>
            <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide py-2 pr-3 w-40 sticky left-0 bg-white">
              Member
            </th>
            {months.map(m => (
              <th key={m} className="text-center text-[10px] font-semibold text-gray-500 pb-2 px-1 min-w-[88px]">
                {formatMonthLabel(m)}
              </th>
            ))}
            <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wide pb-2 pl-3">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {people.map(p => {
            const totalHours = Array.from(p.byMonth.values()).reduce((s, h) => s + h, 0);
            const totalCapacity = months.reduce((s, month) => {
              if (!p.byMonth.has(month)) return s;
              const a = getAlloc(p.name, month);
              return a != null ? s + HOURS_PER_MONTH * (a / 100) : s;
            }, 0);
            const overallUtil = totalCapacity > 0 ? Math.round((totalHours / totalCapacity) * 100) : null;
            const { text: totalText } = utilColor(overallUtil);

            return (
              <tr key={p.name} className="hover:bg-gray-50/50 transition-colors">
                {/* Name cell */}
                <td className="py-2 pr-3 sticky left-0 bg-white">
                  <span className="font-medium text-gray-700 truncate block" title={p.name}>{p.name}</span>
                </td>

                {/* Month cells */}
                {months.map(month => {
                  const hours = p.byMonth.get(month);

                  if (!hours) {
                    return (
                      <td key={month} className="px-1 py-1.5 text-center">
                        <div className="rounded-lg bg-gray-50 px-2 py-1.5 text-[10px] text-gray-300">—</div>
                      </td>
                    );
                  }

                  const alloc = getAlloc(p.name, month);
                  const capacity = alloc != null ? HOURS_PER_MONTH * (alloc / 100) : null;
                  const pct = capacity != null && capacity > 0 ? Math.round((hours / capacity) * 100) : null;
                  const { bg, text, bar } = utilColor(pct);
                  const unassignedH = p.unassignedByMonth.get(month) ?? 0;

                  return (
                    <td key={month} className="px-1 py-1.5">
                      <div className={`rounded-lg ${bg} px-2 py-1.5 text-center`}>
                        <div className="font-semibold text-gray-700">{fmtHours(hours)}</div>
                        {capacity != null && (
                          <div className="h-1 rounded-full bg-gray-200 mt-1 mx-1 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${bar} transition-all`}
                              style={{ width: `${Math.min(100, pct ?? 0)}%` }}
                            />
                          </div>
                        )}
                        {pct != null && (
                          <div className={`text-[9px] font-bold mt-0.5 ${text}`}>{pct}%</div>
                        )}
                        {alloc != null && <div className="text-[9px] text-gray-400 mt-0.5">{alloc}% alloc</div>}
                        {unassignedH > 0 && (
                          <div className="flex items-center justify-center gap-0.5 mt-1" title={`${fmtHours(unassignedH)} not assigned to any milestone`}>
                            <svg width="8" height="8" viewBox="0 0 10 10" className="text-amber-500 shrink-0" fill="currentColor">
                              <path d="M5 1L9.33 8.5H.67L5 1z"/>
                            </svg>
                            <span className="text-[8px] text-amber-600 font-semibold leading-none">{fmtHours(unassignedH)}</span>
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}

                {/* Total cell */}
                <td className="pl-3 py-1.5 text-right">
                  <span className="font-semibold text-gray-700">{fmtHours(totalHours)}</span>
                  {overallUtil != null && (
                    <div className={`text-[9px] font-bold ${totalText}`}>{overallUtil}% util</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>

        {/* Footer: totals per month */}
        <tfoot className="border-t-2 border-gray-200">
          <tr>
            <td className="py-2 pr-3 text-[10px] font-semibold text-gray-500 sticky left-0 bg-white">Total</td>
            {months.map(month => {
              const monthTotal = people.reduce((s, p) => s + (p.byMonth.get(month) ?? 0), 0);
              return (
                <td key={month} className="px-1 py-2 text-center text-[10px] font-semibold text-gray-600">
                  {monthTotal > 0 ? fmtHours(monthTotal) : <span className="text-gray-300">—</span>}
                </td>
              );
            })}
            <td className="pl-3 py-2 text-right text-[10px] font-semibold text-gray-700">
              {fmtHours(people.reduce((s, p) => s + Array.from(p.byMonth.values()).reduce((a, h) => a + h, 0), 0))}
            </td>
          </tr>
        </tfoot>
      </table>

      <p className="text-[10px] text-gray-400 mt-2">
        Capacity = {HOURS_PER_MONTH}h × allocation%. Set monthly allocations in the Team section.
      </p>
    </div>
  );
}

// ── Fullscreen icons ──────────────────────────────────────────────────────────
function IconExpand() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconCompress() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5 1v4H1M9 1v4h4M1 9h4v4M13 9H9v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function ResourceUtilizationChart({
  entries,
  teamMembers,
  milestones,
  services,
  projectId,
  allocations,
  isTM = false,
  isPS = false,
}: {
  entries: Entry[];
  teamMembers: Member[];
  milestones: Milestone[];
  services?: Service[];
  projectId: string;
  allocations: AllocationRecord[];
  isTM?: boolean;
  isPS?: boolean;
}) {
  const [view, setView] = useState<"member" | "month">("month");
  const [fullscreen, setFullscreen] = useState(false);

  const memberMap = useMemo(
    () => new Map(teamMembers.map(m => [m.name, m])),
    [teamMembers],
  );

  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullscreen]);

  useEffect(() => {
    document.body.style.overflow = fullscreen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [fullscreen]);

  // KPI totals
  const { totalHours, unassignedHours, unassignedMonths } = useMemo(() => {
    let totalHours = 0;
    let unassignedHours = 0;
    const monthSet = new Set<string>();
    for (const e of entries) {
      totalHours += e.hoursLogged;
      const unassigned = isPS ? !e.serviceId : !e.milestoneId;
      if (!isTM && unassigned) {
        unassignedHours += e.hoursLogged;
        if (e.date) monthSet.add(e.date.slice(0, 7));
      }
    }
    return {
      totalHours,
      unassignedHours,
      unassignedMonths: Array.from(monthSet).sort(),
    };
  }, [entries, isTM, isPS]);

  if (entries.length === 0) {
    return (
      <p className="text-xs text-gray-400 py-4 text-center">
        No timesheet entries yet — import timesheets to see resource utilization.
      </p>
    );
  }

  const kpiAndToggle = (
    <div className="flex items-center gap-6 flex-wrap">
      <KpiChip label="Total hours" value={fmtHours(totalHours)} />
      {unassignedHours > 0 && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-[10px] font-semibold text-amber-700">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M6 1L11 10H1L6 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            <path d="M6 5v2.5M6 8.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          {fmtHours(unassignedHours)} not assigned to any {isPS ? "service" : "milestone"}
          {unassignedMonths.length > 0 && (
            <span className="font-normal text-amber-600">
              — {unassignedMonths.map(m => formatMonthLabel(m)).join(", ")}
            </span>
          )}
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
          <button
            onClick={() => setView("month")}
            className={`px-3 py-1 text-[11px] font-semibold transition-colors ${view === "month" ? "bg-indigo-50 text-indigo-600" : "bg-white text-gray-400 hover:text-gray-600"}`}
          >
            By month
          </button>
          <button
            onClick={() => setView("member")}
            className={`px-3 py-1 text-[11px] font-semibold transition-colors border-l border-gray-200 ${view === "member" ? "bg-indigo-50 text-indigo-600" : "bg-white text-gray-400 hover:text-gray-600"}`}
          >
            By member
          </button>
        </div>
        {!fullscreen && (
          <button
            onClick={() => setFullscreen(true)}
            className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-indigo-600 transition-colors"
            title="View fullscreen"
          >
            <IconExpand />
            Fullscreen
          </button>
        )}
      </div>
    </div>
  );

  const chartView = view === "month" ? (
    <ByMonthView entries={entries} memberMap={memberMap} allocations={allocations} isTM={isTM} />
  ) : (
    <ByMemberView entries={entries} memberMap={memberMap} milestones={milestones} services={services} allocations={allocations} isTM={isTM} isPS={isPS} />
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white">
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-gray-50 shrink-0">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-indigo-500">
              <circle cx="4" cy="8" r="2.5" fill="currentColor" opacity="0.5"/>
              <circle cx="10" cy="5" r="2.5" fill="currentColor"/>
              <circle cx="13" cy="10" r="2" fill="currentColor" opacity="0.7"/>
            </svg>
            <p className="text-sm font-semibold text-gray-800">Resource Utilization</p>
          </div>
          <button
            onClick={() => setFullscreen(false)}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 bg-white border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors"
            title="Exit fullscreen (Esc)"
          >
            <IconCompress />
            Exit fullscreen
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {kpiAndToggle}
          {chartView}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {kpiAndToggle}
      {chartView}
    </div>
  );
}
