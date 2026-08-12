"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import ProjectionChart, { ChartSeries, EventMarker } from "./ProjectionChart";

export type MonthlySnapshot = {
  payrollUSD: number;
  leasesUSD: number;
  revenueUSD: number;
  otherExpensesUSD: number;
  capitalUSD: number;
};

export type PersonData = {
  id: string;
  name: string;
  salaryUSD: number;
};

export type BaselineData = {
  months: MonthlySnapshot[];   // 24 entries, index 0 = current month
  totals: { payrollUSD: number; leasesUSD: number; revenueUSD: number; otherExpensesUSD: number; capitalUSD: number; netUSD: number };
  currentCashUSD: number;      // actual company cash balance today (paid income − paid expenses)
  projectedOpeningBalance: number; // projected position entering month 0 (all pre-period scheduled items)
  people: PersonData[];        // active employees available for raise events
};

export type EventType =
  | "hire"
  | "termination"
  | "raise_pct"
  | "person_raise"
  | "lease_change"
  | "new_revenue"
  | "one_time_cost"
  | "one_time_expense"
  | "scheduled_revenue";

export type ScenarioEvent = {
  id: string;
  type: EventType;
  label: string;
  startMonth: number;
  endMonth: number;
  amountUSD?: number;
  pct?: number;
  scheduledPayments?: { month: number; amountUSD: number }[];
  personId?: string;
  currentSalaryUSD?: number;
  effectiveDate?: string;
};

export type Scenario = {
  id: string;
  name: string;
  color: string;
  events: ScenarioEvent[];
};

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#EF4444"];
const BASELINE_COLOR = "#9CA3AF";
const STORAGE_KEY = "opsmind_scenarios_v2";

const EVENT_META: Record<EventType, { label: string; amountLabel?: string; pctLabel?: string }> = {
  hire:               { label: "Hire",                 amountLabel: "Monthly salary (USD)" },
  termination:        { label: "Termination",          amountLabel: "Monthly salary removed (USD)" },
  raise_pct:          { label: "Payroll raise %",      pctLabel: "Raise percentage (%)" },
  person_raise:       { label: "Salary raise" },
  lease_change:       { label: "Lease change",         amountLabel: "Monthly delta (USD, negative = reduction)" },
  new_revenue:        { label: "New revenue",          amountLabel: "Monthly revenue (USD)" },
  one_time_cost:      { label: "Recurring cost",       amountLabel: "Monthly cost (USD)" },
  one_time_expense:   { label: "One-time Expense",    amountLabel: "Amount (USD)" },
  scheduled_revenue:  { label: "Revenue Contract" },
};

function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

type MonthBreakdown = { payroll: number; leases: number; revenue: number; costs: number; capital: number; net: number };

function projectMonth(baseline: BaselineData, events: ScenarioEvent[], m: number): MonthBreakdown {
  // Start from the real scheduled data for this specific month
  const snap = baseline.months[m];
  let payroll = snap.payrollUSD;
  let leases  = snap.leasesUSD;
  let revenue = snap.revenueUSD;
  let costs   = snap.otherExpensesUSD;
  for (const ev of events) {
    if (m < ev.startMonth || m > ev.endMonth) continue;
    switch (ev.type) {
      case "hire":          payroll += ev.amountUSD ?? 0; break;
      case "termination":   payroll = Math.max(0, payroll - (ev.amountUSD ?? 0)); break;
      case "raise_pct":     payroll *= 1 + (ev.pct ?? 0) / 100; break;
      case "person_raise":  payroll += (ev.amountUSD ?? 0) - (ev.currentSalaryUSD ?? 0); break;
      case "lease_change":  leases += ev.amountUSD ?? 0; break;
      case "new_revenue":   revenue += ev.amountUSD ?? 0; break;
      case "one_time_cost":    costs += ev.amountUSD ?? 0; break;
      case "one_time_expense": if (m === ev.startMonth) costs += ev.amountUSD ?? 0; break;
      case "scheduled_revenue":
        if (ev.scheduledPayments) {
          for (const p of ev.scheduledPayments) {
            if (p.month === m) revenue += p.amountUSD;
          }
        }
        break;
    }
  }
  const capital = snap.capitalUSD;
  return { payroll, leases, revenue, costs, capital, net: revenue + capital - payroll - leases - costs };
}

function projectScenario(baseline: BaselineData, events: ScenarioEvent[], nMonths: number): number[] {
  return Array.from({ length: nMonths }, (_, m) => projectMonth(baseline, events, m).net);
}

function projectTotals(baseline: BaselineData, events: ScenarioEvent[], nMonths: number): MonthBreakdown {
  return Array.from({ length: nMonths }, (_, m) => projectMonth(baseline, events, m)).reduce(
    (acc, mb) => ({
      payroll: acc.payroll + mb.payroll,
      leases:  acc.leases  + mb.leases,
      revenue: acc.revenue + mb.revenue,
      costs:   acc.costs   + mb.costs,
      capital: acc.capital + mb.capital,
      net:     acc.net     + mb.net,
    }),
    { payroll: 0, leases: 0, revenue: 0, costs: 0, capital: 0, net: 0 }
  );
}

