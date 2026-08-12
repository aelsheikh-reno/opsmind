"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";

export type StaffWithBudget = {
  employeeName: string;
  personId: string | null;
  personName: string | null;
  budgetId: string | null;
  budgetName: string | null;
  budgetColor: string | null;
};

type Budget = { id: string; name: string; color: string | null };

export default function PayrollBudgetPanel({
  staffList: initialStaffList,
  budgets,
  canWrite,
}: {
  staffList: StaffWithBudget[];
  budgets: Budget[];
  canWrite: boolean;
}) {
  const [staffList, setStaffList] = useState(initialStaffList);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignBudgetId, setAssignBudgetId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = staffList.length > 0 && selected.size === staffList.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(staffList.map(s => s.employeeName)));
  }

  const toggleOne = useCallback((name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  async function assign() {
    if (!selected.size) return;
    setSaving(true);
    setError(null);
    const names = Array.from(selected);
    try {
      const res = await fetch("/api/payroll/bulk-assign-budget", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeNames: names, budgetId: assignBudgetId || null }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed to assign");
        return;
      }
      const data = await res.json();
      const updated: number = data.updated ?? 0;
      const budget = assignBudgetId ? (budgets.find(b => b.id === assignBudgetId) ?? null) : null;

      if (budget) {
        toast.success(`Budget assigned: ${budget.name}`, {
          description: `${updated} payroll ${updated === 1 ? "entry" : "entries"} updated — past and current months only. Future payrolls are not affected.`,
          duration: 6000,
        });
      } else {
        toast.success("Budget removed", {
          description: `Cleared from ${updated} payroll ${updated === 1 ? "entry" : "entries"} across all months.`,
          duration: 5000,
        });
      }

      setStaffList(prev => prev.map(s =>
        selected.has(s.employeeName)
          ? { ...s, budgetId: budget?.id ?? null, budgetName: budget?.name ?? null, budgetColor: budget?.color ?? null }
          : s
      ));
      setSelected(new Set());
      setAssignBudgetId("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Panel header */}
      <div className="px-4 py-3.5 border-b border-surface-border">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Budget assignments</h2>
          <span className="text-xs text-gray-400">{staffList.length} people</span>
        </div>
        <p className="text-xs text-gray-400 mt-0.5">Assign all payroll entries to a budget</p>
      </div>

      {/* Bulk assign bar — appears when rows are selected */}
      {selected.size > 0 && (
        <div className="px-3 py-2.5 border-b border-surface-border bg-indigo-50 flex flex-col gap-2">
          <p className="text-[10px] font-semibold text-indigo-700">
            {selected.size} {selected.size === 1 ? "person" : "people"} selected
          </p>
          <div className="flex items-center gap-2">
            <select
              value={assignBudgetId}
              onChange={e => setAssignBudgetId(e.target.value)}
              className="flex-1 text-xs border border-indigo-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 min-w-0"
            >
              <option value="">Remove budget</option>
              {budgets.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <button
              onClick={assign}
              disabled={saving}
              className="shrink-0 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-md disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Assign"}
            </button>
          </div>
          {error && <p className="text-[10px] text-red-600">{error}</p>}
        </div>
      )}

      {/* Select-all row */}
      <div className="px-4 py-2 border-b border-surface-border bg-surface-inset">
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allSelected}
            ref={el => { if (el) el.indeterminate = someSelected; }}
            onChange={toggleAll}
            disabled={!canWrite}
            className="w-3.5 h-3.5 rounded accent-indigo-600"
          />
          <span className="text-[11px] text-gray-500 font-medium">
            {allSelected ? "Deselect all" : "Select all"}
          </span>
        </label>
      </div>

      {/* Staff rows */}
      <div className="divide-y divide-[#EEEAE0] max-h-[calc(100vh-300px)] overflow-y-auto">
        {staffList.map(staff => (
          <label
            key={staff.employeeName}
            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
              selected.has(staff.employeeName) ? "bg-indigo-50/60" : ""
            } ${!canWrite ? "cursor-default" : ""}`}
          >
            <input
              type="checkbox"
              checked={selected.has(staff.employeeName)}
              onChange={() => toggleOne(staff.employeeName)}
              disabled={!canWrite}
              className="w-3.5 h-3.5 rounded shrink-0 accent-indigo-600"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-700 truncate leading-snug">
                {staff.employeeName}
              </p>
              {staff.budgetName ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium leading-snug mt-0.5"
                  style={{ color: staff.budgetColor ?? "#6366f1" }}>
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: staff.budgetColor ?? "#6366f1" }}
                  />
                  {staff.budgetName}
                </span>
              ) : (
                <span className="block text-[10px] text-gray-300 leading-snug mt-0.5">No budget</span>
              )}
            </div>
          </label>
        ))}
      </div>
    </>
  );
}
