"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export type CalendarMonthData = {
  month: number;
  year: number;
  runId: string | null;
  hasRun: boolean;
  isCurrent: boolean;
  isPast: boolean;
  isFuture: boolean;
  isSelected: boolean;
  isProcessed: boolean;
  isPartial: boolean;
  paidCount: number;
  totalCount: number;
  monthUsdTotal: number;
  primaryCurrency: string;
  primaryAmount: number;
};

export default function PayrollCalendar({
  months,
  nowYear,
  nowMonth,
  canWrite = false,
}: {
  months: CalendarMonthData[];
  nowYear: number;
  nowMonth: number;
  canWrite?: boolean;
}) {
  const router = useRouter();
  const selectedInData = months.find(m => m.isSelected);
  const [activeYear, setActiveYear] = useState(selectedInData?.year ?? nowYear);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // Year range: derived entirely from data passed in (horizon already applied upstream)
  const dataYears = months.map(m => m.year);
  const minYear = dataYears.length ? Math.min(...dataYears) : nowYear;
  const maxYear = dataYears.length ? Math.max(...dataYears) : nowYear;
  const availableYears = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);

  const toKey = (y: number, m: number) => y * 12 + m;

  // Months eligible for bulk processing: have a run, unprocessed, not future
  const eligibleInGrid = (cm: CalendarMonthData) =>
    cm.hasRun && !cm.isProcessed && !cm.isFuture && cm.runId !== null;

  function toggleRunId(runId: string) {
    setSelectedRunIds(prev => {
      const next = new Set(prev);
      next.has(runId) ? next.delete(runId) : next.add(runId);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedRunIds(new Set());
  }

  async function handleBulkProcess() {
    if (!selectedRunIds.size || bulkProcessing) return;
    setBulkProcessing(true);
    try {
      const res = await fetch("/api/payroll/processed/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runIds: Array.from(selectedRunIds) }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`${data.processed} payroll ${data.processed === 1 ? "month" : "months"} marked as processed`);
        exitSelectMode();
        router.refresh();
      } else {
        toast.error(data.error ?? "Failed to process");
      }
    } finally {
      setBulkProcessing(false);
    }
  }

  // Full 12-month grid for active year — fill missing months as empty
  const grid = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const existing = months.find(cm => cm.year === activeYear && cm.month === m);
    if (existing) return existing;
    return {
      month: m, year: activeYear,
      runId: null,
      hasRun: false,
      isCurrent: m === nowMonth && activeYear === nowYear,
      isPast: toKey(activeYear, m) < toKey(nowYear, nowMonth),
      isFuture: toKey(activeYear, m) > toKey(nowYear, nowMonth),
      isSelected: false,
      isProcessed: false, isPartial: false,
      paidCount: 0, totalCount: 0,
      monthUsdTotal: 0, primaryCurrency: "", primaryAmount: 0,
    } satisfies CalendarMonthData;
  });

  // All eligible runIds visible in the entire months array (not just active year)
  const allEligibleRunIds = months.filter(eligibleInGrid).map(cm => cm.runId!);
  const allVisibleEligible = months.filter(cm => cm.year === activeYear && eligibleInGrid(cm)).map(cm => cm.runId!);
  const allVisibleSelected = allVisibleEligible.length > 0 && allVisibleEligible.every(id => selectedRunIds.has(id));

  return (
    <div>
      {/* Year navigation */}
      <div className="flex items-center gap-2 mb-5">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Year</span>
        <div className="relative">
          <select
            value={activeYear}
            onChange={e => setActiveYear(Number(e.target.value))}
            className="appearance-none bg-white border border-surface-border rounded-lg pl-3 pr-7 py-1.5 text-sm font-semibold text-gray-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-200 transition-colors"
          >
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <button
          onClick={() => setActiveYear(y => Math.max(y - 1, minYear))}
          disabled={activeYear <= minYear}
          className="w-7 h-7 flex items-center justify-center rounded-lg border border-surface-border bg-white text-gray-400 hover:text-gray-700 hover:border-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={() => setActiveYear(y => Math.min(y + 1, maxYear))}
          disabled={activeYear >= maxYear}
          className="w-7 h-7 flex items-center justify-center rounded-lg border border-surface-border bg-white text-gray-400 hover:text-gray-700 hover:border-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Select-months toggle — only shown to writers when there are eligible months */}
        {canWrite && allEligibleRunIds.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {selectMode && allVisibleEligible.length > 0 && (
              <button
                onClick={() => {
                  if (allVisibleSelected) {
                    setSelectedRunIds(prev => {
                      const next = new Set(prev);
                      allVisibleEligible.forEach(id => next.delete(id));
                      return next;
                    });
                  } else {
                    setSelectedRunIds(prev => new Set([...prev, ...allVisibleEligible]));
                  }
                }}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                {allVisibleSelected ? "Deselect all" : "Select all"}
              </button>
            )}
            <button
              onClick={() => { setSelectMode(v => !v); setSelectedRunIds(new Set()); }}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                selectMode
                  ? "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
                  : "bg-white text-gray-600 border-surface-border hover:border-gray-300 hover:text-gray-900"
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="1" y="1" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="7" y="1" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="1" y="7" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M8.5 8.5l1 1 2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {selectMode ? "Selecting…" : "Select months"}
            </button>
          </div>
        )}
      </div>

      {/* 6 × 2 month grid */}
      <div className="grid grid-cols-6 gap-3">
        {grid.map(cm => {
          const href = `/payroll?month=${cm.month}&year=${cm.year}`;

          // Card container style
          let borderClass = "border border-surface-border hover:border-gray-300 hover:shadow-sm";
          if (cm.isSelected) borderClass = "border-2 border-indigo-500 shadow-sm";
          else if (cm.isCurrent && !cm.isSelected) borderClass = "border-2 border-indigo-200 hover:border-indigo-300";

          // Status icon (top-right)
          let icon: React.ReactNode = null;
          if (cm.isProcessed) {
            icon = (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <circle cx="8" cy="8" r="7" fill="#dcfce7" />
                <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            );
          } else if (cm.isFuture && cm.hasRun) {
            icon = (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <circle cx="8" cy="8" r="7" fill="#dbeafe" />
                <path d="M8 5v3.2l2 1.2" stroke="#2563eb" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            );
          } else if (cm.isCurrent && cm.hasRun) {
            icon = (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <circle cx="8" cy="8" r="7" fill="#ede9fe" />
                <path d="M8 5v3.2l2 1.2" stroke="#7c3aed" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            );
          } else if (cm.hasRun) {
            icon = <span className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-amber-100 shrink-0 mt-0.5" />;
          } else {
            icon = <span className="w-2.5 h-2.5 rounded-full bg-gray-200 shrink-0 mt-0.5" />;
          }

          // Status badge
          let badge: React.ReactNode = null;
          if (cm.isProcessed) {
            badge = <span className="self-start text-[10px] font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full leading-none">Processed</span>;
          } else if (cm.isPartial) {
            badge = <span className="self-start text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full leading-none">Partial ({cm.paidCount}/{cm.totalCount})</span>;
          } else if (cm.hasRun && cm.isPast) {
            badge = <span className="self-start text-[10px] font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded-full leading-none">Unprocessed</span>;
          } else if (cm.hasRun && cm.isFuture) {
            badge = <span className="self-start text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full leading-none">Upcoming</span>;
          } else if (cm.hasRun) {
            badge = <span className="self-start text-[10px] font-semibold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full leading-none">Pending</span>;
          } else {
            badge = <span className="self-start text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full leading-none">Not started</span>;
          }

          // Amount color
          const amountClass = cm.isSelected && !cm.isProcessed && cm.hasRun
            ? "text-indigo-600 font-bold"
            : cm.hasRun ? "text-gray-800 font-bold" : "text-gray-300 font-semibold";

          const amountStr = cm.hasRun && cm.monthUsdTotal > 0
            ? `$${Math.round(cm.monthUsdTotal).toLocaleString("en-US")}`
            : cm.hasRun ? "$0" : "—";

          const isEligible = eligibleInGrid(cm);
          const isChecked = cm.runId ? selectedRunIds.has(cm.runId) : false;

          const cardContent = (
            <div className={`rounded-xl p-4 bg-white flex flex-col h-[190px] transition-all relative ${borderClass} ${
              selectMode && isEligible ? "cursor-pointer" : ""
            } ${selectMode && isChecked ? "ring-2 ring-indigo-400" : ""} ${
              selectMode && !isEligible ? "opacity-50" : ""
            }`}>
              {/* Checkbox overlay in select mode */}
              {selectMode && isEligible && (
                <div className="absolute top-2.5 left-2.5">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => cm.runId && toggleRunId(cm.runId)}
                    onClick={e => e.stopPropagation()}
                    className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
                  />
                </div>
              )}

              {/* Month name + icon */}
              <div className={`flex items-start justify-between gap-1 mb-2 ${selectMode && isEligible ? "pl-5" : ""}`}>
                <span className={`text-sm font-bold leading-tight ${cm.isSelected && !selectMode ? "text-indigo-700" : cm.hasRun ? "text-gray-900" : "text-gray-500"}`}>
                  {MONTH_NAMES[cm.month - 1]}
                </span>
                {icon}
              </div>

              {/* Status badge */}
              {badge}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Footer: emp count + amount + arrow */}
              <div>
                <p className="text-xs text-gray-400 mb-1">
                  {cm.hasRun ? `${cm.totalCount} employee${cm.totalCount !== 1 ? "s" : ""}` : "0 employees"}
                </p>
                <div className="flex items-center justify-between">
                  <span className={`text-sm tabular-nums ${amountClass}`}>{amountStr}</span>
                  {!selectMode && (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={cm.isSelected ? "text-indigo-400" : "text-gray-200"}>
                      <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              </div>
            </div>
          );

          return selectMode ? (
            <div
              key={`${cm.year}-${cm.month}`}
              onClick={() => isEligible && cm.runId && toggleRunId(cm.runId)}
            >
              {cardContent}
            </div>
          ) : (
            <Link key={`${cm.year}-${cm.month}`} href={href}>
              {cardContent}
            </Link>
          );
        })}
      </div>

      {/* Floating bulk action bar */}
      {selectMode && selectedRunIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-2xl shadow-2xl">
          <span className="text-sm font-medium tabular-nums">
            {selectedRunIds.size} {selectedRunIds.size === 1 ? "month" : "months"} selected
          </span>
          <div className="w-px h-4 bg-white/20" />
          <button
            onClick={handleBulkProcess}
            disabled={bulkProcessing}
            className="flex items-center gap-1.5 text-sm font-semibold text-emerald-300 hover:text-emerald-200 disabled:opacity-50 transition-colors"
          >
            {bulkProcessing ? (
              <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M2 7l3.5 3.5L12 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            {bulkProcessing ? "Processing…" : "Mark as processed"}
          </button>
          <div className="w-px h-4 bg-white/20" />
          <button
            onClick={exitSelectMode}
            disabled={bulkProcessing}
            className="text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
