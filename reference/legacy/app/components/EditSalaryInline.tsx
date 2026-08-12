"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useActiveCurrencies } from "@/lib/useActiveCurrencies";

export default function EditSalaryInline({
  personId,
  salary,
  currency,
}: {
  personId: string;
  salary: number | null;
  currency: string;
}) {
  const activeCurrencies = useActiveCurrencies();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(salary?.toString() ?? "");
  const [cur, setCur] = useState(currency || "AED");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function startEdit() {
    setAmount(salary?.toString() ?? "");
    setCur(currency || "AED");
    setEditing(true);
  }

  async function save() {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed < 0) return;
    setLoading(true);
    await fetch(`/api/people/${personId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ salary: parsed, salaryCurrency: cur }),
    });
    setLoading(false);
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <select
            value={cur}
            onChange={(e) => setCur(e.target.value)}
            className="text-xs font-semibold border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 text-gray-700"
          >
            {activeCurrencies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            autoFocus
            className="w-36 text-xl font-bold border border-gray-200 rounded-lg px-2.5 py-1 tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-300 text-gray-900"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={loading}
            className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            {loading ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
          >
            Cancel
          </button>
        </div>
        <p className="text-[10px] text-gray-400">Updates all unpaid payroll entries for this person</p>
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-2 group">
      <p className="text-2xl font-bold text-gray-900 tabular-nums">
        {salary != null ? `${currency} ${salary.toLocaleString("en-US")}` : <span className="text-gray-300">—</span>}
      </p>
      <button
        onClick={startEdit}
        title="Edit salary"
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-100"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z" stroke="#9ca3af" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
        </svg>
      </button>
    </div>
  );
}
