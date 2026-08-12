"use client";

import { useState } from "react";
import Link from "next/link";
import AllocationDrawer from "./AllocationDrawer";

type AllocEntry = {
  allocationId: string;
  projectId: string;
  projectName: string;
  percent: number;
  barColor: string;
  textColor: string;
  startDay: number;
  endDay: number;
  totalDaysInMonth: number;
  allocStartISO: string;
  allocEndISO: string;
};

type Row = {
  key: string;
  displayName: string;
  jobTitle?: string;
  inDirectory: boolean;
  personId?: string;
  weeklyHours: number;
  allocByMonth: Record<string, AllocEntry[]>;
  logsByMonth: Record<string, Record<string, number>>;
};

type ProjectOption = {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

type Props = {
  rows: Row[];
  months: string[];
  currentMonth: string;
  projectLegend: { id: string; name: string; barColor: string }[];
  projects: ProjectOption[];
  prevParams: string;
  nextParams: string;
  windowLabel: string;
  noAllocCount: number;
  showAll: boolean;
  allToggleParams: string;
};

function formatMonth(ym: string): { short: string; year: string } {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return {
    short: d.toLocaleString("en", { month: "short" }),
    year: String(y),
  };
}

function fmtDay(day: number, totalDays: number): string {
  return day === 1 ? "1" : day === totalDays ? `${totalDays}` : String(day);
}


export default function AllocationGrid({
  rows, months, currentMonth, projectLegend, projects,
  prevParams, nextParams, windowLabel, noAllocCount, showAll, allToggleParams,
}: Props) {
  const [drawerMember, setDrawerMember] = useState<{ key: string; displayName: string; month?: string; projectId?: string } | null>(null);

  return (
    <>
      {drawerMember && (
        <AllocationDrawer
          memberName={drawerMember.displayName}
          projects={projects}
          initialMonth={drawerMember.month}
          initialProjectId={drawerMember.projectId}
          onClose={() => setDrawerMember(null)}
        />
      )}

      <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
        {/* Month navigation */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border bg-surface-inset">
          <Link href={`/resources?${prevParams}`} className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Prev
          </Link>
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{windowLabel}</span>
          <Link href={`/resources?${nextParams}`} className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors">
            Next
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>

        {/* Grid */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: `${210 + months.length * 140}px` }}>
            <thead>
              <tr className="border-b border-surface-border">
                <th className="sticky left-0 z-10 bg-surface-inset px-5 py-3 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide border-r border-surface-border w-[210px] min-w-[210px]">
                  Employee
                </th>
                {months.map((m) => {
                  const { short, year } = formatMonth(m);
                  const isCurrent = m === currentMonth;
                  return (
                    <th key={m} className={`px-3 py-3 text-center text-[11px] font-medium uppercase tracking-wide w-[140px] min-w-[140px] ${isCurrent ? "text-indigo-600 bg-indigo-50/60" : "text-gray-400 bg-surface-inset"}`}>
                      <div>{short}</div>
                      <div className="text-[10px] font-normal opacity-60">{year}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={months.length + 1} className="px-5 py-12 text-center text-sm text-gray-400">
                    No allocations in this window.{" "}
                    {!showAll && noAllocCount > 0 && (
                      <Link href={`/resources?${allToggleParams}`} className="text-indigo-500 hover:underline">
                        Show all {noAllocCount} unassigned
                      </Link>
                    )}
                  </td>
                </tr>
              ) : rows.map((row) => (
                <tr key={row.key} className="group hover:bg-surface-hover/50 transition-colors">
                  {/* Sticky name cell */}
                  <td className="sticky left-0 z-10 bg-white group-hover:bg-surface-hover/50 px-5 py-3 border-r border-surface-border">
                    <div className="flex items-center gap-2.5">
                      <button
                        onClick={() => setDrawerMember({ key: row.key, displayName: row.displayName })}
                        className="w-7 h-7 rounded-full bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 flex items-center justify-center shrink-0 transition-colors"
                      >
                        <span className="text-[10px] font-bold text-indigo-500">
                          {row.displayName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                        </span>
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {row.inDirectory && row.personId ? (
                            <Link href={`/people/${row.personId}`} className="text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors truncate">
                              {row.displayName}
                            </Link>
                          ) : (
                            <span className="text-sm font-medium text-gray-700 truncate">{row.displayName}</span>
                          )}
                          <button
                            onClick={() => setDrawerMember({ key: row.key, displayName: row.displayName })}
                            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-indigo-500 transition-all shrink-0"
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M8.5 1.5l2 2L3 11H1v-2L8.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        </div>
                        <div className="flex items-center gap-1 flex-wrap mt-0.5">
                          {row.jobTitle && <span className="text-[10px] text-gray-400 truncate">{row.jobTitle}</span>}
                          {row.inDirectory && (
                            row.weeklyHours < 40 ? (
                              <span className="text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-full leading-none">PT · {row.weeklyHours}h/wk</span>
                            ) : (
                              <span className="text-[9px] font-semibold text-indigo-500 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-full leading-none">FT</span>
                            )
                          )}
                          {!row.inDirectory && (
                            <span className="text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-full leading-none">Not in directory</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Month cells */}
                  {months.map((m) => {
                    const entries = row.allocByMonth[m] ?? [];
                    const projectLogs = row.logsByMonth[m] ?? {};
                    const totalLogged = Object.values(projectLogs).reduce((s, h) => s + h, 0);
                    const isCurrent = m === currentMonth;
                    const totalDays = entries[0]?.totalDaysInMonth ?? 30;

                    // Union of day ranges (handles parallel/overlapping allocations correctly)
                    const unionDays = (() => {
                      if (entries.length === 0) return 0;
                      const sorted = [...entries].sort((a, b) => a.startDay - b.startDay);
                      let covered = 0, cur = 0;
                      for (const e of sorted) {
                        const start = Math.max(e.startDay, cur + 1);
                        if (start <= e.endDay) { covered += e.endDay - start + 1; cur = Math.max(cur, e.endDay); }
                      }
                      return covered;
                    })();

                    // Total allocation % across all projects for utilisation bar
                    const totalAllocPct = entries.reduce((s, e) => s + e.percent, 0);
                    const monthlyCapacityHrs = (totalAllocPct / 100) * (row.weeklyHours * 52 / 12);
                    const isOverLogged = totalLogged > monthlyCapacityHrs && monthlyCapacityHrs > 0;

                    const hasContent = entries.length > 0 || totalLogged > 0;

                    return (
                      <td
                        key={m}
                        onClick={() => setDrawerMember({ key: row.key, displayName: row.displayName, month: m })}
                        className={`px-2 py-2.5 align-top cursor-pointer transition-colors ${isCurrent ? "bg-indigo-50/30 hover:bg-indigo-50/60" : "hover:bg-surface-hover/40"}`}
                      >
                        {hasContent && (
                          <div className="space-y-1.5">
                            {/* Per-project rows: each gets its own bar + label */}
                            {entries.map((e, i) => {
                              const hrs = projectLogs[e.projectId] ?? 0;
                              const isFullMonth = e.startDay === 1 && e.endDay === e.totalDaysInMonth;
                              const dayLabel = isFullMonth
                                ? "full mo."
                                : `${fmtDay(e.startDay, e.totalDaysInMonth)}–${fmtDay(e.endDay, e.totalDaysInMonth)}`;
                              const leftPct = ((e.startDay - 1) / e.totalDaysInMonth) * 100;
                              const widthPct = ((e.endDay - e.startDay + 1) / e.totalDaysInMonth) * 100;
                              return (
                                <div
                                  key={i}
                                  className="space-y-0.5 cursor-pointer rounded hover:bg-black/5 px-0.5 -mx-0.5 transition-colors"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    setDrawerMember({ key: row.key, displayName: row.displayName, month: m, projectId: e.projectId });
                                  }}
                                  title={`Edit ${e.projectName} allocation`}
                                >
                                  {/* Timeline bar for this project */}
                                  <div className="relative w-full h-2 bg-gray-100 rounded overflow-hidden">
                                    <div
                                      className="absolute top-0 bottom-0 rounded"
                                      style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: e.barColor }}
                                    />
                                  </div>
                                  {/* Project label row */}
                                  <div className="flex items-center gap-1 min-w-0">
                                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: e.barColor }} />
                                    <span className="text-[10px] font-medium truncate flex-1" style={{ color: e.textColor }} title={e.projectName}>
                                      {e.projectName}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 pl-2.5">
                                    <span className="text-[9px] text-gray-400">{dayLabel}</span>
                                    <span className="text-[9px] font-semibold text-gray-500">{e.percent}%</span>
                                    {hrs > 0 && <span className="text-[9px] text-gray-400">· {Math.round(hrs)}h</span>}
                                  </div>
                                </div>
                              );
                            })}

                            {/* Unplanned logs */}
                            {(() => {
                              const allocatedIds = new Set(entries.map((e) => e.projectId));
                              const unplanned = Object.entries(projectLogs)
                                .filter(([pid]) => !allocatedIds.has(pid))
                                .reduce((s, [, h]) => s + h, 0);
                              return unplanned > 0 ? (
                                <div className="flex items-center gap-1">
                                  <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-amber-400" />
                                  <span className="text-[9px] text-amber-600 font-medium">Unplanned · {Math.round(unplanned)}h</span>
                                </div>
                              ) : null;
                            })()}

                            {/* Logged hours utilisation bar */}
                            {totalLogged > 0 && monthlyCapacityHrs > 0 && (
                              <div className="w-full h-1 rounded-full overflow-hidden bg-gray-100">
                                <div
                                  className={`h-full rounded-full ${isOverLogged ? "bg-red-400" : "bg-emerald-400"}`}
                                  style={{ width: `${Math.min(100, (totalLogged / monthlyCapacityHrs) * 100)}%` }}
                                />
                              </div>
                            )}

                            {/* Footer */}
                            {(entries.length > 0 || totalLogged > 0) && (
                              <div className="flex items-center justify-between pt-0.5 border-t border-gray-100">
                                {entries.length > 0 && (
                                  <span className="text-[9px] text-gray-400">{unionDays}/{totalDays}d</span>
                                )}
                                {totalLogged > 0 && (
                                  <span className={`text-[9px] font-semibold ${isOverLogged ? "text-red-500" : "text-emerald-600"}`}>
                                    {Math.round(totalLogged)}h
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        {projectLegend.length > 0 && (
          <div className="px-5 py-3 border-t border-surface-border bg-surface-inset flex flex-wrap gap-3">
            {projectLegend.map((p) => (
              <div key={p.id} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.barColor }} />
                <span className="text-[11px] text-gray-500">{p.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!showAll && noAllocCount > 0 && rows.length > 0 && (
        <p className="text-sm text-gray-400 text-center mt-3">
          {noAllocCount} employee{noAllocCount !== 1 ? "s" : ""} with no allocations hidden.{" "}
          <Link href={`/resources?${allToggleParams}`} className="text-indigo-500 hover:underline">Show all</Link>
        </p>
      )}
    </>
  );
}
