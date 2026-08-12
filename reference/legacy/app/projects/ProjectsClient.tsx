"use client";

import { useState, useEffect, useRef } from "react";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";
import { PROJECT_COLORS } from "@/lib/projectColors";
import VendorCombobox from "@/app/components/VendorCombobox";
import { useRouter } from "next/navigation";
import Link from "next/link";
import TimesheetProjectImportModal from "./TimesheetProjectImportModal";
import type { ProjectHealthEntry } from "@/app/api/projects/health/route";

// ─── types ────────────────────────────────────────────────────────────────────

type ProjectInvoice = { amount: number; currency: string; status: string };
type ProjectExpense = { amount: number; currency: string };
type ProjectMilestone = { id: string; name: string; completedAt: string | null; billingAmount: number | null; billingPercent: number | null };
type TimesheetEntry = { hoursLogged: number; hourlyRate: number | null; currency: string; employeeName: string };
type TimesheetImport = { id: string; month: string; createdAt: string; entries: TimesheetEntry[] };
type ProjectTeamMember = { name: string; costPerHour: number | null; currency: string; hidden: boolean };

export type ProjectSummary = {
  id: string;
  name: string;
  clientName: string | null;
  description: string | null;
  billingType: string;
  contractValue: number | null;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  color: string | null;
  createdAt: string;
  milestones: ProjectMilestone[];
  invoices: ProjectInvoice[];
  documentLinks: { milestoneId: string | null; serviceId: string | null; document: { amount: number | null; isPaid: boolean; currency: string | null } }[];
  expenses: ProjectExpense[];
  timesheets: TimesheetImport[];
  teamMembers: ProjectTeamMember[];
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtUSD(amount: number) {
  return `USD ${Math.round(amount).toLocaleString("en-US")}`;
}

function toUSD(amount: number, currency: string, rates: Record<string, number>): number {
  if (currency === "USD") return amount;
  const rate = rates[currency];
  return rate ? amount / rate : amount;
}

function totalCostUSD(project: ProjectSummary, rates: Record<string, number>): number {
  const memberRates = new Map(
    (project.teamMembers ?? [])
      .filter(m => !m.hidden && m.costPerHour != null)
      .map(m => [m.name.toLowerCase(), m])
  );
  const laborUSD = (project.timesheets ?? []).flatMap(t => t.entries).reduce((sum, e) => {
    const member = memberRates.get(e.employeeName.toLowerCase());
    const rate = e.hourlyRate ?? member?.costPerHour ?? null;
    if (rate == null) return sum;
    const cur = e.hourlyRate != null ? e.currency : (member?.currency ?? "USD");
    return sum + toUSD(e.hoursLogged * rate, cur, rates);
  }, 0);
  const expensesUSD = (project.expenses ?? []).reduce((s, e) => s + toUSD(e.amount, e.currency, rates), 0);
  return laborUSD + expensesUSD;
}

function totalInvoiced(project: ProjectSummary, rates: Record<string, number>): number {
  // PS projects bill exclusively via service-linked client docs — ProjectInvoice records don't apply
  if (project.billingType === "ps") {
    return (project.documentLinks ?? [])
      .filter(l => l.serviceId != null)
      .reduce((s, l) => s + toUSD(l.document.amount ?? 0, l.document.currency ?? project.currency, rates), 0);
  }
  const fromProjectInvoices = project.invoices
    .filter(i => i.status !== "draft")
    .reduce((s, i) => s + toUSD(i.amount, i.currency, rates), 0);
  const fromClientDocs = (project.documentLinks ?? [])
    .filter(l => l.milestoneId != null)
    .reduce((s, l) => s + toUSD(l.document.amount ?? 0, l.document.currency ?? project.currency, rates), 0);
  return fromProjectInvoices + fromClientDocs;
}

function totalPaid(project: ProjectSummary, rates: Record<string, number>): number {
  // PS projects bill exclusively via service-linked client docs — ProjectInvoice records don't apply
  if (project.billingType === "ps") {
    return (project.documentLinks ?? [])
      .filter(l => l.serviceId != null && l.document.isPaid)
      .reduce((s, l) => s + toUSD(l.document.amount ?? 0, l.document.currency ?? project.currency, rates), 0);
  }
  const fromProjectInvoices = project.invoices
    .filter(i => i.status === "paid")
    .reduce((s, i) => s + toUSD(i.amount, i.currency, rates), 0);
  const fromClientDocs = (project.documentLinks ?? [])
    .filter(l => l.milestoneId != null && l.document.isPaid)
    .reduce((s, l) => s + toUSD(l.document.amount ?? 0, l.document.currency ?? project.currency, rates), 0);
  return fromProjectInvoices + fromClientDocs;
}

function billingTypePill(billingType: string) {
  const map: Record<string, { label: string; cls: string }> = {
    milestone: { label: "Milestone", cls: "bg-indigo-50 text-indigo-600 border border-indigo-100" },
    fixed:     { label: "Fixed",     cls: "bg-indigo-50 text-indigo-600 border border-indigo-100" },
    tm:        { label: "T&M",       cls: "bg-violet-50 text-violet-600 border border-violet-100" },
    ps:        { label: "PS",        cls: "bg-teal-50 text-teal-600 border border-teal-100" },
  };
  const { label, cls } = map[billingType] ?? { label: billingType, cls: "bg-gray-100 text-gray-500 border border-gray-200" };
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  );
}

