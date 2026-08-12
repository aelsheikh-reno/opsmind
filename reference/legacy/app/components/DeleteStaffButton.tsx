"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteStaffButton({
  employeeName,
  personId,
  hidden,
}: {
  employeeName: string;
  personId: string | null;
  hidden?: boolean;
}) {
  if (hidden) return null;
  const [stage, setStage] = useState<"idle" | "confirm" | "loading">("idle");
  const [removeFromPayroll, setRemoveFromPayroll] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    setStage("loading");
    await fetch("/api/payroll/staff", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeName, personId, removeFromPayroll }),
    });
    router.refresh();
  }

  if (stage === "idle") {
    return (
      <button
        onClick={() => setStage("confirm")}
        title="Delete staff member"
        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all shrink-0"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path d="M2 3.5h10M5.5 3.5V2.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M6 6v4M8 6v4M3 3.5l.7 7.5a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L11 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }

  if (stage === "loading") {
    return (
      <svg width="13" height="13" viewBox="0 0 13 13" className="animate-spin text-gray-300 shrink-0" fill="none">
        <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="8 8" />
      </svg>
    );
  }

  // confirm stage — replaces the normal row actions
  return (
    <div className="w-full">
      <p className="text-[11px] font-semibold text-gray-700 mb-2">Delete {employeeName}?</p>

      <button
        onClick={() => setRemoveFromPayroll(false)}
        className={`w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-lg mb-1.5 border text-[11px] transition-colors ${
          !removeFromPayroll
            ? "border-indigo-200 bg-indigo-50 text-indigo-700"
            : "border-gray-100 text-gray-500 hover:bg-surface-inset"
        }`}
      >
        <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${!removeFromPayroll ? "border-indigo-500" : "border-gray-300"}`}>
          {!removeFromPayroll && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
        </span>
        Keep payroll history
      </button>

      <button
        onClick={() => setRemoveFromPayroll(true)}
        className={`w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-lg mb-3 border text-[11px] transition-colors ${
          removeFromPayroll
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-gray-100 text-gray-500 hover:bg-surface-inset"
        }`}
      >
        <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${removeFromPayroll ? "border-red-500" : "border-gray-300"}`}>
          {removeFromPayroll && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
        </span>
        Remove from all payroll months
      </button>

      <div className="flex items-center gap-2">
        <button
          onClick={handleDelete}
          className={`flex-1 text-[11px] font-semibold py-1.5 rounded-lg transition-colors ${
            removeFromPayroll
              ? "bg-red-600 hover:bg-red-700 text-white"
              : "bg-gray-800 hover:bg-gray-700 text-white"
          }`}
        >
          Delete
        </button>
        <button
          onClick={() => { setStage("idle"); setRemoveFromPayroll(false); }}
          className="flex-1 text-[11px] font-medium py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-surface-hover transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