function toCumulative(values: number[], start = 0): number[] {
  let acc = start;
  return values.map((v) => (acc += v));
}

function fmtUSD(v: number) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

type NewEventForm = {
  type: EventType;
  label: string;
  startMonth: number;
  endMonth: number;
  amountUSD: string;
  pct: string;
  scheduledPayments: { month: number; amountUSD: string }[];
  personId: string;
  newSalaryUSD: string;
  effectiveDate: string;
};

function dateToMonthIndex(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  const months = (date.getFullYear() - now.getFullYear()) * 12 + (date.getMonth() - now.getMonth());
  return Math.max(0, Math.min(23, months));
}

function emptyForm(lastMonth = 23): NewEventForm {
  return { type: "hire", label: "", startMonth: 0, endMonth: lastMonth, amountUSD: "", pct: "", scheduledPayments: [{ month: 0, amountUSD: "" }], personId: "", newSalaryUSD: "", effectiveDate: "" };
}

export default function SimulatorClient({ baseline }: { baseline: BaselineData }) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingEvent, setAddingEvent] = useState(false);
  const [form, setForm] = useState<NewEventForm>(emptyForm());
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [timeline, setTimeline] = useState<6 | 12 | 18 | 24>(24);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteEventId, setConfirmDeleteEventId] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);

  const chartRef         = useRef<HTMLDivElement>(null);
  const scenariosGridRef = useRef<HTMLDivElement>(null);
  const eventFormRef     = useRef<HTMLDivElement>(null);
  const importInputRef   = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setScenarios(JSON.parse(raw));
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
  }, [scenarios, hydrated]);

  const monthLabels = useMemo(() => {
    const now = new Date();
    return Array.from({ length: timeline }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
    });
  }, [timeline]);

  // Raw monthly projections
  const rawSeries = useMemo(() => {
    const list: { id: string; label: string; color: string; dashed?: boolean; values: number[] }[] = [
      { id: "baseline", label: "Baseline", color: BASELINE_COLOR, dashed: true, values: projectScenario(baseline, [], timeline) },
    ];
    for (const sc of scenarios) {
      list.push({ id: sc.id, label: sc.name, color: sc.color, values: projectScenario(baseline, sc.events, timeline) });
    }
    return list;
  }, [baseline, scenarios, timeline]);

  // Cumulative chart — starts from projectedOpeningBalance
  // (all pre-period scheduled income minus all pre-period scheduled expenses).
  const chartSeries = useMemo((): ChartSeries[] =>
    rawSeries.map((s) => ({
      ...s,
      values: toCumulative(s.values, baseline.projectedOpeningBalance),
    })),
    [rawSeries, baseline.projectedOpeningBalance]
  );

  const selectedScenario = scenarios.find((s) => s.id === selectedId) ?? null;

  const chartMarkers = useMemo((): EventMarker[] => {
    if (!selectedScenario) return [];
    return selectedScenario.events
      .filter((ev) => ev.startMonth < timeline)
      .map((ev) => ({
      id: ev.id,
      startMonth: ev.startMonth,
      endMonth: Math.min(ev.endMonth, timeline - 1),
      label: ev.label || EVENT_META[ev.type].label,
      color: selectedScenario.color,
      typeLabel: EVENT_META[ev.type].label,
      amountLabel:
        ev.scheduledPayments
          ? `${ev.scheduledPayments.length} payment${ev.scheduledPayments.length !== 1 ? "s" : ""} · ${fmtUSD(ev.scheduledPayments.reduce((s, p) => s + p.amountUSD, 0))} total`
          : ev.type === "person_raise"
          ? `${fmtUSD(ev.amountUSD ?? 0)}/mo (+${fmtUSD((ev.amountUSD ?? 0) - (ev.currentSalaryUSD ?? 0))} raise)`
          : ev.type === "one_time_expense"
          ? `${fmtUSD(Math.abs(ev.amountUSD ?? 0))} one-time`
          : ev.amountUSD !== undefined
          ? `${fmtUSD(Math.abs(ev.amountUSD))}/mo`
          : ev.pct !== undefined
          ? `${ev.pct}% raise`
          : "",
      scheduledPayments: ev.scheduledPayments,
    }));
  }, [selectedScenario, timeline]);

  function addScenario() {
    const sc: Scenario = {
      id: uid(),
      name: `Scenario ${scenarios.length + 1}`,
      color: COLORS[scenarios.length % COLORS.length],
      events: [],
    };
    setScenarios((prev) => [...prev, sc]);
    setSelectedId(sc.id);
    setAddingEvent(false);
    setTimeout(() => chartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function deleteScenario(id: string) {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function duplicateScenario(id: string) {
    const src = scenarios.find((s) => s.id === id);
    if (!src) return;
    const copy: Scenario = {
      id: uid(),
      name: `${src.name} (copy)`,
      color: COLORS[(scenarios.length) % COLORS.length],
      events: src.events.map((e) => ({ ...e, id: uid() })),
    };
    setScenarios((prev) => [...prev, copy]);
    setSelectedId(copy.id);
  }

  function renameScenario(id: string, name: string) {
    setScenarios((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  }

  function exportScenarios() {
    const blob = new Blob([JSON.stringify(scenarios, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `opsmind-scenarios-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importScenarios(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as Scenario[];
        if (!Array.isArray(parsed)) { alert("Invalid file — expected a JSON array of scenarios."); return; }
        const merged = [...scenarios];
        for (const s of parsed) {
          if (!merged.find((x) => x.id === s.id)) {
            merged.push({ ...s, id: uid() });
          }
        }
        setScenarios(merged);
      } catch {
        alert("Could not read file. Make sure it's a valid OpsMind scenarios export.");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  }

  function startAddEvent() {
    setForm(emptyForm(timeline - 1));
    setEditingEventId(null);
    setAddingEvent(true);
    setTimeout(() => eventFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80);
  }

  function startEditEvent(ev: ScenarioEvent) {
    setForm({
      type: ev.type,
      label: ev.label,
      startMonth: ev.startMonth,
      endMonth: ev.endMonth,
      amountUSD: ev.amountUSD !== undefined ? String(ev.amountUSD) : "",
      pct: ev.pct !== undefined ? String(ev.pct) : "",
      scheduledPayments: ev.scheduledPayments
        ? ev.scheduledPayments.map(p => ({ month: p.month, amountUSD: String(p.amountUSD) }))
        : [{ month: 0, amountUSD: "" }],
      personId: ev.personId ?? "",
      newSalaryUSD: ev.type === "person_raise" && ev.amountUSD !== undefined ? String(ev.amountUSD) : "",
      effectiveDate: ev.effectiveDate ?? "",
    });
    setEditingEventId(ev.id);
    setAddingEvent(true);
    setTimeout(() => eventFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80);
  }

  function saveEvent() {
    if (!selectedId) return;
    const meta = EVENT_META[form.type];

    let startMonth = form.startMonth;
    let endMonth   = Math.max(form.startMonth, form.endMonth);
    let scheduledPayments: { month: number; amountUSD: number }[] | undefined;

    if (form.type === "termination") {
      startMonth = form.effectiveDate ? dateToMonthIndex(form.effectiveDate) : form.startMonth;
      endMonth   = 23;
    }

    if (form.type === "one_time_expense") {
      endMonth = startMonth;
    }

    if (form.type === "scheduled_revenue") {
      const payments = form.scheduledPayments
        .map(p => ({ month: p.month, amountUSD: parseFloat(p.amountUSD) || 0 }))
        .filter(p => p.amountUSD > 0)
        .sort((a, b) => a.month - b.month);
      scheduledPayments = payments;
      startMonth = payments.length > 0 ? Math.min(...payments.map(p => p.month)) : 0;
      endMonth   = payments.length > 0 ? Math.max(...payments.map(p => p.month)) : 0;
    }

    let personId: string | undefined;
    let currentSalaryUSD: number | undefined;
    if (form.type === "person_raise" || form.type === "termination") {
      const person = baseline.people.find((p) => p.id === form.personId);
      personId = person?.id;
      currentSalaryUSD = person?.salaryUSD ?? 0;
    }

    const newEv: ScenarioEvent = {
      id: editingEventId ?? uid(),
      type: form.type,
      label: form.label || (form.type === "person_raise"
        ? `${baseline.people.find(p => p.id === form.personId)?.name ?? "Person"} raise`
        : form.type === "termination" && personId
          ? `Terminate ${baseline.people.find(p => p.id === form.personId)?.name ?? "employee"}`
          : meta.label),
      startMonth,
      endMonth,
      ...(meta.amountLabel !== undefined && form.type !== "scheduled_revenue" && { amountUSD: parseFloat(form.amountUSD) || 0 }),
      ...(meta.pctLabel    !== undefined && { pct: parseFloat(form.pct) || 0 }),
      ...(scheduledPayments !== undefined && { scheduledPayments }),
      ...(form.type === "person_raise" && {
        amountUSD: parseFloat(form.newSalaryUSD) || 0,
        personId,
        currentSalaryUSD,
      }),
      ...(form.type === "termination" && personId && { personId }),
      ...(form.type === "termination" && form.effectiveDate && { effectiveDate: form.effectiveDate }),
    };
    setScenarios((prev) =>
      prev.map((s) => {
        if (s.id !== selectedId) return s;
        return {
          ...s,
          events: editingEventId
            ? s.events.map((e) => (e.id === editingEventId ? newEv : e))
            : [...s.events, newEv],
        };
      })
    );
    setAddingEvent(false);
    setEditingEventId(null);
  }

  function deleteEvent(scenarioId: string, eventId: string) {
    setScenarios((prev) =>
      prev.map((s) =>
        s.id === scenarioId ? { ...s, events: s.events.filter((e) => e.id !== eventId) } : s
      )
    );
  }

  const baselineVals = rawSeries[0].values;
  const baselineCashVals = toCumulative(baselineVals, baseline.projectedOpeningBalance);
  const baselineFinalCash = baselineCashVals[timeline - 1];
  const baselineWorstCash = Math.min(...baselineCashVals);
  const baselineCashDipMonths = baselineCashVals.filter(v => v < 0).length;
  const baselineTotals = projectTotals(baseline, [], timeline);

  const meta = EVENT_META[form.type];

  function scenarioHealth(sc: Scenario) {
    const vals = projectScenario(baseline, sc.events, timeline);
    const cashVals = toCumulative(vals, baseline.projectedOpeningBalance);
    const totals24 = projectTotals(baseline, sc.events, timeline);
    const netDelta = totals24.net - baselineTotals.net;
    const endingCash = cashVals[timeline - 1];
    const endingCashDelta = endingCash - baselineFinalCash;
    const negativeMonths = vals.filter((v) => v < 0).length;
    const cashDipMonths = cashVals.filter((v) => v < 0).length;
    const worstCash = Math.min(...cashVals);
    return { vals, cashVals, totals24, netDelta, endingCash, endingCashDelta, negativeMonths, cashDipMonths, worstCash };
  }

  if (!hydrated) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Scenario Simulator</h1>
          <p className="text-sm text-gray-500 mt-1">
            Model business decisions and see how they affect company cash position over {timeline} months.
          </p>
          <div className="flex items-start gap-1.5 mt-2">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="shrink-0 mt-0.5 text-amber-500">
              <path d="M7 1.5L1.5 12h11L7 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M7 5.5v3M7 10h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            <p className="text-xs text-amber-700">
              Assumes all current unpaid expenses and liabilities have been settled — projections start from a clean slate.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Timeline selector */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {([6, 12, 18, 24] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTimeline(t)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  timeline === t ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t}m
              </button>
            ))}
          </div>
          {/* Hidden file input for import */}
          <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={importScenarios} />
          {scenarios.length > 0 && (
            <button
              onClick={exportScenarios}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors shrink-0"
              title="Export scenarios to JSON file"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M2 10v2h10v-2M7 2v7M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Export
            </button>
          )}
          <button
            onClick={() => importInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors shrink-0"
            title="Import scenarios from JSON file"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <path d="M2 10v2h10v-2M7 9V2M4 5l3-3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Import
          </button>
          <button
            onClick={addScenario}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            New scenario
          </button>
        </div>
      </div>

      {/* Current cash balance banner */}
      <div className={`rounded-xl border px-5 py-4 flex items-center justify-between gap-4 ${
        baseline.currentCashUSD >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
      }`}>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-0.5">Current Cash Balance</p>
          <p className={`text-2xl font-bold tabular-nums ${baseline.currentCashUSD >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {fmtUSD(baseline.currentCashUSD)}
          </p>
          <p className="text-xs text-gray-500 mt-1">Based on all collected invoices minus all paid expenses</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Without any changes</p>
          <p className={`text-lg font-bold tabular-nums ${baselineFinalCash >= 0 ? "text-gray-700" : "text-red-600"}`}>
            {fmtUSD(baselineFinalCash)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Projected cash in {timeline} months</p>
        </div>
      </div>

      {/* KPI cards — baseline or selected scenario */}
      {(() => {
        const scenTotals = selectedScenario ? projectTotals(baseline, selectedScenario.events, timeline) : null;
        const displayTotals = scenTotals ?? baselineTotals;
        const cards = [
          { key: "payroll", label: `Payroll (${timeline}m)`,   value: displayTotals.payroll, baseval: baselineTotals.payroll,  hint: `Sum of salaries over the next ${timeline} months`, isNet: false, invertDelta: true  },
          { key: "leases",  label: `Leases (${timeline}m)`,    value: displayTotals.leases,  baseval: baselineTotals.leases,   hint: `Sum of lease payments in next ${timeline} months`, isNet: false, invertDelta: true  },
          { key: "revenue", label: `Revenue (${timeline}m)`,   value: displayTotals.revenue, baseval: baselineTotals.revenue,  hint: `Sum of invoice amounts in next ${timeline} months`, isNet: false, invertDelta: false },
          { key: "net",     label: `Net total (${timeline}m)`, value: displayTotals.net,     baseval: baselineTotals.net,      hint: `Revenue minus payroll, leases, and expenses over ${timeline} months`, isNet: true, invertDelta: false },
        ];
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {cards.map(({ key, label, value, baseval, hint, isNet, invertDelta }) => {
              const delta = scenTotals ? value - baseval : null;
              const deltaGood = delta !== null ? (invertDelta ? delta < 0 : delta > 0) : false;
              return (
                <div key={key} className="bg-white rounded-xl border border-gray-200 px-4 py-3 group relative">
                  <p className="text-xs text-gray-500 mb-1">{label}</p>
                  <p className={`text-lg font-bold ${
                    isNet
                      ? displayTotals.net >= 0 ? "text-emerald-600" : "text-red-600"
                      : "text-gray-800"
                  }`}>
                    {value === 0 && !isNet
                      ? <span className="text-gray-400 text-sm font-normal">No data</span>
                      : fmtUSD(value)
                    }
                  </p>
                  {delta !== null && delta !== 0 ? (
                    <p className={`text-[10px] font-semibold mt-0.5 ${deltaGood ? "text-emerald-600" : "text-red-500"}`}>
                      {delta > 0 ? "+" : ""}{fmtUSD(delta)} vs baseline
                    </p>
                  ) : (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {scenTotals ? "no change vs baseline" : "from actual schedules"}
                    </p>
                  )}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    {hint}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Chart — always full width */}
      <div ref={chartRef} className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6">
        <div className="mb-2">
          <h2 className="text-sm font-semibold text-gray-700">Cash position — {timeline}-month projection</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Starting from projected position ({fmtUSD(baseline.projectedOpeningBalance)}) — all pre-period income and liabilities treated as settled
          </p>
        </div>

        {selectedScenario && (
          <p className="text-xs text-gray-400 mb-3">
            Event markers shown for{" "}
            <span className="font-medium" style={{ color: selectedScenario.color }}>{selectedScenario.name}</span>.
            Click a scenario chip to switch.
          </p>
        )}

        <ProjectionChart
          series={chartSeries}
          monthLabels={monthLabels}
          markers={chartMarkers}
          mode="cumulative"
        />

        {scenarios.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-gray-100 items-center">
            <span className="text-xs text-gray-400">Select scenario to show events:</span>
            {scenarios.map((sc) => (
              <button
                key={sc.id}
                onClick={() => setSelectedId(sc.id === selectedId ? null : sc.id)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors"
                style={
                  selectedId === sc.id
                    ? { color: sc.color, backgroundColor: sc.color + "18", borderColor: sc.color + "60" }
                    : { color: "#6B7280", backgroundColor: "#F3F4F6", borderColor: "transparent" }
                }
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: sc.color }} />
                {sc.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Scenario comparison table */}
      {scenarios.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Scenario comparison — {timeline}-month cumulative</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Projected position today: <span className={`font-medium ${baseline.projectedOpeningBalance >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtUSD(baseline.projectedOpeningBalance)}</span>
              {" · "}Without any changes, projected in {timeline} months: <span className={`font-semibold ${baselineFinalCash >= 0 ? "text-gray-700" : "text-red-600"}`}>{fmtUSD(baselineFinalCash)}</span>
            </p>
            <div className="mt-2 flex items-start gap-1.5 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 mt-0.5">
                <circle cx="6.5" cy="6.5" r="6" stroke="#3B82F6" strokeWidth="1.2" />
                <path d="M6.5 4v3M6.5 9v.5" stroke="#3B82F6" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              <p className="text-xs text-blue-800">
                <span className="font-semibold">Based on real scheduled data.</span> Payroll reflects each employee&apos;s actual salary and drops when their contract or exit date passes. Leases follow your payment schedule rows. Revenue comes from your invoices by their due date. Scenarios layer additional events on top of this real baseline.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-44">Scenario</th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Revenue</th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Payroll</th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Leases</th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Net Total</th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Cash in {timeline}m</th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Lowest Cash</th>
                  <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Risk</th>
                </tr>
              </thead>
              <tbody>
                {/* Baseline row */}
                <tr className="border-b border-gray-50 bg-gray-50/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-gray-400" />
                      <span className="font-medium text-gray-500">Baseline</span>
                      <span className="text-[10px] text-gray-400 italic">no change</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-500">{fmtUSD(baselineTotals.revenue)}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-500">{fmtUSD(baselineTotals.payroll)}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-500">{fmtUSD(baselineTotals.leases)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-semibold ${baselineTotals.net >= 0 ? "text-gray-700" : "text-red-600"}`}>
                      {fmtUSD(baselineTotals.net)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-semibold ${baselineFinalCash >= 0 ? "text-gray-700" : "text-red-600"}`}>
                      {fmtUSD(baselineFinalCash)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-semibold ${baselineWorstCash >= 0 ? "text-gray-700" : "text-red-600"}`}>
                      {fmtUSD(baselineWorstCash)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {baselineCashDipMonths === 0 ? (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold text-[10px]">Safe</span>
                    ) : (
                      <span className={`inline-block px-2 py-0.5 rounded-full font-semibold text-[10px] ${baselineCashDipMonths < 4 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>
                        {baselineCashDipMonths}mo gap
                      </span>
                    )}
                  </td>
                </tr>

                {/* Scenario rows */}
                {scenarios.map((sc, idx) => {
                  const h = scenarioHealth(sc);
                  const revDelta   = h.totals24.revenue  - baselineTotals.revenue;
                  const payDelta   = h.totals24.payroll  - baselineTotals.payroll;
                  const leaseDelta = h.totals24.leases   - baselineTotals.leases;
                  const netDelta   = h.totals24.net      - baselineTotals.net;
                  const cashDelta  = h.endingCash        - baselineFinalCash;
                  const worstDelta = h.worstCash         - baselineWorstCash;
                  const isLast     = idx === scenarios.length - 1;

                  function DeltaBadge({ delta, invert = false }: { delta: number; invert?: boolean }) {
                    if (Math.round(delta) === 0) return null;
                    const positive = invert ? delta < 0 : delta > 0;
                    return (
                      <span className={`block text-[10px] font-semibold mt-0.5 ${positive ? "text-emerald-600" : "text-red-500"}`}>
                        {delta > 0 ? "+" : ""}{fmtUSD(delta)}
                      </span>
                    );
                  }

                  return (
                    <tr key={sc.id} className={`${!isLast ? "border-b border-gray-50" : ""} hover:bg-gray-50/40 transition-colors`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: sc.color }} />
                          <span className="font-medium text-gray-700 truncate max-w-[110px]">{sc.name}</span>
                        </div>
                        {h.endingCash >= 0 && h.cashDipMonths === 0 ? (
                          <span className="text-[10px] text-emerald-600 font-semibold">▲ Solvent</span>
                        ) : h.endingCashDelta > 0 ? (
                          <span className="text-[10px] text-amber-600 font-semibold">~ Improved</span>
                        ) : (
                          <span className="text-[10px] text-red-500 font-semibold">▼ Negative</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-medium text-gray-700">{fmtUSD(h.totals24.revenue)}</span>
                        <DeltaBadge delta={revDelta} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-medium text-gray-700">{fmtUSD(h.totals24.payroll)}</span>
                        <DeltaBadge delta={payDelta} invert />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-medium text-gray-700">{fmtUSD(h.totals24.leases)}</span>
                        <DeltaBadge delta={leaseDelta} invert />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-semibold ${h.totals24.net >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                          {fmtUSD(h.totals24.net)}
                        </span>
                        <DeltaBadge delta={netDelta} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-semibold ${h.endingCash >= 0 ? "text-gray-700" : "text-red-600"}`}>
                          {fmtUSD(h.endingCash)}
                        </span>
                        <DeltaBadge delta={cashDelta} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-semibold ${h.worstCash >= 0 ? "text-gray-700" : "text-red-600"}`}>
                          {fmtUSD(h.worstCash)}
                        </span>
                        <DeltaBadge delta={worstDelta} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {h.cashDipMonths === 0 ? (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold text-[10px]">Safe</span>
                        ) : (
                          <span className={`inline-block px-2 py-0.5 rounded-full font-semibold text-[10px] ${h.cashDipMonths < 4 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>
                            {h.cashDipMonths}mo gap
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Scenarios list + event editor */}
      <div ref={scenariosGridRef} className={`grid gap-4 ${selectedScenario ? "lg:grid-cols-2" : "lg:grid-cols-1"}`}>
        {/* Scenarios list */}
        <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
          <div className="px-4 py-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Scenarios</h2>
            <span className="text-xs text-gray-400">{scenarios.length} total</span>
          </div>

          {scenarios.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-gray-400">No scenarios yet.</p>
              <button onClick={addScenario} className="mt-2 text-sm text-blue-600 hover:underline">
                Create your first scenario →
              </button>
            </div>
          )}

          {scenarios.map((sc) => {
            const h = scenarioHealth(sc);
            const isSelected = sc.id === selectedId;
            return (
              <div
                key={sc.id}
                className={`px-4 py-3 cursor-pointer transition-colors ${isSelected ? "bg-gray-50" : "hover:bg-gray-50"}`}
                onClick={() => setSelectedId(isSelected ? null : sc.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  {confirmDeleteId === sc.id ? (
                    <>
                      <span className="text-xs text-gray-600 truncate min-w-0">
                        Delete <span className="font-semibold">{sc.name}</span>?
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteScenario(sc.id); setConfirmDeleteId(null); }}
                          className="text-[11px] font-semibold text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded-md transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                          className="text-[11px] font-medium text-gray-500 hover:text-gray-700 px-2 py-0.5 rounded-md transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: sc.color }} />
                        {editingNameId === sc.id ? (
                          <input
                            autoFocus
                            className="text-sm font-medium text-gray-800 bg-white border border-indigo-400 rounded px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-indigo-100 w-full min-w-0"
                            value={sc.name}
                            onChange={(e) => { e.stopPropagation(); renameScenario(sc.id, e.target.value); }}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={() => setEditingNameId(null)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditingNameId(null); } }}
                          />
                        ) : (
                          <div
                            className="group/name flex items-center gap-1 min-w-0 cursor-text"
                            onClick={(e) => { e.stopPropagation(); setEditingNameId(sc.id); }}
                            title="Click to rename"
                          >
                            <span className="text-sm font-medium text-gray-800 truncate">{sc.name}</span>
                            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="shrink-0 text-gray-300 group-hover/name:text-indigo-400 transition-colors">
                              <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); duplicateScenario(sc.id); }}
                          className="text-gray-400 hover:text-indigo-500 transition-colors p-1"
                          title="Duplicate scenario"
                        >
                          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                            <rect x="1" y="4" width="8" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.3"/>
                            <path d="M4 4V2.2A1.2 1.2 0 0 1 5.2 1H11.8A1.2 1.2 0 0 1 13 2.2V8.8A1.2 1.2 0 0 1 11.8 10H10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                          </svg>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(sc.id); }}
                          className="text-gray-400 hover:text-red-500 transition-colors p-1"
                          title="Delete scenario"
                        >
                          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                            <path d="M2 2l9 9M11 2l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Per-scenario summary row */}
                <div className="mt-2 pl-[22px] flex items-center gap-4 flex-wrap">
                  <span className="text-xs text-gray-400">
                    {sc.events.length} event{sc.events.length !== 1 ? "s" : ""}
                  </span>
                  <span className={`text-xs font-semibold ${h.endingCashDelta >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    Cash in 24m: {fmtUSD(h.endingCash)} ({h.endingCashDelta >= 0 ? "+" : ""}{fmtUSD(h.endingCashDelta)})
                  </span>
                  {h.cashDipMonths > 0 && (
                    <span className="text-xs text-amber-500">⚠ {h.cashDipMonths} months cash below zero</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Event editor */}
        {selectedScenario && (
          <div className="bg-white rounded-2xl border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedScenario.color }} />
                <h2 className="text-sm font-semibold text-gray-700">{selectedScenario.name}</h2>
              </div>
              {!addingEvent && (
                <button
                  onClick={startAddEvent}
                  className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  Add event
                </button>
              )}
            </div>

            {selectedScenario.events.length === 0 && !addingEvent && (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-gray-400">No events yet.</p>
                <button onClick={startAddEvent} className="mt-1 text-sm text-blue-600 hover:underline">
                  Add first event →
                </button>
              </div>
            )}

            {selectedScenario.events.length > 0 && (
              <div className="divide-y divide-gray-100">
                {selectedScenario.events.map((ev) => (
                  <div key={ev.id} className="px-4 py-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{ev.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {EVENT_META[ev.type].label}
                        {" · "}
                        <span className="font-medium text-gray-600">{monthLabels[ev.startMonth]}</span>
                        {" → "}
                        <span className="font-medium text-gray-600">{monthLabels[ev.endMonth]}</span>
                        {" · "}
                        {ev.scheduledPayments !== undefined
                          ? `${ev.scheduledPayments.length} payment${ev.scheduledPayments.length !== 1 ? "s" : ""} · ${fmtUSD(ev.scheduledPayments.reduce((s, p) => s + p.amountUSD, 0))} total`
                          : ev.amountUSD !== undefined
                          ? fmtUSD(ev.amountUSD) + "/mo"
                          : ev.pct !== undefined
                          ? `${ev.pct}%`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {confirmDeleteEventId === ev.id ? (
                        <>
                          <span className="text-[11px] text-gray-600">Delete?</span>
                          <button
                            onClick={() => { deleteEvent(selectedScenario.id, ev.id); setConfirmDeleteEventId(null); }}
                            className="text-[11px] font-semibold text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded-md transition-colors"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setConfirmDeleteEventId(null)}
                            className="text-[11px] font-medium text-gray-500 hover:text-gray-700 px-2 py-0.5 rounded-md transition-colors"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEditEvent(ev)} className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors" title="Edit">
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                              <path d="M9 2l2 2-7 7H2v-2l7-7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <button onClick={() => setConfirmDeleteEventId(ev.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                              <path d="M2 2l9 9M11 2l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Form */}
            {addingEvent && (
              <div ref={eventFormRef} className="px-4 py-4 border-t border-gray-100 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {editingEventId ? "Edit event" : "New event"}
                </p>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">Event type</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as EventType, label: "" })}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {(Object.keys(EVENT_META) as EventType[]).map((t) => (
                      <option key={t} value={t}>{EVENT_META[t].label}</option>
                    ))}
                  </select>
                </div>

                {/* Person picker — for termination */}
                {form.type === "termination" && (() => {
                  const person = baseline.people.find((p) => p.id === form.personId);
                  return (
                    <>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Employee (optional)</label>
                        <select
                          value={form.personId}
                          onChange={(e) => {
                            const p = baseline.people.find(x => x.id === e.target.value);
                            setForm({
                              ...form,
                              personId: e.target.value,
                              amountUSD: p ? String(p.salaryUSD) : form.amountUSD,
                              label: p ? `Terminate ${p.name}` : "",
                            });
                          }}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select employee…</option>
                          {baseline.people.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} — {fmtUSD(p.salaryUSD)}/mo
                            </option>
                          ))}
                        </select>
                      </div>
                      {person && (
                        <div className="flex items-center gap-3 px-3 py-2 bg-red-50 rounded-lg text-xs text-red-600">
                          <span>Salary removed:</span>
                          <span className="font-semibold">{fmtUSD(person.salaryUSD)}/mo · {fmtUSD(person.salaryUSD * 12)}/yr</span>
                        </div>
                      )}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Effective date</label>
                        <input
                          type="date"
                          value={form.effectiveDate}
                          onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        {form.effectiveDate && (
                          <p className="text-[11px] mt-1 text-gray-400">
                            Takes effect from <span className="font-medium text-gray-600">{monthLabels[dateToMonthIndex(form.effectiveDate)]}</span>
                          </p>
                        )}
                      </div>
                    </>
                  );
                })()}

                {/* Person picker — only for person_raise */}
                {form.type === "person_raise" && (() => {
                  const person = baseline.people.find((p) => p.id === form.personId);
                  const newSal = parseFloat(form.newSalaryUSD) || 0;
                  const delta  = person ? newSal - person.salaryUSD : 0;
                  return (
                    <>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Person</label>
                        <select
                          value={form.personId}
                          onChange={(e) => {
                            const p = baseline.people.find(x => x.id === e.target.value);
                            setForm({
                              ...form,
                              personId: e.target.value,
                              label: p ? `${p.name} raise` : "",
                            });
                          }}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select person…</option>
                          {baseline.people.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} — {fmtUSD(p.salaryUSD)}/mo
                            </option>
                          ))}
                        </select>
                      </div>
                      {person && (
                        <>
                          <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg text-xs text-gray-500">
                            <span>Current salary:</span>
                            <span className="font-semibold text-gray-700">{fmtUSD(person.salaryUSD)}/mo</span>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">New monthly salary (USD)</label>
                            <input
                              type="number" inputMode="decimal"
                              value={form.newSalaryUSD}
                              onChange={(e) => setForm({ ...form, newSalaryUSD: e.target.value })}
                              placeholder={String(person.salaryUSD)}
                              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            {newSal > 0 && (
                              <p className={`text-[11px] mt-1 font-medium ${delta >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                {delta >= 0
                                  ? `Raise: +${fmtUSD(delta)}/mo · +${fmtUSD(delta * 12)}/yr · +${((delta / person.salaryUSD) * 100).toFixed(1)}%`
                                  : `Reduction: ${fmtUSD(delta)}/mo · ${fmtUSD(delta * 12)}/yr · ${((delta / person.salaryUSD) * 100).toFixed(1)}%`}
                              </p>
                            )}
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}

                <div>
                  <label className="block text-xs text-gray-500 mb-1">Label</label>
                  <input
                    type="text"
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    placeholder={meta.label}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {form.type === "one_time_expense" && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Payment month</label>
                    <select
                      value={Math.min(form.startMonth, timeline - 1)}
                      onChange={(e) => {
                        const m = parseInt(e.target.value);
                        setForm({ ...form, startMonth: m, endMonth: m });
                      }}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {monthLabels.map((label, i) => (
                        <option key={i} value={i}>{label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {form.type !== "scheduled_revenue" && form.type !== "termination" && form.type !== "one_time_expense" && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Start month</label>
                        <select
                          value={Math.min(form.startMonth, timeline - 1)}
                          onChange={(e) => {
                            const s = parseInt(e.target.value);
                            setForm({ ...form, startMonth: s, endMonth: Math.max(s, Math.min(form.endMonth, timeline - 1)) });
                          }}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {monthLabels.map((label, i) => (
                            <option key={i} value={i}>{label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">End month</label>
                        <select
                          value={Math.min(form.endMonth, timeline - 1)}
                          onChange={(e) => setForm({ ...form, endMonth: parseInt(e.target.value) })}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {monthLabels.map((label, i) => (
                            <option key={i} value={i} disabled={i < form.startMonth}>{label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-400">
                      Duration:{" "}
                      <span className="font-medium text-gray-600">
                        {form.endMonth - form.startMonth + 1} month{form.endMonth - form.startMonth !== 0 ? "s" : ""}
                      </span>
                    </p>
                  </>
                )}

                {form.type === "scheduled_revenue" && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-gray-500">Payment schedule</label>
                      <button
                        type="button"
                        onClick={() => setForm({
                          ...form,
                          scheduledPayments: [
                            ...form.scheduledPayments,
                            { month: form.scheduledPayments.at(-1)?.month ?? 0, amountUSD: "" },
                          ],
                        })}
                        className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                      >
                        + Add payment
                      </button>
                    </div>
                    <div className="space-y-2">
                      {form.scheduledPayments.map((p, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <select
                            value={p.month}
                            onChange={(e) => {
                              const updated = form.scheduledPayments.map((x, i) =>
                                i === idx ? { ...x, month: parseInt(e.target.value) } : x
                              );
                              setForm({ ...form, scheduledPayments: updated });
                            }}
                            className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {monthLabels.map((label, i) => (
                              <option key={i} value={i}>{label}</option>
                            ))}
                          </select>
                          <input
                            type="number" inputMode="decimal"
                            value={p.amountUSD}
                            onChange={(e) => {
                              const updated = form.scheduledPayments.map((x, i) =>
                                i === idx ? { ...x, amountUSD: e.target.value } : x
                              );
                              setForm({ ...form, scheduledPayments: updated });
                            }}
                            placeholder="USD amount"
                            className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          {form.scheduledPayments.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setForm({
                                ...form,
                                scheduledPayments: form.scheduledPayments.filter((_, i) => i !== idx),
                              })}
                              className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0"
                            >
                              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                                <path d="M2 2l7 7M9 2l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                              </svg>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {form.scheduledPayments.filter(p => parseFloat(p.amountUSD) > 0).length > 0 && (
                      <p className="text-[11px] text-gray-400 mt-2">
                        Total: <span className="font-medium text-gray-600">
                          {fmtUSD(form.scheduledPayments.reduce((s, p) => s + (parseFloat(p.amountUSD) || 0), 0))}
                        </span>
                      </p>
                    )}
                  </div>
                )}

                {meta.amountLabel && form.type !== "scheduled_revenue" && form.type !== "person_raise" && form.type !== "termination" && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">{meta.amountLabel}</label>
                    <input
                      type="number" inputMode="decimal"
                      value={form.amountUSD}
                      onChange={(e) => setForm({ ...form, amountUSD: e.target.value })}
                      placeholder="0"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}

                {meta.pctLabel && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">{meta.pctLabel}</label>
                    <input
                      type="number" inputMode="decimal"
                      value={form.pct}
                      onChange={(e) => setForm({ ...form, pct: e.target.value })}
                      placeholder="5"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button onClick={saveEvent} className="flex-1 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
                    {editingEventId ? "Save changes" : "Add event"}
                  </button>
                  <button
                    onClick={() => { setAddingEvent(false); setEditingEventId(null); }}
                    className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
