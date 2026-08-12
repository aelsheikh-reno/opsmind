"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MarkPayrollProcessedButton({
  runId,
  isProcessed,
  processedAt,
  paidCount = 0,
  totalCount = 0,
  hidden,
}: {
  runId: string;
  isProcessed: boolean;
  processedAt: Date | null;
  paidCount?: number;
  totalCount?: number;
  hidden?: boolean;
}) {
  if (hidden) return null;
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(isProcessed);
  const isPartial = !done && paidCount > 0 && paidCount < totalCount;
  const [doneAt, setDoneAt] = useState<Date | null>(processedAt);
  const [confirmUnmark, setConfirmUnmark] = useState(false);
  const router = useRouter();

  async function markProcessed() {
    if (done) return;
    setLoading(true);
    const res = await fetch(`/api/payroll/processed?runId=${runId}`, { method: "PATCH" });
    if (res.ok) {
      setDone(true);
      setDoneAt(new Date());
      router.refresh();
    }
    setLoading(false);
  }

  async function unmark() {
    setLoading(true);
    setConfirmUnmark(false);
    const res = await fetch(`/api/payroll/processed?runId=${runId}&action=unmark`, { method: "PATCH" });
    if (res.ok) {
      setDone(false);
      setDoneAt(null);
      router.refresh();
    }
    setLoading(false);
  }

  if (done) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-100 px-3 py-1.5 rounded-lg">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="#15803d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Payroll processed
        </span>
        {doneAt && (
          <span className="text-xs text-gray-400">
            {doneAt instanceof Date
              ? doneAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
              : new Date(doneAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </span>
        )}
        {confirmUnmark ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Unmark as processed?</span>
            <button
              onClick={unmark}
              disabled={loading}
              className="text-xs font-medium text-red-600 hover:text-red-800 transition-colors disabled:opacity-50"
            >
              Yes, unmark
            </button>
            <button
              onClick={() => setConfirmUnmark(false)}
              className="text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmUnmark(true)}
            disabled={loading}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            Unmark
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {isPartial && (
        <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" stroke="#d97706" strokeWidth="1.3" fill="none" />
            <path d="M6 3.5v3M6 8v.5" stroke="#d97706" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Partial — {paidCount}/{totalCount} paid
        </span>
      )}
      <button
        onClick={markProcessed}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 px-3 py-1.5 rounded-lg transition-colors"
      >
      {loading ? (
        <>
          <svg width="12" height="12" viewBox="0 0 12 12" className="animate-spin" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="white" strokeWidth="1.5" strokeDasharray="7 7" />
          </svg>
          Processing…
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Mark payroll as processed
        </>
      )}
      </button>
    </div>
  );
}
