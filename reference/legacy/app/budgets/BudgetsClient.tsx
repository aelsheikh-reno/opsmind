"use client";

import { useState } from "react";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";

// ─── types ────────────────────────────────────────────────────────────────────

type BudgetExpense = {
  id: string;
  name: string;
  amount: number | null;
  currency: string;
  expenseType: string | null;
  dueOn: string | null;
  completed: boolean;
  claimStatus: string | null;
  submitterEmail: string | null;
  personId: string | null;
  asanaTaskGid: string | null;
  createdAt: string;
};

type PayrollEntry = {
  id: string;
  employeeName: string;
  salary: number;
  currency: string;
  isPaid: boolean;
  payrollRun: { month: number | null; year: number | null };
};

type Budget = {
  id: string;
  name: string;
  amount: number;
  currency: string;
  color: string | null;
  category: string | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  active: boolean;
  isArchived: boolean;
  createdAt: string;
  expenses: BudgetExpense[];
  payrollEntries: PayrollEntry[];
};

type Props = {
  initialBudgets: Budget[];
  initialUnassigned: BudgetExpense[];
  fxRates: Record<string, number>;
};

// ─── constants ────────────────────────────────────────────────────────────────

const EXPENSE_TYPES = [
  "Supplies", "Travel", "Accommodation", "Food & Beverage",
  "Software & Subscriptions", "Marketing & Advertising", "Entertainment",
  "Training & Education", "Equipment", "Utilities", "Professional Services",
  "Medical", "Miscellaneous",
];

const BUDGET_COLORS = [
  // Blues & Indigos
  { label: "Indigo",      value: "#6366f1" },
  { label: "Blue",        value: "#3b82f6" },
  { label: "Sky",         value: "#0ea5e9" },
  { label: "Cyan",        value: "#06b6d4" },
  // Greens
  { label: "Teal",        value: "#14b8a6" },
  { label: "Emerald",     value: "#10b981" },
  { label: "Green",       value: "#22c55e" },
  { label: "Lime",        value: "#84cc16" },
  // Purples
  { label: "Violet",      value: "#8b5cf6" },
  { label: "Purple",      value: "#a855f7" },
  { label: "Fuchsia",     value: "#d946ef" },
  { label: "Pink",        value: "#ec4899" },
  // Reds & Oranges
  { label: "Rose",        value: "#f43f5e" },
  { label: "Red",         value: "#ef4444" },
  { label: "Orange",      value: "#f97316" },
  { label: "Amber",       value: "#f59e0b" },
  { label: "Yellow",      value: "#eab308" },
  // Neutrals & Dark
  { label: "Stone",       value: "#78716c" },
  { label: "Slate",       value: "#64748b" },
  { label: "Zinc",        value: "#71717a" },
  { label: "Dark Blue",   value: "#1e40af" },
  { label: "Dark Green",  value: "#166534" },
  { label: "Dark Purple", value: "#6b21a8" },
  { label: "Dark Rose",   value: "#9f1239" },
];

// ─── helpers ─────────────────────────────────────────────────────────────────

function toUSD(amount: number, currency: string, rates: Record<string, number>) {
  if (currency === "USD") return amount;
  const r = rates[currency];
  return r ? amount / r : amount;
}

function convertToCurrency(amountUSD: number, targetCurrency: string, rates: Record<string, number>) {
  if (targetCurrency === "USD") return amountUSD;
  const r = rates[targetCurrency];
  return r ? amountUSD * r : amountUSD;
}

