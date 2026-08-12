"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Budget = { id: string; name: string; color: string | null };

export default function PayrollBudgetSelect({
  entryId,
  budgetId,
  budgets,
  hidden,
}: {
  entryId: string;
  budgetId: string | null;
  budgets: Budget[];
  hidden?: boolean;
}) {
  const router  = useRouter();
  const [saving, setSaving] = useState(false);

  if (hidden) return null;

  async function save(newBudgetId: string | null) {
    setSaving(true);
    await fetch("/api/payroll/entry/budget", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ entryId, budgetId: newBudgetId }),
    });
    setSaving(false);
    router.refresh();
  }

  const current = budgets.find(b => b.id === budgetId);

  return (
    <div className="flex items-center gap-1.5 mt-1">
      {saving ? (
        <div className="flex items-center gap-1 text-[10px] text-indigo-500">
          <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/>
          </svg>
          Saving…
        </div>
      ) : (
        <div className="relative flex items-center gap-1">
          {current?.color && (
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: current.color }} />
          )}
          <select
            value={budgetId ?? ""}
            onChange={e => save(e.target.value || null)}
            className="text-[10px] text-gray-500 bg-transparent border-0 outline-none cursor-pointer hover:text-indigo-600 pr-3 appearance-none max-w-[140px] truncate"
            title={current?.name ?? "Assign to budget"}
          >
            <option value="">— No budget —</option>
            {budgets.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <svg className="absolute right-0 pointer-events-none text-gray-400" width="8" height="8" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}
    </div>
  );
}
