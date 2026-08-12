"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_LONG  = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function CalendarNav({
  year,
  month,
}: {
  year: number;
  month: number;
}) {
  const router  = useRouter();
  const [open, setOpen]     = useState(false);
  const [pickerYear, setPickerYear] = useState(year);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Reset picker year to current page year whenever the popover opens
  useEffect(() => {
    if (open) setPickerYear(year);
  }, [open, year]);

  function navigate(y: number, m: number) {
    setOpen(false);
    router.push(`/calendar?month=${y}-${String(m).padStart(2, "0")}`);
  }

  function prevMonth() {
    const d = new Date(year, month - 2, 1);
    router.push(`/calendar?month=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  function nextMonth() {
    const d = new Date(year, month, 1);
    router.push(`/calendar?month=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  function goToday() {
    const now = new Date();
    router.push(`/calendar?month=${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  }

  const today    = new Date();
  const isToday  = year === today.getFullYear() && month === today.getMonth() + 1;

  return (
    <div className="flex items-center gap-2">

      {/* Today button */}
      {!isToday && (
        <button
          onClick={goToday}
          className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full hover:bg-indigo-100 transition-colors"
        >
          Today
        </button>
      )}

      {/* Prev arrow */}
      <button
        onClick={prevMonth}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        aria-label="Previous month"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Month/year label — opens picker */}
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors
            ${open ? "bg-indigo-50 text-indigo-700" : "text-gray-700 hover:bg-gray-100"}`}
        >
          {MONTH_LONG[month - 1]} {year}
          <svg
            width="11" height="11" viewBox="0 0 11 11" fill="none"
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path d="M2 4l3.5 3.5L9 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Picker popover */}
        {open && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 bg-white border border-surface-border rounded-xl shadow-xl p-4 w-64">

            {/* Year row */}
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setPickerYear(y => y - 1)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Previous year"
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              <span className="text-sm font-bold text-gray-900">{pickerYear}</span>

              <button
                onClick={() => setPickerYear(y => y + 1)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Next year"
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>

            {/* Quick year chips */}
            <div className="flex gap-1.5 justify-center mb-3 flex-wrap">
              {[-1, 0, 1].map(delta => {
                const y = today.getFullYear() + delta;
                return (
                  <button
                    key={y}
                    onClick={() => setPickerYear(y)}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors
                      ${pickerYear === y
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                  >
                    {y}
                  </button>
                );
              })}
            </div>

            {/* Month grid */}
            <div className="grid grid-cols-4 gap-1">
              {MONTH_SHORT.map((label, i) => {
                const m         = i + 1;
                const isCurrent = pickerYear === year && m === month;
                const isNow     = pickerYear === today.getFullYear() && m === today.getMonth() + 1;
                return (
                  <button
                    key={m}
                    onClick={() => navigate(pickerYear, m)}
                    className={`py-1.5 text-[11px] font-medium rounded-lg transition-colors
                      ${isCurrent
                        ? "bg-indigo-600 text-white"
                        : isNow
                          ? "bg-indigo-50 text-indigo-700 font-semibold"
                          : "text-gray-600 hover:bg-gray-100"
                      }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

          </div>
        )}
      </div>

      {/* Next arrow */}
      <button
        onClick={nextMonth}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        aria-label="Next month"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

    </div>
  );
}
