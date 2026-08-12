"use client";

import { useState, useRef } from "react";
import Link from "next/link";

// ── Shared type (imported by page.tsx too) ───────────────────────────────────

export type EventType = "collection" | "payroll" | "lease" | "renewal";

export type CalEvent = {
  key:        string;
  type:       EventType;
  label:      string;
  amountUsd:  number;
  isPaid:     boolean;
  href:       string;
  // Tooltip detail fields
  dueDate:        string;        // "15 Mar 2026"
  issueDate?:     string;        // invoices: "1 Feb 2026"
  nativeAmount?:  string;        // "EGP 450,000" — omitted if USD
  nativeCurrency?: string;
  referenceNumber?: string;
  allParties:     string[];
  docTypeName?:   string;        // "Lease contract" / "Client contract"
  employeeCount?: number;        // payroll
  periodLabel?:   string;        // "March 2026" for payroll
};

export const TYPE_META: Record<EventType, { label: string; dot: string; bg: string; text: string }> = {
  collection: { label: "Collection",   dot: "#10b981", bg: "bg-emerald-50", text: "text-emerald-700" },
  payroll:    { label: "Payroll run",  dot: "#6366f1", bg: "bg-indigo-50",  text: "text-indigo-700"  },
  lease:      { label: "Lease / rent", dot: "#f97316", bg: "bg-orange-50",  text: "text-orange-700"  },
  renewal:    { label: "Renewal due",  dot: "#f59e0b", bg: "bg-amber-50",   text: "text-amber-700"   },
};

function fmt(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CalendarEventChip({
  ev,
  isPast,
}: {
  ev: CalEvent;
  isPast: boolean;
}) {
  const [tooltip, setTooltip] = useState<{ top: number; left: number } | null>(null);
  const chipRef = useRef<HTMLAnchorElement>(null);

  const meta      = TYPE_META[ev.type];
  const isOverdue = isPast && !ev.isPaid && ev.type !== "renewal";

  let bgClass   = meta.bg;
  let textClass = meta.text;
  let dotColor  = meta.dot;

  if (ev.isPaid)     { bgClass = "bg-gray-50"; textClass = "text-gray-400"; dotColor = "#d1d5db"; }
  else if (isOverdue){ bgClass = "bg-red-50";  textClass = "text-red-600";  dotColor = "#f87171"; }

  function handleMouseEnter() {
    if (!chipRef.current) return;
    const rect     = chipRef.current.getBoundingClientRect();
    const tipW     = 252;
    const tipH     = 200; // conservative estimate

    let top  = rect.bottom + 6;
    if (top + tipH > window.innerHeight - 12) top = rect.top - tipH - 6;

    let left = rect.left;
    if (left + tipW > window.innerWidth - 12) left = window.innerWidth - tipW - 12;
    if (left < 12) left = 12;

    setTooltip({ top, left });
  }

  // Status label + style
  const statusLabel = ev.isPaid
    ? "Paid"
    : ev.type === "payroll" && ev.isPaid
      ? "Processed"
      : isOverdue
        ? "Overdue"
        : ev.type === "renewal"
          ? "Action needed"
          : "Pending";

  const statusStyle = ev.isPaid
    ? "bg-gray-100 text-gray-400"
    : isOverdue
      ? "bg-red-50 text-red-600"
      : ev.type === "renewal"
        ? "bg-amber-50 text-amber-700"
        : `${meta.bg} ${meta.text}`;

  return (
    <>
      <Link
        ref={chipRef}
        href={ev.href}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setTooltip(null)}
        className={`flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-medium transition-opacity hover:opacity-80 ${bgClass} ${textClass} ${ev.isPaid ? "line-through" : ""}`}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
        <span className="truncate min-w-0">{ev.label}</span>
        {ev.amountUsd > 0 && !ev.isPaid && (
          <span className="ml-auto shrink-0 font-semibold tabular-nums">{fmt(ev.amountUsd)}</span>
        )}
      </Link>

      {tooltip && (
        <div
          style={{ position: "fixed", top: tooltip.top, left: tooltip.left, width: 252, zIndex: 9999 }}
          className="pointer-events-none bg-white rounded-xl shadow-xl border border-surface-border p-3 text-left"
        >
          {/* Header: type badge + status */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest ${meta.text}`}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.dot }} />
              {meta.label}
            </span>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${statusStyle}`}>
              {statusLabel}
            </span>
          </div>

          {/* Primary label */}
          <p className="text-[12px] font-semibold text-gray-900 leading-tight mb-2.5">{ev.label}</p>

          {/* Detail rows */}
          <div className="border-t border-surface-border pt-2 space-y-1.5">

            {/* Parties (if more than just the label) */}
            {ev.allParties.length > 0 && (
              <DetailRow label="Parties">
                {ev.allParties.join(", ")}
              </DetailRow>
            )}

            {/* Reference number */}
            {ev.referenceNumber && (
              <DetailRow label="Reference">#{ev.referenceNumber}</DetailRow>
            )}

            {/* Document type (for renewals / schedules) */}
            {ev.docTypeName && (
              <DetailRow label="Type">{ev.docTypeName}</DetailRow>
            )}

            {/* Payroll period + employee count */}
            {ev.periodLabel && (
              <DetailRow label="Period">{ev.periodLabel}</DetailRow>
            )}
            {ev.employeeCount !== undefined && (
              <DetailRow label="Employees">{ev.employeeCount}</DetailRow>
            )}

            {/* Issue date (invoices) */}
            {ev.issueDate && (
              <DetailRow label="Issued">{ev.issueDate}</DetailRow>
            )}

            {/* Due / expiry date */}
            <DetailRow label={ev.type === "renewal" ? "Expires" : "Due date"}>
              {ev.dueDate}
            </DetailRow>

            {/* Amount rows */}
            {ev.nativeAmount && ev.nativeCurrency && (
              <DetailRow label={ev.nativeCurrency}>{ev.nativeAmount}</DetailRow>
            )}
            {ev.amountUsd > 0 && (
              <DetailRow label="USD">{fmt(ev.amountUsd)}</DetailRow>
            )}

          </div>
        </div>
      )}
    </>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[10px] text-gray-400 shrink-0 pt-px">{label}</span>
      <span className="text-[10px] font-medium text-gray-700 text-right leading-snug">{children}</span>
    </div>
  );
}
