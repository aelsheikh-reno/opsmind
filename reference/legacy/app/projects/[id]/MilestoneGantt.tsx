"use client";

import { useMemo, useState, useEffect } from "react";

type GanttMilestone = {
  id: string;
  name: string;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  completionPercent: number | null;
};

const LEFT_COL_NORMAL = 168;
const LEFT_COL_FULL   = 220;
const ROW_H_NORMAL    = 38;
const ROW_H_FULL      = 46;
const BAR_H_NORMAL    = 18;
const BAR_H_FULL      = 22;
const HEADER_H        = 34;

function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function monthStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// ── Inner chart grid ─────────────────────────────────────────────────────────
function GanttGrid({
  milestones,
  today,
  chartStart,
  totalDays,
  monthTicks,
  todayPct,
  showToday,
  fullscreen,
}: {
  milestones: GanttMilestone[];
  today: Date;
  chartStart: Date;
  totalDays: number;
  monthTicks: { label: string; pct: number }[];
  todayPct: number;
  showToday: boolean;
  fullscreen: boolean;
}) {
  const LEFT_COL = fullscreen ? LEFT_COL_FULL : LEFT_COL_NORMAL;
  const ROW_H    = fullscreen ? ROW_H_FULL    : ROW_H_NORMAL;
  const BAR_H    = fullscreen ? BAR_H_FULL    : BAR_H_NORMAL;

  function toPct(dateStr: string) {
    return ((new Date(dateStr).getTime() - chartStart.getTime()) / 86_400_000 / totalDays) * 100;
  }

  const plotted = milestones.filter(m => m.dueDate || m.startDate);
  const undated = milestones.filter(m => !m.dueDate && !m.startDate);

  return (
    <div style={{ minWidth: fullscreen ? undefined : 560 }}>

      {/* ── Month header ── */}
      <div className="flex" style={{ height: HEADER_H }}>
        <div
          style={{ width: LEFT_COL, flexShrink: 0 }}
          className="border-b border-r border-gray-200 bg-gray-50 shrink-0"
        />
        <div className="relative flex-1 border-b border-gray-200 bg-gray-50 overflow-hidden">
          {monthTicks.map(tick => (
            <div
              key={tick.label}
              className="absolute top-0 h-full flex items-center gap-1 pl-1"
              style={{ left: `${tick.pct}%` }}
            >
              <div className="w-px self-stretch bg-gray-200" />
              <span className={`${fullscreen ? "text-xs" : "text-[10px]"} text-gray-500 font-medium whitespace-nowrap select-none`}>
                {tick.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex">
        {/* Name column */}
        <div style={{ width: LEFT_COL, flexShrink: 0 }} className="border-r border-gray-200">
          {plotted.map((m, i) => (
            <div
              key={m.id}
              style={{ height: ROW_H }}
              className={`flex items-center px-3 border-b border-gray-100 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/60"}`}
            >
              <span
                className={`${fullscreen ? "text-xs" : "text-[11px]"} text-gray-700 font-medium truncate leading-tight`}
                title={m.name}
              >
                {i + 1}. {m.name}
              </span>
            </div>
          ))}
          {undated.length > 0 && (
            <div style={{ height: 28 }} className="flex items-center px-3 bg-white border-b border-gray-100">
              <span className="text-[10px] text-gray-400 italic">
                {undated.length} milestone{undated.length !== 1 ? "s" : ""} with no dates
              </span>
            </div>
          )}
        </div>

        {/* Timeline column */}
        <div className="relative flex-1 overflow-hidden">
          {/* Background grid + today line */}
          <div className="absolute inset-0 pointer-events-none">
            {monthTicks.map(tick => (
              <div
                key={tick.label}
                className="absolute top-0 bottom-0 w-px bg-gray-100"
                style={{ left: `${tick.pct}%` }}
              />
            ))}
            {showToday && (
              <div
                className="absolute top-0 bottom-0 z-10"
                style={{ left: `${todayPct}%` }}
              >
                <div className="w-px h-full bg-red-400/70" />
                <div className="absolute -translate-x-1/2 bg-red-400 text-white text-[8px] font-bold px-1 py-0.5 rounded whitespace-nowrap" style={{ top: 0 }}>
                  Today
                </div>
              </div>
            )}
          </div>

          {/* Milestone rows */}
          {plotted.map((m, i) => {
            const isCompleted = !!m.completedAt;
            const isOverdue   = !isCompleted && !!m.dueDate && new Date(m.dueDate) < today;
            const pct         = Math.min(100, Math.max(0, m.completionPercent ?? 0));

            const hasBoth  = !!m.startDate && !!m.dueDate;
            const hasStart = !!m.startDate;
            const hasEnd   = !!m.dueDate;

            const rawLeft  = hasStart ? toPct(m.startDate!) : (hasEnd  ? toPct(m.dueDate!)  : 0);
            const rawRight = hasEnd   ? toPct(m.dueDate!)   : (hasStart ? toPct(m.startDate!) : 0);

            const barLeft  = Math.max(0, Math.min(100, rawLeft));
            const barRight = Math.max(0, Math.min(100, rawRight));
            const barWidth = hasBoth ? Math.max(0.4, barRight - barLeft) : 0;

            const trackCls = isCompleted ? "bg-green-100" : isOverdue ? "bg-red-100"  : "bg-indigo-100";
            const fillCls  = isCompleted ? "bg-green-500" : isOverdue ? "bg-red-400"  : "bg-indigo-500";
            const dotCls   = isCompleted ? "bg-green-500" : isOverdue ? "bg-red-400"  : "bg-indigo-500";

            return (
              <div
                key={m.id}
                style={{ height: ROW_H }}
                className={`relative flex items-center border-b border-gray-100 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/60"}`}
              >
                {hasBoth ? (
                  <div
                    className={`absolute rounded-full ${trackCls} overflow-hidden`}
                    style={{ left: `${barLeft}%`, width: `${barWidth}%`, height: BAR_H }}
                    title={`${m.name} · ${pct}%`}
                  >
                    <div
                      className={`h-full rounded-full ${fillCls} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                    {barWidth > 5 && (
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white/80 select-none pointer-events-none">
                        {pct > 0 ? `${pct}%` : ""}
                      </span>
                    )}
                  </div>
                ) : (
                  <div
                    className={`absolute w-3 h-3 rotate-45 ${dotCls} shadow-sm`}
                    style={{ left: `calc(${barRight}% - 6px)` }}
                    title={m.name}
                  />
                )}
              </div>
            );
          })}

          {undated.length > 0 && (
            <div style={{ height: 28 }} className="bg-white border-b border-gray-100" />
          )}
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex items-center gap-4 px-3 py-2 bg-gray-50 border-t border-gray-200 flex-wrap">
        <LegendItem color="bg-indigo-500" label="In progress" />
        <LegendItem color="bg-green-500"  label="Completed" />
        <LegendItem color="bg-red-400"    label="Overdue" />
        <span className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <span className="w-2.5 h-2.5 rotate-45 bg-indigo-500 inline-block" />Due date only
        </span>
        {showToday && (
          <span className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <span className="w-px h-3 bg-red-400 inline-block" />Today
          </span>
        )}
      </div>

    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-gray-500">
      <span className={`w-3 h-3 rounded-full ${color} inline-block`} />{label}
    </span>
  );
}

// ── Fullscreen button icons ──────────────────────────────────────────────────
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

// ── Main export ──────────────────────────────────────────────────────────────
export default function MilestoneGantt({
  milestones,
  projectStartDate,
  projectEndDate,
}: {
  milestones: GanttMilestone[];
  projectStartDate?: string | null;
  projectEndDate?: string | null;
}) {
  const [fullscreen, setFullscreen] = useState(false);

  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);

  const { chartStart, chartEnd, totalDays } = useMemo(() => {
    const dates: Date[] = [];
    if (projectStartDate) dates.push(new Date(projectStartDate));
    if (projectEndDate)   dates.push(new Date(projectEndDate));
    for (const m of milestones) {
      if (m.startDate) dates.push(new Date(m.startDate));
      if (m.dueDate)   dates.push(new Date(m.dueDate));
    }
    if (dates.length === 0) {
      const s = addDays(today, -7);
      const e = addDays(today, 30);
      return { chartStart: s, chartEnd: e, totalDays: 37 };
    }
    const min = new Date(Math.min(...dates.map(d => d.getTime())));
    const max = new Date(Math.max(...dates.map(d => d.getTime())));
    const start = addDays(monthStart(min), -3);
    const end   = addDays(max, 14);
    return {
      chartStart: start,
      chartEnd:   end,
      totalDays:  Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000)),
    };
  }, [milestones, projectStartDate, projectEndDate, today]);

  const monthTicks = useMemo(() => {
    const ticks: { label: string; pct: number }[] = [];
    let d = new Date(chartStart.getFullYear(), chartStart.getMonth(), 1);
    while (d <= chartEnd) {
      const offset = (d.getTime() - chartStart.getTime()) / 86_400_000;
      if (offset >= 0) {
        ticks.push({
          label: d.toLocaleDateString("en-AE", { month: "short", year: "2-digit" }),
          pct: (offset / totalDays) * 100,
        });
      }
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return ticks;
  }, [chartStart, chartEnd, totalDays]);

  const todayPct = ((today.getTime() - chartStart.getTime()) / 86_400_000 / totalDays) * 100;
  const showToday = todayPct >= 0 && todayPct <= 100;

  // Escape key closes fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullscreen]);

  // Prevent body scroll when fullscreen
  useEffect(() => {
    document.body.style.overflow = fullscreen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [fullscreen]);

  const sharedProps = { milestones, today, chartStart, totalDays, monthTicks, todayPct, showToday };

  // ── Fullscreen overlay ──
  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-gray-50 shrink-0">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none" className="text-indigo-500">
              <rect x="1" y="1.5" width="7" height="2.5" rx="1" fill="currentColor"/>
              <rect x="4" y="5.5" width="8" height="2.5" rx="1" fill="currentColor"/>
              <rect x="2" y="9.5" width="5" height="2.5" rx="1" fill="currentColor"/>
            </svg>
            <p className="text-sm font-semibold text-gray-800">Milestone Gantt Chart</p>
            <span className="text-[10px] text-gray-400 font-medium">
              {milestones.filter(m => m.dueDate || m.startDate).length} of {milestones.length} milestone{milestones.length !== 1 ? "s" : ""} plotted
            </span>
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

        {/* Scrollable chart area */}
        <div className="flex-1 overflow-auto">
          <GanttGrid {...sharedProps} fullscreen={true} />
        </div>
      </div>
    );
  }

  // ── Normal (inline) view ──
  return (
    <div className="rounded-lg border border-gray-100 overflow-hidden">
      {/* Chart header bar with fullscreen button */}
      <div className="flex items-center justify-end px-3 py-1.5 bg-gray-50 border-b border-gray-100">
        <button
          onClick={() => setFullscreen(true)}
          className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-indigo-600 transition-colors"
          title="View fullscreen"
        >
          <IconExpand />
          Fullscreen
        </button>
      </div>
      <div className="overflow-x-auto">
        <GanttGrid {...sharedProps} fullscreen={false} />
      </div>
    </div>
  );
}
