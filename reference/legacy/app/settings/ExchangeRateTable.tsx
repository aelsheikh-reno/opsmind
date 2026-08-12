"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export type RateRowData = {
  year: number;
  month: number;
  rates: Record<string, number | null>;
  source: "locked" | "historical" | "live" | "forecast";
  lockedOn?: string | null;
  runId?: string | null;
};

function SourceCell({
  row,
  pending,
  onLock,
}: {
  row: RateRowData;
  pending: string | null;
  onLock: (runId: string, action: "lock" | "unlock") => void;
}) {
  const isLoading = row.runId ? pending === row.runId : false;

  if (row.source === "locked") {
    return (
      <div className="flex items-center justify-end gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <rect x="1.5" y="3.5" width="5" height="4" rx="0.75" stroke="#4f46e5" strokeWidth="1" fill="none" />
            <path d="M2.5 3.5V2.5a1.5 1.5 0 0 1 3 0v1" stroke="#4f46e5" strokeWidth="1" strokeLinecap="round" fill="none" />
          </svg>
          {row.lockedOn ? `Locked ${row.lockedOn}` : "Locked"}
        </span>
        {row.runId && (
          <button
            onClick={() => onLock(row.runId!, "unlock")}
            disabled={isLoading}
            title="Remove lock — revert to historical rate"
            className="text-gray-300 hover:text-red-400 transition-colors disabled:opacity-40"
          >
            {isLoading ? (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="animate-spin">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="20 18" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="3" y="7" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M5.5 7V5.5a2.5 2.5 0 0 1 4.5-1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              </svg>
            )}
          </button>
        )}
      </div>
    );
  }

  if (row.source === "historical") {
    return (
      <div className="flex items-center justify-end gap-2">
        <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
          Historical
        </span>
        {row.runId && (
          <button
            onClick={() => onLock(row.runId!, "lock")}
            disabled={isLoading}
            title="Lock at this historical rate"
            className="text-gray-300 hover:text-indigo-500 transition-colors disabled:opacity-40"
          >
            {isLoading ? (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="animate-spin">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="20 18" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="3" y="7" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M5.5 7V4a2.5 2.5 0 0 1 5 0v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              </svg>
            )}
          </button>
        )}
      </div>
    );
  }

  if (row.source === "live") {
    return (
      <div className="flex justify-end">
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          Live · daily update
        </span>
      </div>
    );
  }

  return (
    <div className="flex justify-end">
      <span className="text-[10px] font-semibold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
        Forecast
      </span>
    </div>
  );
}

export default function ExchangeRateTable({
  rows,
  nowMonth,
  nowYear,
  currencies = ["EGP", "AED"],
}: {
  rows: RateRowData[];
  nowMonth: number;
  nowYear: number;
  currencies?: string[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  // Default: current year expanded; all others collapsed
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set([nowYear]));

  const handleLock = async (runId: string, action: "lock" | "unlock") => {
    setPending(runId);
    await fetch(`/api/payroll/rate-lock?runId=${runId}&action=${action}`, { method: "PATCH" });
    router.refresh();
    setPending(null);
  };

  const toggleYear = (year: number) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      next.has(year) ? next.delete(year) : next.add(year);
      return next;
    });
  };

  if (rows.length === 0) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-gray-400">
          No payroll months yet — set a payroll horizon year above or upload payroll data to see exchange rates here.
        </p>
      </div>
    );
  }

  // Group rows by year
  const byYear = new Map<number, RateRowData[]>();
  for (const row of rows) {
    if (!byYear.has(row.year)) byYear.set(row.year, []);
    byYear.get(row.year)!.push(row);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => a - b);

  return (
    <>
      <div className="divide-y divide-surface-border">
        {years.map((year) => {
          const yearRows = byYear.get(year)!;
          const isExpanded = expandedYears.has(year);
          const isCurrentYear = year === nowYear;
          const lockedCount = yearRows.filter((r) => r.source === "locked").length;
          const forecastCount = yearRows.filter((r) => r.source === "forecast").length;

          return (
            <div key={year}>
              {/* Year header / toggle */}
              <button
                onClick={() => toggleYear(year)}
                className="w-full flex items-center gap-3 px-5 py-3 bg-surface-inset hover:bg-surface-hover transition-colors text-left"
              >
                <svg
                  width="12" height="12" viewBox="0 0 12 12" fill="none"
                  className={`shrink-0 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                >
                  <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className={`text-sm font-bold ${isCurrentYear ? "text-indigo-700" : "text-gray-700"}`}>
                  {year}
                </span>
                {isCurrentYear && (
                  <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">
                    Current
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {lockedCount > 0 && (
                    <span className="text-[10px] font-semibold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">
                      {lockedCount} locked
                    </span>
                  )}
                  {forecastCount > 0 && (
                    <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      {forecastCount} forecast
                    </span>
                  )}
                  <span className="text-xs text-gray-400">{yearRows.length} months</span>
                </div>
              </button>

              {/* Months table */}
              {isExpanded && (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-border bg-surface-inset">
                      <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Month</th>
                      {currencies.map((c) => (
                        <th key={c} className="px-5 py-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-widest">USD → {c}</th>
                      ))}
                      <th className="px-5 py-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-widest w-48">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {yearRows.map((row) => {
                      const isCurrent = row.year === nowYear && row.month === nowMonth;
                      return (
                        <tr
                          key={`${row.year}-${row.month}`}
                          className={`transition-colors ${row.source === "forecast" ? "opacity-50" : "hover:bg-surface-hover"}`}
                        >
                          <td className="px-5 py-2.5">
                            <span className={`text-sm font-medium ${isCurrent ? "text-indigo-700" : "text-gray-900"}`}>
                              {MONTH_NAMES[row.month - 1]}
                            </span>
                            {isCurrent && (
                              <span className="ml-2 text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full align-middle">
                                Now
                              </span>
                            )}
                          </td>
                          {currencies.map((c) => (
                            <td key={c} className="px-5 py-2.5 text-right tabular-nums text-sm text-gray-700 font-medium">
                              {row.rates[c] != null ? row.rates[c]!.toFixed(4) : "—"}
                            </td>
                          ))}
                          <td className="px-5 py-2.5">
                            <SourceCell row={row} pending={pending} onLock={handleLock} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
      <p className="px-5 py-3 text-xs text-gray-400 border-t border-surface-border">
        <span className="font-semibold text-indigo-500">Locked</span> — fixed rate used for payroll conversion.{" "}
        <span className="font-semibold text-gray-500">Historical</span> — end-of-month rate from public records; click the lock icon to fix it.{" "}
        Use the toggle above to control whether new payroll runs lock automatically.
      </p>
    </>
  );
}