function fmtAmount(amount: number, currency: string) {
  return `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
}

function spentInBudgetCurrency(budget: Budget, rates: Record<string, number>): number {
  const expenseTotal = budget.expenses.reduce((sum, e) => {
    if (e.amount == null || e.claimStatus === "rejected") return sum;
    const usd = toUSD(e.amount, e.currency, rates);
    return sum + convertToCurrency(usd, budget.currency, rates);
  }, 0);
  const salaryTotal = budget.payrollEntries.reduce((sum, e) => {
    const usd = toUSD(e.salary, e.currency, rates);
    return sum + convertToCurrency(usd, budget.currency, rates);
  }, 0);
  return expenseTotal + salaryTotal;
}

function statusBadge(e: BudgetExpense) {
  if (e.claimStatus === "pending")  return { label: "Pending",  cls: "bg-amber-50 text-amber-700 border-amber-200" };
  if (e.claimStatus === "approved") return { label: "Approved", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (e.claimStatus === "rejected") return { label: "Rejected", cls: "bg-red-50 text-red-500 border-red-200" };
  if (e.completed)                  return { label: "Paid",     cls: "bg-blue-50 text-blue-700 border-blue-200" };
  return { label: "Pending payment", cls: "bg-gray-100 text-gray-500 border-gray-200" };
}

// ─── empty form factories ────────────────────────────────────────────────────

function emptyBudgetForm() {
  return { name: "", amount: "", currency: "AED", color: BUDGET_COLORS[0].value, category: "", startDate: "", endDate: "", notes: "" };
}

function emptyExpenseForm(currency: string) {
  return { name: "", amount: "", currency, expenseType: "" };
}

// ─── component ────────────────────────────────────────────────────────────────

export default function BudgetsClient({ initialBudgets, initialUnassigned, fxRates }: Props) {
  const activeCurrencies = useActiveCurrencies();

  const [budgets, setBudgets]           = useState<Budget[]>(initialBudgets);
  const [unassigned, setUnassigned]     = useState<BudgetExpense[]>(initialUnassigned);
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [showNewBudget, setShowNewBudget] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [showLinkPanel, setShowLinkPanel] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [budgetForm, setBudgetForm]     = useState(emptyBudgetForm());
  const [expenseForm, setExpenseForm]   = useState(emptyExpenseForm("AED"));
  const [saving, setSaving]             = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [linkSearch, setLinkSearch]     = useState("");
  const [linking, setLinking]           = useState<string | null>(null);
  const [unlinking, setUnlinking]       = useState<string | null>(null);
  const [error, setError]               = useState("");
  const [fixingAmount, setFixingAmount] = useState<{ id: string; amount: string; currency: string } | null>(null);
  const [savingFix, setSavingFix]       = useState(false);
  const [hoveredSegId, setHoveredSegId] = useState<string | null>(null);

  const selectedBudget = budgets.find(b => b.id === selectedId) ?? null;

  const activeBudgetsList  = budgets.filter(b => !b.isArchived);
  const archivedBudgets    = budgets.filter(b => b.isArchived);

  // Summary totals in USD — exclude archived
  const totalAllocatedUSD = activeBudgetsList.filter(b => b.active).reduce((s, b) => s + toUSD(b.amount, b.currency, fxRates), 0);
  const totalSpentUSD     = activeBudgetsList.filter(b => b.active).reduce((s, b) => s + toUSD(spentInBudgetCurrency(b, fxRates), b.currency, fxRates), 0);
  const totalRemainingUSD = totalAllocatedUSD - totalSpentUSD;

  // ── budget CRUD ──────────────────────────────────────────────────────────
  async function saveBudget(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const isEdit = !!editingBudget;
      const url  = isEdit ? `/api/budgets/${editingBudget!.id}` : "/api/budgets";
      const method = isEdit ? "PATCH" : "POST";
      const res  = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(budgetForm) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Error saving budget"); return; }
      if (isEdit) {
        setBudgets(prev => prev.map(b =>
          b.id === editingBudget!.id ? { ...data.budget, payrollEntries: b.payrollEntries } : b
        ));
      } else {
        setBudgets(prev => [{ ...data.budget, payrollEntries: [] }, ...prev]);
      }
      setShowNewBudget(false);
      setEditingBudget(null);
      setBudgetForm(emptyBudgetForm());
    } finally {
      setSaving(false);
    }
  }

  async function deleteBudget(id: string) {
    const res = await fetch(`/api/budgets/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setBudgets(prev => prev.filter(b => b.id !== id));
    if (selectedId === id) setSelectedId(null);
    setConfirmDeleteId(null);
  }

  async function archiveBudget(id: string, archive: boolean) {
    setArchiving(id);
    const res = await fetch(`/api/budgets/${id}/archive`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isArchived: archive }),
    });
    if (res.ok) {
      setBudgets(prev => prev.map(b => b.id === id ? { ...b, isArchived: archive } : b));
      if (archive && selectedId === id) setSelectedId(null);
    }
    setArchiving(null);
  }

  function startEdit(budget: Budget) {
    setBudgetForm({
      name:      budget.name,
      amount:    String(budget.amount),
      currency:  budget.currency,
      color:     budget.color ?? BUDGET_COLORS[0].value,
      category:  budget.category ?? "",
      startDate: budget.startDate ? budget.startDate.slice(0, 10) : "",
      endDate:   budget.endDate   ? budget.endDate.slice(0, 10)   : "",
      notes:     budget.notes ?? "",
    });
    setEditingBudget(budget);
    setShowNewBudget(true);
  }

  // ── expense linking ──────────────────────────────────────────────────────
  async function linkExpense(expenseId: string, budgetId: string) {
    setLinking(expenseId);
    const expense = unassigned.find(e => e.id === expenseId)!;
    const res = await fetch(`/api/expenses/${expenseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: expense.name, budgetId }),
    });
    if (!res.ok) { setLinking(null); return; }
    // Use the original local expense object — it has the correct amount/currency from the DB
    // (the PATCH only touches budgetId, not the expense's financial fields)
    setUnassigned(prev => prev.filter(e => e.id !== expenseId));
    setBudgets(prev => prev.map(b =>
      b.id === budgetId ? { ...b, expenses: [expense, ...b.expenses] } : b
    ));
    setLinking(null);
  }

  async function unlinkExpense(expense: BudgetExpense, budgetId: string) {
    setUnlinking(expense.id);
    const res = await fetch(`/api/expenses/${expense.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: expense.name, budgetId: null }),
    });
    if (!res.ok) { setUnlinking(null); return; }
    setBudgets(prev => prev.map(b => b.id === budgetId ? { ...b, expenses: b.expenses.filter(e => e.id !== expense.id) } : b));
    setUnassigned(prev => [expense, ...prev]);
    setUnlinking(null);
  }

  // ── fix null amount on an expense (corrupted or never set) ──────────────
  async function saveAmountFix(expenseId: string, expenseName: string) {
    if (!fixingAmount || !fixingAmount.amount) return;
    setSavingFix(true);
    const res = await fetch(`/api/expenses/${expenseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: expenseName,
        amount: fixingAmount.amount,
        currency: fixingAmount.currency,
      }),
    });
    if (!res.ok) { setSavingFix(false); return; }
    const updated = { amount: parseFloat(fixingAmount.amount), currency: fixingAmount.currency };
    // Update in budgets (linked)
    setBudgets(prev => prev.map(b => ({
      ...b,
      expenses: b.expenses.map(e => e.id === expenseId ? { ...e, ...updated } : e),
    })));
    // Update in unassigned list too if present
    setUnassigned(prev => prev.map(e => e.id === expenseId ? { ...e, ...updated } : e));
    setFixingAmount(null);
    setSavingFix(false);
  }

  // ── add expense directly to budget ──────────────────────────────────────
  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBudget) return;
    setSavingExpense(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...expenseForm, budgetId: selectedBudget.id }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const newExp: BudgetExpense = {
        id:            data.expense.id,
        name:          data.expense.name,
        amount:        data.expense.amount,
        currency:      data.expense.currency,
        expenseType:   data.expense.expenseType ?? null,
        dueOn:         data.expense.dueOn ? new Date(data.expense.dueOn).toISOString() : null,
        completed:     data.expense.completed ?? false,
        claimStatus:   data.expense.claimStatus ?? null,
        submitterEmail: data.expense.submitterEmail ?? null,
        personId:      data.expense.personId ?? null,
        asanaTaskGid:  null,
        createdAt:     new Date(data.expense.createdAt).toISOString(),
      };
      setBudgets(prev => prev.map(b => b.id === selectedBudget.id ? { ...b, expenses: [newExp, ...b.expenses] } : b));
      setExpenseForm(emptyExpenseForm(selectedBudget.currency));
      setShowAddExpense(false);
    } finally {
      setSavingExpense(false);
    }
  }

  // ── filtered unassigned for link panel ──────────────────────────────────
  const filteredUnassigned = linkSearch.trim()
    ? unassigned.filter(e => e.name.toLowerCase().includes(linkSearch.toLowerCase()) || (e.expenseType ?? "").toLowerCase().includes(linkSearch.toLowerCase()))
    : unassigned;

  const isBudgetFormOpen = showNewBudget || !!editingBudget;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Budgets</h1>
          <p className="text-sm text-gray-400 mt-0.5">Allocate budgets and track spending by category</p>
        </div>
        <button
          onClick={() => { setBudgetForm(emptyBudgetForm()); setEditingBudget(null); setShowNewBudget(true); }}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          New Budget
        </button>
      </div>

      {/* Summary bar */}
      {activeBudgetsList.some(b => b.active) && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: "Total Allocated", value: `USD ${Math.round(totalAllocatedUSD).toLocaleString("en-US")}`, cls: "text-gray-900" },
            { label: "Total Spent",     value: `USD ${Math.round(totalSpentUSD).toLocaleString("en-US")}`,     cls: "text-gray-900" },
            { label: "Total Remaining", value: `USD ${Math.round(totalRemainingUSD).toLocaleString("en-US")}`, cls: totalRemainingUSD >= 0 ? "text-emerald-600" : "text-red-500" },
          ].map(item => (
            <div key={item.label} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <p className="text-[11px] text-gray-400 mb-0.5">{item.label}</p>
              <p className={`text-base font-bold ${item.cls}`}>{item.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Chart section */}
      {activeBudgetsList.some(b => b.active) && (() => {
        const activeBudgets = activeBudgetsList.filter(b => b.active);
        const r = 72, cx = 100, cy = 100, strokeW = 28;
        const circ = 2 * Math.PI * r;

        // Build donut segments: each budget's spent, then total remaining
        type DonutSeg = { id: string; name: string; color: string; usdVal: number };
        const spentSegs: DonutSeg[] = activeBudgets
          .map(b => ({
            id: b.id,
            name: b.name,
            color: b.color ?? "#6366f1",
            usdVal: toUSD(spentInBudgetCurrency(b, fxRates), b.currency, fxRates),
          }))
          .filter(s => s.usdVal > 0);

        const remainingUSD = Math.max(0, totalRemainingUSD);
        const allSegs: DonutSeg[] = [
          ...spentSegs,
          ...(remainingUSD > 0 ? [{ id: "remaining", name: "Remaining", color: "#e5e7eb", usdVal: remainingUSD }] : []),
        ];

        const overallPct = totalAllocatedUSD > 0 ? Math.round((totalSpentUSD / totalAllocatedUSD) * 100) : 0;

        let cumLen = 0;
        const arcs = allSegs.map(seg => {
          const pct = totalAllocatedUSD > 0 ? seg.usdVal / totalAllocatedUSD : 0;
          const segLen = pct * circ;
          const arc = { ...seg, pct, segLen, dashoffset: -cumLen };
          cumLen += segLen;
          return arc;
        });

        const hoveredArc = arcs.find(a => a.id === hoveredSegId) ?? null;

        return (
          <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Budget utilization</p>
            <div className="flex gap-8 items-center">

              {/* Donut chart */}
              <div className="shrink-0 relative" style={{ width: 200, height: 200 }}>
                <svg width={200} height={200} viewBox="0 0 200 200">
                  <g transform={`rotate(-90 ${cx} ${cy})`}>
                    {/* Track */}
                    <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth={strokeW + 2} />
                    {totalAllocatedUSD === 0 ? (
                      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth={strokeW} />
                    ) : arcs.map(arc => (
                      <circle
                        key={arc.id}
                        cx={cx} cy={cy} r={r}
                        fill="none"
                        stroke={arc.color}
                        strokeWidth={hoveredSegId === arc.id ? strokeW + 6 : strokeW}
                        strokeDasharray={`${arc.segLen} ${circ - arc.segLen}`}
                        strokeDashoffset={arc.dashoffset}
                        strokeLinecap="butt"
                        pointerEvents="visibleStroke"
                        style={{ cursor: "pointer", transition: "stroke-width 0.15s ease" }}
                        onMouseEnter={() => setHoveredSegId(arc.id)}
                        onMouseLeave={() => setHoveredSegId(null)}
                      />
                    ))}
                  </g>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                  {hoveredArc ? (
                    <>
                      <p className="text-2xl font-extrabold text-gray-900 leading-none">
                        {Math.round(hoveredArc.pct * 100)}%
                      </p>
                      <p className="text-[11px] text-gray-500 mt-1 max-w-[90px] leading-snug">
                        {hoveredArc.id === "remaining" ? "Remaining" : hoveredArc.name}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-3xl font-extrabold text-gray-900 leading-none">{overallPct}%</p>
                      <p className="text-[11px] text-gray-400 mt-1">budget used</p>
                    </>
                  )}
                </div>
              </div>

              {/* Per-budget horizontal bars */}
              <div className="flex-1 min-w-0 space-y-4">
                {activeBudgets.map(b => {
                  const spent     = spentInBudgetCurrency(b, fxRates);
                  const pct       = b.amount > 0 ? Math.min(100, Math.round((spent / b.amount) * 100)) : 0;
                  const barColor  = pct >= 100 ? "#ef4444" : pct >= 85 ? "#f59e0b" : (b.color ?? "#6366f1");
                  const remaining = b.amount - spent;
                  return (
                    <div key={b.id}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: b.color ?? "#6366f1" }} />
                          <span className="text-xs font-semibold text-gray-800 truncate">{b.name}</span>
                          {b.category && (
                            <span className="text-[10px] text-gray-400 hidden sm:inline">· {b.category}</span>
                          )}
                        </div>
                        <span className={`text-xs font-bold ml-2 shrink-0 ${pct >= 100 ? "text-red-500" : pct >= 85 ? "text-amber-500" : "text-gray-600"}`}>
                          {pct}%
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-gray-400">
                          Spent <span className="font-medium text-gray-600">{fmtAmount(spent, b.currency)}</span>
                        </span>
                        <span className={`text-[10px] font-medium ${remaining >= 0 ? "text-gray-400" : "text-red-500"}`}>
                          {remaining >= 0 ? `${fmtAmount(remaining, b.currency)} left` : `${fmtAmount(Math.abs(remaining), b.currency)} over`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          </div>
        );
      })()}

      {/* Cards grid — always full width, matches Project Intelligence card sizing */}
      {activeBudgetsList.length === 0 && archivedBudgets.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
          <p className="text-sm font-medium text-gray-500">No budgets yet</p>
          <p className="text-xs text-gray-400 mt-1">Create your first budget to start tracking expenses</p>
          <button onClick={() => setShowNewBudget(true)} className="mt-4 text-sm font-medium text-indigo-600 hover:text-indigo-800">
            Create budget →
          </button>
        </div>
      ) : activeBudgetsList.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center">
          <p className="text-sm font-medium text-gray-500">All budgets are archived</p>
          <button onClick={() => setShowNewBudget(true)} className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800">
            Create new budget →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeBudgetsList.map(budget => {
            const spent      = spentInBudgetCurrency(budget, fxRates);
            const remaining  = budget.amount - spent;
            const pct        = budget.amount > 0 ? Math.min(100, Math.round((spent / budget.amount) * 100)) : 0;
            const isSelected = selectedId === budget.id;
            const barColor   = pct >= 100 ? "#ef4444" : pct >= 85 ? "#f59e0b" : (budget.color ?? "#6366f1");

            return (
              <div
                key={budget.id}
                onClick={() => setSelectedId(isSelected ? null : budget.id)}
                className={`bg-white border rounded-xl p-4 flex flex-col gap-3 cursor-pointer transition-all hover:shadow-sm ${
                  isSelected ? "border-indigo-400 ring-1 ring-indigo-200" : "border-gray-200 hover:border-indigo-200"
                } ${!budget.active ? "opacity-60" : ""}`}
              >
                {/* Name row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: budget.color ?? "#6366f1" }} />
                    <p className="text-sm font-semibold text-gray-900 truncate">{budget.name}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {budget.category && (
                      <span className="text-[10px] font-medium px-2 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-full">
                        {budget.category}
                      </span>
                    )}
                    {!budget.active && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full">Inactive</span>
                    )}
                  </div>
                </div>

                {/* Date range */}
                {(budget.startDate || budget.endDate) && (
                  <p className="text-[10px] text-gray-400 -mt-1">
                    {budget.startDate ? budget.startDate.slice(0, 7) : ""}
                    {budget.startDate && budget.endDate ? " – " : ""}
                    {budget.endDate ? budget.endDate.slice(0, 7) : ""}
                  </p>
                )}

                {/* Allocated */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400">Allocated</span>
                  <span className="text-[11px] font-semibold text-gray-700">{fmtAmount(budget.amount, budget.currency)}</span>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                </div>

                {/* Spent / Remaining */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400">
                    Spent <span className="font-medium text-gray-600">{fmtAmount(spent, budget.currency)}</span>
                  </span>
                  <span className={`text-[10px] font-semibold ${remaining >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {remaining >= 0 ? "Remaining " : "Over "}{fmtAmount(Math.abs(remaining), budget.currency)}
                  </span>
                </div>

                {budget.expenses.length > 0 && (
                  <p className="text-[10px] text-gray-300">{budget.expenses.length} expense{budget.expenses.length !== 1 ? "s" : ""} linked</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Archived budgets section */}
      {archivedBudgets.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowArchived(v => !v)}
            className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors mb-3"
          >
            <svg
              width="12" height="12" viewBox="0 0 12 12" fill="none"
              className={`transition-transform duration-150 ${showArchived ? "rotate-90" : ""}`}
            >
              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-gray-400">
              <rect x="1" y="5" width="14" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none"/>
              <path d="M1 5l2-3h10l2 3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/>
              <path d="M6 9.5l2 2 2-2M8 7.5v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Archived ({archivedBudgets.length})
          </button>

          {showArchived && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {archivedBudgets.map(budget => {
                const spent     = spentInBudgetCurrency(budget, fxRates);
                const remaining = budget.amount - spent;
                const pct       = budget.amount > 0 ? Math.min(100, Math.round((spent / budget.amount) * 100)) : 0;
                return (
                  <div key={budget.id} className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-col gap-2 opacity-70">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0 opacity-60" style={{ backgroundColor: budget.color ?? "#6366f1" }} />
                        <p className="text-sm font-semibold text-gray-600 truncate">{budget.name}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-gray-200 text-gray-500 rounded-full">Archived</span>
                        <button
                          onClick={() => archiveBudget(budget.id, false)}
                          disabled={archiving === budget.id}
                          className="text-[10px] font-medium text-indigo-500 hover:text-indigo-700 hover:underline disabled:opacity-40 transition-colors"
                          title="Restore budget"
                        >
                          Restore
                        </button>
                      </div>
                    </div>

                    {(budget.startDate || budget.endDate) && (
                      <p className="text-[10px] text-gray-400">
                        {budget.startDate ? budget.startDate.slice(0, 7) : ""}
                        {budget.startDate && budget.endDate ? " – " : ""}
                        {budget.endDate ? budget.endDate.slice(0, 7) : ""}
                      </p>
                    )}

                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-400">Allocated</span>
                      <span className="text-[11px] font-semibold text-gray-500">{fmtAmount(budget.amount, budget.currency)}</span>
                    </div>

                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: budget.color ?? "#9ca3af" }} />
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-400">
                        Spent <span className="font-medium text-gray-500">{fmtAmount(spent, budget.currency)}</span>
                      </span>
                      <span className={`text-[10px] font-semibold ${remaining >= 0 ? "text-gray-400" : "text-red-400"}`}>
                        {remaining >= 0 ? `${fmtAmount(remaining, budget.currency)} left` : `${fmtAmount(Math.abs(remaining), budget.currency)} over`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Drawer backdrop */}
      {selectedBudget && (
        <div className="fixed inset-0 z-40 bg-black/20" onClick={() => { setSelectedId(null); setConfirmDeleteId(null); }} />
      )}

      {/* Right-side drawer */}
      {selectedBudget && (
        <div className="fixed inset-y-0 right-0 z-50 w-[460px] bg-white shadow-2xl border-l border-gray-200 flex flex-col">
          {/* Drawer header */}
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: selectedBudget.color ?? "#6366f1" }} />
              <p className="text-sm font-semibold text-gray-900 truncate">{selectedBudget.name}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Edit */}
              <button
                onClick={() => startEdit(selectedBudget)}
                className="p-2 text-gray-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors"
                title="Edit budget"
              >
                <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>

              {/* Archive / Unarchive */}
              <button
                onClick={() => archiveBudget(selectedBudget.id, !selectedBudget.isArchived)}
                disabled={archiving === selectedBudget.id}
                className="p-2 text-gray-400 hover:text-amber-600 rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-40"
                title={selectedBudget.isArchived ? "Unarchive budget" : "Archive budget"}
              >
                {selectedBudget.isArchived ? (
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                    <rect x="1" y="5" width="14" height="9" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                    <path d="M1 5l2-3h10l2 3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
                    <path d="M6 9l2-2 2 2M8 7v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                    <rect x="1" y="5" width="14" height="9" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                    <path d="M1 5l2-3h10l2 3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
                    <path d="M6 9.5l2 2 2-2M8 7v4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>

              {/* Delete — trash bin icon */}
              {confirmDeleteId === selectedBudget.id ? (
                <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                  <span className="text-[11px] text-red-600 font-medium">Delete budget?</span>
                  <button onClick={() => deleteBudget(selectedBudget.id)} className="text-[11px] font-bold text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded transition-colors">Yes</button>
                  <button onClick={() => setConfirmDeleteId(null)} className="text-[11px] text-gray-400 hover:text-gray-600">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(selectedBudget.id)}
                  className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                  title="Delete budget"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                    <path d="M2 4h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    <path d="M6 4V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M5 4l.8 9h4.4l.8-9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}

              {/* Close — distinct X button */}
              <button
                onClick={() => { setSelectedId(null); setConfirmDeleteId(null); }}
                className="flex items-center justify-center w-8 h-8 text-gray-500 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                title="Close"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 min-h-0 overflow-y-auto">

            {/* Summary */}
            {(() => {
              const spent = spentInBudgetCurrency(selectedBudget, fxRates);
              const remaining = selectedBudget.amount - spent;
              const pct = selectedBudget.amount > 0 ? Math.min(100, Math.round((spent / selectedBudget.amount) * 100)) : 0;
              const barColor = pct >= 100 ? "#ef4444" : pct >= 85 ? "#f59e0b" : (selectedBudget.color ?? "#6366f1");
              return (
                <div className="px-4 py-3 border-b border-gray-100">
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { label: "Allocated", value: fmtAmount(selectedBudget.amount, selectedBudget.currency), cls: "text-gray-800" },
                      { label: "Spent",     value: fmtAmount(spent, selectedBudget.currency),                  cls: "text-gray-800" },
                      { label: remaining >= 0 ? "Remaining" : "Over budget", value: fmtAmount(Math.abs(remaining), selectedBudget.currency), cls: remaining >= 0 ? "text-emerald-600" : "text-red-500" },
                    ].map(item => (
                      <div key={item.label} className="text-center">
                        <p className="text-[10px] text-gray-400">{item.label}</p>
                        <p className={`text-xs font-bold mt-0.5 ${item.cls}`}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                  </div>
                </div>
              );
            })()}

            {/* Actions */}
            <div className="px-4 py-2.5 border-b border-gray-100 flex gap-2">
              <button
                onClick={() => { setShowLinkPanel(!showLinkPanel); setShowAddExpense(false); setLinkSearch(""); }}
                className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                Link expense
              </button>
              <button
                onClick={() => { setShowAddExpense(!showAddExpense); setShowLinkPanel(false); setExpenseForm(emptyExpenseForm(selectedBudget.currency)); }}
                className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                New expense
              </button>
            </div>

            {/* Link expense panel */}
            {showLinkPanel && (
              <div className="border-b border-gray-100">
                <div className="px-4 pt-3 pb-2">
                  <input
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                    placeholder="Search unassigned expenses…"
                    value={linkSearch}
                    onChange={e => setLinkSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-52 overflow-y-auto">
                  {filteredUnassigned.length === 0 ? (
                    <p className="text-xs text-gray-400 px-4 pb-3">{linkSearch ? "No matches" : "No unassigned expenses"}</p>
                  ) : (
                    filteredUnassigned.map(exp => {
                      const isFixingUnassigned = fixingAmount?.id === exp.id;
                      return (
                        <div key={exp.id} className="px-4 py-2 hover:bg-gray-50">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-gray-700 truncate">{exp.name}</p>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {exp.asanaTaskGid && (
                                  <span className="text-[9px] font-semibold text-orange-600 bg-orange-50 px-1 py-0.5 rounded uppercase tracking-wide">Asana</span>
                                )}
                                <span className="text-[10px] text-gray-400">{exp.expenseType ?? "—"}</span>
                                {exp.amount != null ? (
                                  <span className="text-[10px] text-gray-500">{exp.currency} {Math.round(exp.amount).toLocaleString("en-US")}</span>
                                ) : (
                                  <button
                                    onClick={() => setFixingAmount({ id: exp.id, amount: "", currency: selectedBudget.currency })}
                                    className="text-[10px] font-medium text-amber-500 hover:text-amber-700 underline decoration-dotted"
                                  >
                                    Set amount
                                  </button>
                                )}
                              </div>
                            </div>
                            <button
                              disabled={linking === exp.id}
                              onClick={() => linkExpense(exp.id, selectedBudget.id)}
                              className="shrink-0 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 px-2 py-0.5 rounded hover:bg-indigo-50 disabled:opacity-50 transition-colors"
                            >
                              {linking === exp.id ? "…" : "Link"}
                            </button>
                          </div>
                          {isFixingUnassigned && (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <input
                                autoFocus
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="Amount"
                                className="w-24 text-xs border border-amber-400 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-amber-100"
                                value={fixingAmount!.amount}
                                onChange={e => setFixingAmount(f => f ? { ...f, amount: e.target.value } : f)}
                              />
                              <select
                                className="text-xs border border-amber-300 rounded px-2 py-1 bg-white outline-none"
                                value={fixingAmount!.currency}
                                onChange={e => setFixingAmount(f => f ? { ...f, currency: e.target.value } : f)}
                              >
                                {(activeCurrencies.length > 0 ? activeCurrencies : ["AED", "USD", "EGP"]).map(c => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                              <button
                                disabled={savingFix || !fixingAmount?.amount}
                                onClick={() => saveAmountFix(exp.id, exp.name)}
                                className="text-[11px] font-semibold text-white bg-amber-500 hover:bg-amber-600 px-2 py-1 rounded disabled:opacity-50 transition-colors"
                              >
                                {savingFix ? "…" : "Save"}
                              </button>
                              <button onClick={() => setFixingAmount(null)} className="text-[11px] text-gray-400 hover:text-gray-600 px-1">Cancel</button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Add new expense inline */}
            {showAddExpense && (
              <form onSubmit={addExpense} className="border-b border-gray-100 px-4 py-3 flex flex-col gap-2">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">New expense</p>
                <input
                  required
                  placeholder="Description"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                  value={expenseForm.name}
                  onChange={e => setExpenseForm(f => ({ ...f, name: e.target.value }))}
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Amount"
                    className="w-24 text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                    value={expenseForm.amount}
                    onChange={e => setExpenseForm(f => ({ ...f, amount: e.target.value }))}
                  />
                  <select
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 bg-white"
                    value={expenseForm.currency}
                    onChange={e => setExpenseForm(f => ({ ...f, currency: e.target.value }))}
                  >
                    {(activeCurrencies.length > 0 ? activeCurrencies : ["AED", "USD", "EGP"]).map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <select
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 bg-white"
                  value={expenseForm.expenseType}
                  onChange={e => setExpenseForm(f => ({ ...f, expenseType: e.target.value }))}
                >
                  <option value="">Expense type (optional)</option>
                  {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setShowAddExpense(false)} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">Cancel</button>
                  <button type="submit" disabled={savingExpense} className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1 rounded-lg disabled:opacity-50 transition-colors">
                    {savingExpense ? "Adding…" : "Add"}
                  </button>
                </div>
              </form>
            )}

            {/* Expense list */}
            <div className="divide-y divide-gray-50">
              {selectedBudget.expenses.length === 0 ? (
                <p className="text-xs text-gray-400 px-4 py-6 text-center">No expenses linked to this budget yet</p>
              ) : (
                selectedBudget.expenses.map(exp => {
                  const badge = statusBadge(exp);
                  const isFixing = fixingAmount?.id === exp.id;
                  return (
                    <div key={exp.id} className="px-4 py-2.5 hover:bg-gray-50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-gray-800 truncate">{exp.name}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {exp.expenseType && (
                              <span className="text-[10px] text-gray-400">{exp.expenseType}</span>
                            )}
                            {exp.amount != null ? (
                              <span className="text-[10px] font-medium text-gray-600">{exp.currency} {Math.round(exp.amount).toLocaleString("en-US")}</span>
                            ) : (
                              <button
                                onClick={() => setFixingAmount({ id: exp.id, amount: "", currency: selectedBudget.currency })}
                                className="text-[10px] font-medium text-amber-500 hover:text-amber-700 underline decoration-dotted"
                              >
                                No amount — set it
                              </button>
                            )}
                            <span className={`text-[10px] font-medium px-1.5 py-px border rounded-full ${badge.cls}`}>{badge.label}</span>
                          </div>
                        </div>
                        <button
                          disabled={unlinking === exp.id}
                          onClick={() => unlinkExpense(exp, selectedBudget.id)}
                        className="shrink-0 text-gray-300 hover:text-red-400 p-1 disabled:opacity-30 transition-colors"
                        title="Unlink"
                      >
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                      </button>
                      </div>
                      {/* Inline amount editor for expenses with no amount */}
                      {isFixing && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <input
                            autoFocus
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="Amount"
                            className="w-24 text-xs border border-amber-400 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-amber-100"
                            value={fixingAmount!.amount}
                            onChange={e => setFixingAmount(f => f ? { ...f, amount: e.target.value } : f)}
                          />
                          <select
                            className="text-xs border border-amber-300 rounded px-2 py-1 bg-white outline-none"
                            value={fixingAmount!.currency}
                            onChange={e => setFixingAmount(f => f ? { ...f, currency: e.target.value } : f)}
                          >
                            {(activeCurrencies.length > 0 ? activeCurrencies : ["AED", "USD", "EGP"]).map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                          <button
                            disabled={savingFix || !fixingAmount?.amount}
                            onClick={() => saveAmountFix(exp.id, exp.name)}
                            className="text-[11px] font-semibold text-white bg-amber-500 hover:bg-amber-600 px-2 py-1 rounded disabled:opacity-50 transition-colors"
                          >
                            {savingFix ? "…" : "Save"}
                          </button>
                          <button
                            onClick={() => setFixingAmount(null)}
                            className="text-[11px] text-gray-400 hover:text-gray-600 px-1"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Payroll salary entries */}
            {selectedBudget.payrollEntries.length > 0 && (
              <div className="border-t border-gray-100">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-4 pt-3 pb-1.5">Salary payments</p>
                <div className="divide-y divide-gray-50">
                  {selectedBudget.payrollEntries.map(entry => {
                    const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                    const periodLabel = entry.payrollRun.month && entry.payrollRun.year
                      ? `${MONTH_SHORT[entry.payrollRun.month - 1]} ${entry.payrollRun.year}`
                      : "—";
                    return (
                      <div key={entry.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-800 truncate">{entry.employeeName}</p>
                          <p className="text-[10px] text-gray-400">{periodLabel}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-medium text-gray-600">
                            {entry.currency} {Math.round(entry.salary).toLocaleString("en-US")}
                          </span>
                          <span className={`text-[10px] font-medium px-1.5 py-px border rounded-full ${entry.isPaid ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
                            {entry.isPaid ? "Paid" : "Pending"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>{/* end scrollable body */}
        </div>
        )}

      {/* New / Edit Budget modal */}
      {isBudgetFormOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">{editingBudget ? "Edit budget" : "New budget"}</h2>
              <button onClick={() => { setShowNewBudget(false); setEditingBudget(null); }} className="text-gray-400 hover:text-gray-700 p-1 rounded hover:bg-gray-100 transition-colors">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            </div>
            <form onSubmit={saveBudget} className="px-6 py-4 flex flex-col gap-4">
              {error && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Budget name *</label>
                <input
                  required
                  placeholder="e.g. Marketing Q3 2026"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                  value={budgetForm.name}
                  onChange={e => setBudgetForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Allocated amount *</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="50000"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                    value={budgetForm.amount}
                    onChange={e => setBudgetForm(f => ({ ...f, amount: e.target.value }))}
                  />
                </div>
                <div className="w-28">
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Currency</label>
                  <select
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 bg-white"
                    value={budgetForm.currency}
                    onChange={e => setBudgetForm(f => ({ ...f, currency: e.target.value }))}
                  >
                    {(activeCurrencies.length > 0 ? activeCurrencies : ["AED", "USD", "EGP"]).map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Category (expense type)</label>
                <select
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 bg-white"
                  value={budgetForm.category}
                  onChange={e => setBudgetForm(f => ({ ...f, category: e.target.value }))}
                >
                  <option value="">All types</option>
                  {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Start date</label>
                  <input
                    type="date"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                    value={budgetForm.startDate}
                    onChange={e => setBudgetForm(f => ({ ...f, startDate: e.target.value }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">End date</label>
                  <input
                    type="date"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                    value={budgetForm.endDate}
                    onChange={e => setBudgetForm(f => ({ ...f, endDate: e.target.value }))}
                  />
                </div>
              </div>

              {/* Color picker */}
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-2">Color</label>
                <div className="flex gap-2 flex-wrap mb-2.5">
                  {BUDGET_COLORS.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setBudgetForm(f => ({ ...f, color: c.value }))}
                      className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${budgetForm.color === c.value ? "ring-2 ring-offset-1 ring-gray-400 scale-110" : ""}`}
                      style={{ backgroundColor: c.value }}
                      title={c.label}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full shrink-0 border border-gray-200" style={{ backgroundColor: budgetForm.color ?? "#6366f1" }} />
                  <input
                    type="color"
                    value={budgetForm.color ?? "#6366f1"}
                    onChange={e => setBudgetForm(f => ({ ...f, color: e.target.value }))}
                    className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent p-0"
                    title="Custom color"
                  />
                  <input
                    type="text"
                    value={budgetForm.color ?? ""}
                    onChange={e => {
                      const v = e.target.value;
                      if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setBudgetForm(f => ({ ...f, color: v }));
                    }}
                    placeholder="#6366f1"
                    maxLength={7}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 w-24 outline-none focus:ring-2 focus:ring-indigo-200 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Notes</label>
                <textarea
                  rows={2}
                  placeholder="Optional notes…"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 resize-none"
                  value={budgetForm.notes}
                  onChange={e => setBudgetForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowNewBudget(false); setEditingBudget(null); }}
                  className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-5 py-2 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {saving ? "Saving…" : editingBudget ? "Save changes" : "Create budget"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