function statusChip(status: string) {
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    completed: "bg-blue-100 text-blue-700",
    on_hold: "bg-amber-100 text-amber-700",
    cancelled: "bg-red-100 text-red-700",
  };
  const label: Record<string, string> = {
    active: "Active", completed: "Completed", on_hold: "On Hold", cancelled: "Cancelled",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
      {label[status] ?? status}
    </span>
  );
}

// ─── new project modal ────────────────────────────────────────────────────────

const BILLING_TYPES = [
  {
    value: "milestone",
    label: "Milestone-based",
    desc: "Scoped project. Client pays on milestone completion.",
    icon: "🏁",
  },
  {
    value: "tm",
    label: "Time & Material",
    desc: "No fixed price. Billed by hours × billing rate.",
    icon: "⏱",
  },
  {
    value: "ps",
    label: "Professional Services",
    desc: "Activity-based. Services grouped for billing per agreement terms.",
    icon: "🔧",
  },
] as const;

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: ProjectSummary) => void }) {
  const activeCurrencies = useActiveCurrencies();
  const [form, setForm] = useState({
    name: "", clientName: "", contractValue: "", currency: "AED",
    startDate: "", endDate: "", status: "active", description: "",
    billingType: "milestone" as "milestone" | "tm" | "ps",
    color: PROJECT_COLORS[0].bar,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [vendors, setVendors] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/invoices/vendors").then(r => r.ok ? r.json() : { vendors: [] }).then(d => setVendors(d.vendors ?? [])).catch(() => {});
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          contractValue: form.contractValue ? parseFloat(form.contractValue) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to create"); setSaving(false); return; }
      onCreated({ ...data, milestones: [], invoices: [], expenses: [], timesheets: [] });
      onClose();
    } catch {
      setError("Network error");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <form onSubmit={submit}>
          <div className="px-6 py-5 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">New project</p>
          </div>
          <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
            {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            {/* Billing type */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Billing type *</label>
              <div className="grid grid-cols-3 gap-2">
                {BILLING_TYPES.map(bt => (
                  <button
                    key={bt.value}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, billingType: bt.value }))}
                    className={`text-left p-3 rounded-xl border-2 transition-colors ${
                      form.billingType === bt.value
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="text-base mb-1">{bt.icon}</div>
                    <p className={`text-xs font-semibold ${form.billingType === bt.value ? "text-indigo-700" : "text-gray-800"}`}>{bt.label}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{bt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Project name *</label>
                <div className="flex items-center gap-2">
                  <input value={form.name} onChange={set("name")} required className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" placeholder="Website redesign" />
                  <div className="w-8 h-8 rounded-lg border-2 border-white shadow shrink-0" style={{ backgroundColor: form.color }} />
                </div>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Color</label>
                <div className="flex flex-wrap gap-2">
                  {PROJECT_COLORS.map(c => (
                    <button
                      key={c.bar}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, color: c.bar }))}
                      className="w-6 h-6 rounded-full transition-transform hover:scale-110 focus:outline-none"
                      style={{ backgroundColor: c.bar, boxShadow: form.color === c.bar ? `0 0 0 2px white, 0 0 0 4px ${c.bar}` : "none" }}
                      title={c.bar}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
                <VendorCombobox
                  value={form.clientName}
                  onChange={v => setForm(f => ({ ...f, clientName: v }))}
                  vendors={vendors}
                  placeholder="Search or add client…"
                  inputClassName="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                <select value={form.status} onChange={set("status")} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300 bg-white">
                  <option value="active">Active</option>
                  <option value="on_hold">On Hold</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              {form.billingType === "milestone" && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Total project value</label>
                  <input type="number" min="0" step="any" value={form.contractValue} onChange={set("contractValue")} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" placeholder="100000" />
                </div>
              )}
              {(form.billingType === "tm" || form.billingType === "ps") && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Budget cap <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input type="number" min="0" step="any" value={form.contractValue} onChange={set("contractValue")} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" placeholder="Max spend" />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
                <select value={form.currency} onChange={set("currency")} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300 bg-white">
                  {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start date</label>
                <input type="date" value={form.startDate} onChange={set("startDate")} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End date</label>
                <input type="date" value={form.endDate} onChange={set("endDate")} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <textarea value={form.description} onChange={set("description")} rows={2} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300 resize-none" placeholder="Brief description…" />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
            <button type="button" onClick={onClose} className="text-sm font-medium text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving} className="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-5 py-2 rounded-lg">
              {saving ? "Creating…" : "Create project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function ProjectsClient({ projects: initial, canWrite, fxRates }: { projects: ProjectSummary[]; canWrite: boolean; fxRates: Record<string, number> }) {
  const router = useRouter();
  const [projects, setProjects] = useState(initial);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [view, setView] = useState<"grid" | "chart">("grid");
  const [sortBy, setSortBy] = useState<"createdAt" | "name" | "budget" | "cost" | "startDate" | "endDate">("createdAt");
  const [healthMap, setHealthMap] = useState<Map<string, ProjectHealthEntry>>(new Map());
  const healthInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refreshHealth() {
    try {
      const res = await fetch("/api/projects/health");
      if (res.ok) {
        const data = await res.json();
        setHealthMap(new Map((data.projects as ProjectHealthEntry[]).map((p: ProjectHealthEntry) => [p.id, p])));
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    refreshHealth();
    healthInterval.current = setInterval(refreshHealth, 90_000);
    const onVisibility = () => { if (document.visibilityState === "visible") refreshHealth(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (healthInterval.current) clearInterval(healthInterval.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const totalContract = projects.reduce((s, p) => s + toUSD(p.contractValue ?? 0, p.currency, fxRates), 0);
  const totalInv = projects.reduce((s, p) => s + totalInvoiced(p, fxRates), 0);
  const totalPd = projects.reduce((s, p) => s + totalPaid(p, fxRates), 0);
  const activeCount = projects.filter(p => p.status === "active").length;

  const q = search.trim().toLowerCase();
  const filtered = q
    ? projects.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.clientName ?? "").toLowerCase().includes(q) ||
        p.status.toLowerCase().includes(q)
      )
    : projects;

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name);
      case "budget": {
        const ab = a.contractValue != null ? toUSD(a.contractValue, a.currency, fxRates) : -1;
        const bb = b.contractValue != null ? toUSD(b.contractValue, b.currency, fxRates) : -1;
        return bb - ab;
      }
      case "cost":
        return totalCostUSD(b, fxRates) - totalCostUSD(a, fxRates);
      case "startDate": {
        const ad = a.startDate ? new Date(a.startDate).getTime() : 0;
        const bd = b.startDate ? new Date(b.startDate).getTime() : 0;
        return bd - ad;
      }
      case "endDate": {
        const ad = a.endDate ? new Date(a.endDate).getTime() : Infinity;
        const bd = b.endDate ? new Date(b.endDate).getTime() : Infinity;
        return ad - bd;
      }
      default: // createdAt
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  });

  const chartData = sorted
    .map(p => ({
      id: p.id,
      name: p.name,
      status: p.status,
      color: p.color,
      costUSD: totalCostUSD(p, fxRates),
      budgetUSD: p.contractValue ? toUSD(p.contractValue, p.currency, fxRates) : null,
    }))
    .sort((a, b) => Math.max(b.budgetUSD ?? 0, b.costUSD) - Math.max(a.budgetUSD ?? 0, a.costUSD));
  const chartMax = Math.max(...chartData.map(d => Math.max(d.costUSD, d.budgetUSD ?? 0)), 1);
  const chartTotalCost = chartData.reduce((s, d) => s + d.costUSD, 0);
  const chartTotalBudget = chartData.filter(d => d.budgetUSD != null).reduce((s, d) => s + (d.budgetUSD ?? 0), 0);

  return (
    <>
      {showNew && (
        <NewProjectModal
          onClose={() => setShowNew(false)}
          onCreated={p => { setProjects(prev => [p, ...prev]); router.push(`/projects/${p.id}`); }}
        />
      )}
      {showImport && (
        <TimesheetProjectImportModal
          onClose={() => setShowImport(false)}
          onCreated={newProjects => setProjects(prev => [...newProjects, ...prev])}
        />
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Active projects", value: activeCount.toString() },
          { label: "Total contract value", value: totalContract > 0 ? fmtUSD(totalContract) : "—" },
          { label: "Total invoiced", value: totalInv > 0 ? fmtUSD(totalInv) : "—" },
          { label: "Total collected", value: totalPd > 0 ? fmtUSD(totalPd) : "—" },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{kpi.label}</p>
            <p className="text-lg font-bold text-gray-900 mt-1">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Header + search + new button */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-sm">
          <div className="relative flex-1">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M10.5 10.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search projects…"
              className="w-full pl-8 pr-3 h-8 text-sm border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-200 bg-white"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            )}
          </div>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 h-8 bg-white text-gray-600 outline-none focus:ring-1 focus:ring-indigo-200 cursor-pointer shrink-0"
          >
            <option value="createdAt">Newest first</option>
            <option value="name">Name A–Z</option>
            <option value="budget">Budget ↓</option>
            <option value="cost">Cost ↓</option>
            <option value="startDate">Start date ↓</option>
            <option value="endDate">End date ↑</option>
          </select>
        </div>
        <p className="text-xs text-gray-400 shrink-0">
          {q ? `${filtered.length} of ${projects.length}` : `${projects.length}`} project{projects.length !== 1 ? "s" : ""}
        </p>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => setView("grid")}
              title="Grid view"
              className={`p-1.5 transition-colors ${view === "grid" ? "bg-indigo-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <rect x="1" y="1" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
                <rect x="7.5" y="1" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
                <rect x="1" y="7.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
                <rect x="7.5" y="7.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </button>
            <button
              onClick={() => setView("chart")}
              title="Cost vs Budget chart"
              className={`p-1.5 transition-colors ${view === "chart" ? "bg-indigo-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M1 12h11M3 12V6M6.5 12V3M10 12V7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {canWrite && (
            <>
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 8V2m0 0L4 4m2-2l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M1 9v1a1 1 0 001 1h8a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Create projects from timesheet
              </button>
              <button
                onClick={() => setShowNew(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                New project
              </button>
            </>
          )}
        </div>
      </div>

      {/* Cost vs Budget chart */}
      {view === "chart" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Summary totals */}
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-10">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Total cost</p>
              <p className="text-lg font-bold text-gray-900">{chartTotalCost > 0 ? fmtUSD(chartTotalCost) : "—"}</p>
            </div>
            {chartTotalBudget > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Total budget</p>
                <p className="text-lg font-bold text-gray-900">{fmtUSD(chartTotalBudget)}</p>
              </div>
            )}
            {chartTotalBudget > 0 && chartTotalCost > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Overall utilization</p>
                <p className={`text-lg font-bold ${chartTotalCost > chartTotalBudget ? "text-red-600" : chartTotalCost / chartTotalBudget >= 0.85 ? "text-amber-600" : "text-emerald-600"}`}>
                  {Math.round((chartTotalCost / chartTotalBudget) * 100)}%
                </p>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="px-6 pt-4 pb-1 flex items-center gap-5 text-[11px] text-gray-400">
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-3.5 rounded-sm bg-gray-100 border border-gray-200" />
              <span>Budget</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-2 rounded-sm bg-emerald-500" />
              <span>Cost — healthy</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-2 rounded-sm bg-amber-500" />
              <span>Near limit (≥ 85%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-2 rounded-sm bg-red-500" />
              <span>Over budget</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-2 rounded-sm bg-indigo-400" />
              <span>Cost — no budget set</span>
            </div>
          </div>

          {/* Rows */}
          <div className="px-6 pb-6 pt-3 space-y-2.5">
            {chartData.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-12">No projects to display</p>
            )}
            {chartData.map(d => {
              const utilization = d.budgetUSD && d.budgetUSD > 0 ? d.costUSD / d.budgetUSD : null;
              const overBudget = utilization != null && utilization > 1;
              const nearLimit  = utilization != null && utilization >= 0.85 && !overBudget;
              const costColor  = overBudget ? "#ef4444" : nearLimit ? "#f59e0b" : utilization != null ? "#10b981" : "#818cf8";
              const budgetBarPct = d.budgetUSD ? (d.budgetUSD / chartMax) * 100 : 0;
              const costBarPct   = (d.costUSD / chartMax) * 100;

              return (
                <div key={d.id} className="flex items-center gap-4">
                  {/* Name */}
                  <div className="w-44 shrink-0 text-right">
                    <p className="text-xs font-medium text-gray-800 truncate leading-tight" title={d.name}>{d.name}</p>
                    {d.status !== "active" && (
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mt-0.5">{d.status.replace("_", " ")}</p>
                    )}
                  </div>

                  {/* Bullet chart */}
                  <div className="flex-1 relative h-6">
                    {/* Budget background track */}
                    {d.budgetUSD != null && (
                      <div
                        className="absolute top-0 bottom-0 left-0 bg-gray-100 border border-gray-200 rounded"
                        style={{ width: `${budgetBarPct}%` }}
                      />
                    )}
                    {/* Cost bar (thinner, centered vertically) */}
                    {d.costUSD > 0 && (
                      <div
                        className="absolute top-1.5 bottom-1.5 left-0 rounded"
                        style={{ width: `${costBarPct}%`, backgroundColor: costColor }}
                      />
                    )}
                  </div>

                  {/* Values */}
                  <div className="w-56 shrink-0">
                    <div className="flex items-baseline gap-1 flex-wrap">
                      <span className={`text-xs font-semibold ${overBudget ? "text-red-600" : "text-gray-800"}`}>
                        {fmtUSD(d.costUSD)}
                      </span>
                      {d.budgetUSD != null && (
                        <span className="text-[11px] text-gray-400">/ {fmtUSD(d.budgetUSD)}</span>
                      )}
                    </div>
                    {utilization != null && (
                      <p className={`text-[10px] font-semibold ${overBudget ? "text-red-500" : nearLimit ? "text-amber-500" : "text-emerald-500"}`}>
                        {Math.round(utilization * 100)}% utilized
                      </p>
                    )}
                    {d.budgetUSD == null && d.costUSD === 0 && (
                      <p className="text-[10px] text-gray-400">No data</p>
                    )}
                    {d.budgetUSD == null && d.costUSD > 0 && (
                      <p className="text-[10px] text-gray-400">No budget set</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Projects grid */}
      {view === "grid" && (projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="2" y="4" width="18" height="15" rx="2" stroke="#9ca3af" strokeWidth="1.5" fill="none" />
              <path d="M7 4V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M7 10h8M7 14h5" stroke="#9ca3af" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-gray-600">No projects yet</p>
          <p className="text-xs text-gray-400 mt-1">Create your first project to start tracking budgets and milestones.</p>
          {canWrite && (
            <button onClick={() => setShowNew(true)} className="mt-4 text-xs font-semibold text-indigo-600 hover:text-indigo-800">
              + Create a project
            </button>
          )}
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm font-semibold text-gray-600">No projects match &ldquo;{search}&rdquo;</p>
          <button onClick={() => setSearch("")} className="mt-2 text-xs text-indigo-600 hover:text-indigo-800">Clear search</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map(project => {
            const collected = totalPaid(project, fxRates);
            const invoiced = totalInvoiced(project, fxRates);
            const costUSD = totalCostUSD(project, fxRates);
            const budgetUSD = project.contractValue ? toUSD(project.contractValue, project.currency, fxRates) : 0;
            const costPct = budgetUSD > 0 ? Math.min(100, Math.round((costUSD / budgetUSD) * 100)) : 0;
            const totalMs = project.milestones.length;
            const completedMilestones = project.milestones.filter(m => m.completedAt).length;
            const milestonePct = totalMs > 0 ? Math.round((completedMilestones / totalMs) * 100) : 0;
            const collectedPct = project.contractValue ? Math.min(100, (collected / project.contractValue) * 100) : 0;
            const invoicedPct = project.contractValue ? Math.min(100, (invoiced / project.contractValue) * 100) : 0;

            // Health comes from the live API (same computation as project detail page)
            const healthEntry = healthMap.get(project.id);
            const isLowMargin = (healthEntry?.tags ?? []).some(t => t.includes("· At risk"));
            type HealthTag = { label: string; cls: string };
            const healthTags: HealthTag[] = (healthEntry?.tags ?? []).map(tag => ({
              label: tag,
              cls: tag === "Past end date"   ? "text-red-600 bg-red-50 border-red-100"
                 : tag === "Over budget"     ? "text-orange-600 bg-orange-50 border-orange-100"
                 : isLowMargin               ? "text-amber-600 bg-amber-50 border-amber-100"
                 : healthEntry?.health === "profitable" ? "text-emerald-600 bg-emerald-50 border-emerald-100"
                 : "text-amber-600 bg-amber-50 border-amber-100",
            }));

            const hasNoEntries = (project.status === "active" || project.status === "on_hold") &&
              project.timesheets.length === 0;

            const isAtRisk   = healthEntry?.health === "at_risk";
            const isProfitable = healthEntry?.health === "profitable";
            // Low-margin projects get amber border, not red (it's a warning, not a hard failure)
            const cardBorder = isAtRisk && !isLowMargin
              ? "border-red-200 hover:border-red-300"
              : isLowMargin
              ? "border-amber-200 hover:border-amber-300"
              : isProfitable
              ? "border-emerald-200 hover:border-emerald-300"
              : "border-gray-200 hover:border-indigo-200";

            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className={`bg-white rounded-xl border ${cardBorder} hover:shadow-sm transition-all p-4 flex flex-col gap-3`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{project.name}</p>
                    {project.clientName && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{project.clientName}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {billingTypePill(project.billingType)}
                    {statusChip(project.status)}
                  </div>
                </div>

                {/* Milestone progress — hidden for PS projects */}
                {totalMs > 0 && project.billingType !== "ps" && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-gray-400">Milestones</span>
                      <span className="text-[10px] font-medium text-gray-600">{completedMilestones} / {totalMs} done</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${milestonePct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Budget burn — PS projects only */}
                {project.billingType === "ps" && healthEntry?.budgetBurnPct != null && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-gray-400">Budget consumed</span>
                      <span className={`text-[10px] font-semibold ${healthEntry.budgetBurnPct >= 100 ? "text-red-600" : healthEntry.budgetBurnPct >= 85 ? "text-amber-600" : "text-emerald-600"}`}>
                        {healthEntry.budgetBurnPct}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${healthEntry.budgetBurnPct}%`,
                          backgroundColor: healthEntry.budgetBurnPct >= 100 ? "#ef4444" : healthEntry.budgetBurnPct >= 85 ? "#f59e0b" : "#10b981",
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Cost vs budget */}
                {(costUSD > 0 || budgetUSD > 0) && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-gray-400">Cost</span>
                      <span className="text-[10px] font-medium text-gray-600">
                        {fmtUSD(costUSD)}{budgetUSD > 0 ? ` / ${fmtUSD(budgetUSD)}` : ""}
                      </span>
                    </div>
                    {budgetUSD > 0 && (
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${costPct}%`,
                            backgroundColor: costPct >= 100 ? "#ef4444" : costPct >= 85 ? "#f59e0b" : "#10b981",
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Collection progress */}
                {project.contractValue && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-gray-400">Collected</span>
                      <span className="text-[10px] font-medium text-gray-600">
                        {fmtCurrency(collected, project.currency)} / {fmtCurrency(project.contractValue, project.currency)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden relative">
                      <div
                        className="absolute h-full rounded-full bg-indigo-200 transition-all"
                        style={{ width: `${invoicedPct}%` }}
                      />
                      <div
                        className="absolute h-full rounded-full bg-indigo-500 transition-all"
                        style={{ width: `${collectedPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Health tags + no-entries indicator */}
                {(healthTags.length > 0 || hasNoEntries) && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {healthTags.map(tag => (
                      <span key={tag.label} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${tag.cls}`}>
                        {tag.label}
                      </span>
                    ))}
                    {hasNoEntries && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">
                        <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.4" />
                          <path d="M6 3.5v2.75l1.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                        No time entries
                      </span>
                    )}
                  </div>
                )}

                {totalMs > 0 && project.billingType !== "ps" && healthTags.length === 0 && !hasNoEntries && (
                  <p className="text-[11px] text-gray-400">{totalMs} milestone{totalMs !== 1 ? "s" : ""}</p>
                )}
                {healthTags.length === 0 && !hasNoEntries && totalMs === 0 && !healthEntry && (
                  <p className="text-[11px] text-gray-300">—</p>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}
