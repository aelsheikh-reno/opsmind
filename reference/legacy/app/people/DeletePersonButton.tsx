"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeletePersonButton({ personId, personName, redirectTo }: { personId: string; personName: string; redirectTo?: string }) {
  const router = useRouter();
  const [open, setOpen]               = useState(false);
  const [deletePayroll, setDeletePayroll] = useState(false);
  const [loading, setLoading]         = useState(false);

  async function handleDelete() {
    setLoading(true);
    try {
      const res = await fetch(`/api/people/${personId}?deletePayroll=${deletePayroll}`, { method: "DELETE" });
      if (res.ok) {
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={e => { e.preventDefault(); setOpen(true); }}
        className="p-1.5 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
        title="Delete person"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 3.5h10M5.5 3.5V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M11.5 3.5l-.7 7.7a.5.5 0 0 1-.5.3H3.7a.5.5 0 0 1-.5-.3L2.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M5.5 6.5v3M8.5 6.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => !loading && setOpen(false)}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center shrink-0 mt-0.5">
              <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
                <path d="M2 3.5h10M5.5 3.5V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M11.5 3.5l-.7 7.7a.5.5 0 0 1-.5.3H3.7a.5.5 0 0 1-.5-.3L2.5 3.5" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5.5 6.5v3M8.5 6.5v3" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Delete {personName}?</p>
              <p className="text-xs text-gray-500 mt-0.5">This will permanently remove their profile and all associated records.</p>
            </div>
          </div>

          <div className="mt-4 border border-gray-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setDeletePayroll(false)}
              className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${!deletePayroll ? "bg-indigo-50" : "hover:bg-gray-50"}`}
            >
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center mt-0.5 shrink-0 ${!deletePayroll ? "border-indigo-600" : "border-gray-300"}`}>
                {!deletePayroll && <div className="w-2 h-2 rounded-full bg-indigo-600" />}
              </div>
              <div>
                <p className={`text-xs font-semibold ${!deletePayroll ? "text-indigo-800" : "text-gray-700"}`}>Keep payroll history</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Payroll entries are retained for accounting records</p>
              </div>
            </button>
            <div className="border-t border-gray-200" />
            <button
              type="button"
              onClick={() => setDeletePayroll(true)}
              className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${deletePayroll ? "bg-red-50" : "hover:bg-gray-50"}`}
            >
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center mt-0.5 shrink-0 ${deletePayroll ? "border-red-500" : "border-gray-300"}`}>
                {deletePayroll && <div className="w-2 h-2 rounded-full bg-red-500" />}
              </div>
              <div>
                <p className={`text-xs font-semibold ${deletePayroll ? "text-red-700" : "text-gray-700"}`}>Delete payroll history</p>
                <p className="text-[11px] text-gray-400 mt-0.5">All payroll entries for this person will be permanently removed</p>
              </div>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={() => { setOpen(false); setDeletePayroll(false); }}
            disabled={loading}
            className="text-sm font-medium text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2 rounded-lg transition-colors flex items-center gap-2"
          >
            {loading && (
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3"/>
                <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            )}
            {loading ? "Deleting…" : "Delete person"}
          </button>
        </div>
      </div>
    </div>
  );
}
