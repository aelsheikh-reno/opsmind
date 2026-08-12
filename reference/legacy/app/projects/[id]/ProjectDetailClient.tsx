"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useBackgroundTasks } from "@/app/contexts/BackgroundTasksContext";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";
import VendorCombobox from "@/app/components/VendorCombobox";
import AddPersonModal from "@/app/components/AddPersonModal";
import ProjectActivityPanel, { type ProjectActivityPanelHandle } from "./ProjectActivityPanel";
import MilestoneGantt from "./MilestoneGantt";
import ResourceUtilizationChart from "./ResourceUtilizationChart";
import ServicesSection from "./ServicesSection";
import { PROJECT_COLORS } from "@/lib/projectColors";
import ProjectInsightsDrawer from "./ProjectInsightsDrawer";
import ForecastTab from "./ForecastTab";

// ─── helpers ─────────────────────────────────────────────────────────────────

async function fetchJSON(input: RequestInfo, init?: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(input, init);
  let data: unknown;
  try { data = await res.json(); } catch { data = { error: `Server error (${res.status})` }; }
  return { ok: res.ok, status: res.status, data };
}

// ─── types ────────────────────────────────────────────────────────────────────

type EntryMilestone = { id: string; name: string } | null;
type EntryService = { id: string; name: string } | null;
type TimesheetEntry = { id: string; employeeName: string; role: string | null; taskName: string | null; date: string | null; milestoneId: string | null; milestone: EntryMilestone; serviceId: string | null; service: EntryService; hoursLogged: number; hourlyRate: number | null; currency: string; notes: string | null };
type TimesheetImport = { id: string; month: string; filename: string | null; createdAt: string; entries: TimesheetEntry[] };

type PreviewRow = {
  index: number; employeeName: string; role: string | null; taskName: string | null;
  hoursLogged: number; hourlyRate: number | null; currency: string; notes: string | null;
  projectColValue: string | null; matchScore: number; suggested: boolean; milestoneId: string | null;
  date: string | null;
  matchedPersonId: string | null;
  matchedPersonName: string | null;
  matchedCostPerHour: number | null;
  matchedBillingRate: number | null;
  matchedRateCurrency: string | null;
  aiReason?: string;
};

type MilestoneInvoice = {
  id: string; amount: number; currency: string; status: string;
  issuedAt: string | null; dueDate: string | null; paidAt: string | null;
  referenceNumber: string | null; notes: string | null; createdAt: string;
};

type MilestoneTask = { name: string; completionPercent: number | null; estimatedHours: number | null };

type Milestone = {
  id: string; name: string; description: string | null; dueDate: string | null;
  startDate: string | null; completedAt: string | null; completionPercent: number | null;
  estimatedHours: number | null;
  tasks: string | null;
  billingAmount: number | null; billingPercent: number | null;
  order: number; createdAt: string; invoices: MilestoneInvoice[];
};

type ProjectExpense = { id: string; description: string; amount: number; currency: string; date: string; category: string | null; notes: string | null; createdAt: string };

type ProjectInvoice = MilestoneInvoice & { milestoneId: string | null; milestone: { id: string; name: string } | null; serviceId: string | null; service: { id: string; name: string } | null };

type TeamMember = {
  id: string; name: string; costPerHour: number | null;
  billingRate: number | null; currency: string; hidden: boolean; createdAt: string;
  allocationPercent: number | null;
  personId: string | null;
  person: { id: string; name: string; jobTitle: string | null } | null;
};

type ClientDocument = {
  id: string; filename: string | null; status: string | null; amount: number | null;
  vatAmount: number | null; currency: string | null; issueDate: string | null;
  expiryDate: string | null; isPaid: boolean; paidAt: string | null;
  referenceNumber: string | null; summary: string | null; parties: string | null;
  milestoneId: string | null; milestoneName: string | null;
  serviceId: string | null; serviceName: string | null;
};

type ExtractedMilestone = { name: string; description: string | null; startDate: string | null; dueDate: string | null; billingAmount: number | null; completionPercent: number | null; estimatedHours: number | null; activities: MilestoneTask[] | null };

type DiffChange = { field: string; from: string | number | null; to: string | number | null };
type ExtractedWithDiff = ExtractedMilestone & {
  _diffKind: "new" | "update" | "unchanged";
  _matchedId?: string;
  _changes?: DiffChange[];
};

type ServiceActivity = { id: string; name: string; description: string | null; status: string; order: number };
type ProjectService = { id: string; name: string; description: string | null; billingAmount: number | null; paymentTerms: string | null; order: number; activities: ServiceActivity[] };

type Project = {
  id: string; name: string; clientName: string | null;
  description: string | null; billingType: string;
  contractValue: number | null; currency: string; startDate: string | null;
  endDate: string | null; status: string; color: string | null; createdAt: string;
  asanaProjectGid?: string | null;
  milestones: Milestone[]; teamMembers: TeamMember[]; timesheets: TimesheetImport[];
  expenses: ProjectExpense[]; invoices: ProjectInvoice[];
  services: ProjectService[];
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, currency: string) {
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// For per-hour rates: keep up to 2 decimal places so 150.50 doesn't round away
function fmtRate(n: number, currency: string) {
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// Convert a rate from one currency to another using USD-based FX rates.
function convertRate(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to || !amount) return amount;
  const usd = from === "USD" ? amount : amount / (rates[from] ?? 1);
  return to === "USD" ? usd : usd * (rates[to] ?? 1);
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AE", { day: "numeric", month: "short", year: "numeric" });
}

// Returns a date string that is `workingDays` business days (Mon–Fri) from fromDateStr.
// If the start date falls on a weekend it is moved forward to the next Monday first.
function addWorkingDays(fromDateStr: string, workingDays: number): string {
  const d = new Date(fromDateStr + "T12:00:00");
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  let remaining = workingDays;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) remaining--;
  }
  return d.toISOString().split("T")[0];
}

function invoiceStatusChip(status: string) {
  const map: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600",
    sent: "bg-blue-100 text-blue-700",
    paid: "bg-green-100 text-green-700",
    overdue: "bg-red-100 text-red-600",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      {action}
    </div>
  );
}

function AddBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      {label}
    </button>
  );
}

// ─── team section ────────────────────────────────────────────────────────────

type TeamRow = {
  name: string;
  role: string | null;
  totalHours: number;
  member: TeamMember | null;
};

function buildTeam(timesheets: TimesheetImport[], teamMembers: TeamMember[], allocations: MonthAllocation[] = []): TeamRow[] {
  const hiddenNames = new Set(teamMembers.filter(m => m.hidden).map(m => m.name));
  const byName = new Map<string, { hours: number; role: string | null }>();
  for (const ts of timesheets) {
    for (const e of ts.entries) {
      if (hiddenNames.has(e.employeeName)) continue;
      const cur = byName.get(e.employeeName) ?? { hours: 0, role: null };
      cur.hours = Math.round((cur.hours + e.hoursLogged) * 100) / 100;
      if (e.role && !cur.role) cur.role = e.role;
      byName.set(e.employeeName, cur);
    }
  }
  const rows: TeamRow[] = [...byName.entries()].map(([name, { hours, role }]) => ({
    name, role, totalHours: hours,
    member: teamMembers.find(m => m.name === name) ?? null,
  }));
  for (const m of teamMembers) {
    if (!m.hidden && !byName.has(m.name)) rows.push({ name: m.name, role: null, totalHours: 0, member: m });
  }
  // Also include anyone who has an allocation but isn't in the team roster or timesheets
  const seenNames = new Set(rows.map(r => r.name.toLowerCase()));
  for (const a of allocations) {
    if (!seenNames.has(a.memberName.toLowerCase())) {
      seenNames.add(a.memberName.toLowerCase());
      rows.push({ name: a.memberName, role: null, totalHours: 0, member: null });
    }
  }
  return rows.sort((a, b) => b.totalHours - a.totalHours);
}

type MonthAllocation = { id?: string; memberName: string; startDate: string; endDate: string; allocationPercent: number };

function monthToDateRange(month: string): { startDate: string; endDate: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { startDate: `${month}-01`, endDate: `${month}-${String(last).padStart(2, "0")}` };
}

function allocMonth(a: MonthAllocation): string {
  return a.startDate.slice(0, 7);
}

function TeamSection({
  projectId, teamMembers, timesheets, currency, canWrite, fxRates, onChange,
  allocations, onAllocationsChange,
}: {
  projectId: string; teamMembers: TeamMember[]; timesheets: TimesheetImport[];
  currency: string; canWrite: boolean; fxRates: Record<string, number>;
  onChange: (members: TeamMember[]) => void;
  allocations: MonthAllocation[];
  onAllocationsChange: (updated: MonthAllocation) => void;
}) {
  const team = buildTeam(timesheets, teamMembers, allocations);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [form, setForm] = useState({ costPerHour: "", billingRate: "", allocationPercent: "100" });
  const [saving, setSaving] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null);

  const [addingMember, setAddingMember] = useState(false);
  const [addMemberForm, setAddMemberForm] = useState({ name: "", costPerHour: "", billingRate: "" });
  const [addMemberSaving, setAddMemberSaving] = useState(false);
  const [peopleList, setPeopleList] = useState<{ id: string; name: string; costPerHour: number | null; billingRate: number | null; rateCurrency: string | null; jobTitle: string | null }[]>([]);
  const [peopleSearch, setPeopleSearch] = useState("");
  const [showPeopleDrop, setShowPeopleDrop] = useState(false);
  const [addToSystemName, setAddToSystemName] = useState<string | null>(null);
  const [linkingMemberId, setLinkingMemberId] = useState<string | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkingInProgress, setLinkingInProgress] = useState<string | null>(null);

  // Fetch people list on mount so we can flag team members not yet in the system
  useEffect(() => {
    fetchJSON("/api/people/with-rates").then(({ ok, data }) => {
      if (ok) setPeopleList((data as { people: typeof peopleList }).people);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const peopleNameSet = useMemo(
    () => new Set(peopleList.map(p => p.name.toLowerCase())),
    [peopleList],
  );

  async function linkMemberToPerson(memberId: string, personId: string | null) {
    setLinkingInProgress(memberId);
    const { ok, data } = await fetchJSON(`/api/projects/${projectId}/team/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId }),
    });
    if (ok) {
      onChange(teamMembers.map(m => m.id === memberId ? (data as TeamMember) : m));
    }
    setLinkingMemberId(null);
    setLinkSearch("");
    setLinkingInProgress(null);
  }

  async function openAddMember() {
    setAddingMember(true);
    if (peopleList.length > 0) return;
    const { ok, data } = await fetchJSON("/api/people/with-rates");
    if (ok) setPeopleList((data as { people: typeof peopleList }).people);
  }

  function selectPerson(p: typeof peopleList[0]) {
    setAddMemberForm({
      name: p.name,
      costPerHour: p.costPerHour != null ? String(p.costPerHour) : "",
      billingRate: p.billingRate != null ? String(p.billingRate) : "",
    });
    setPeopleSearch(p.name);
    setShowPeopleDrop(false);
  }

  async function submitAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!addMemberForm.name.trim()) return;
    setAddMemberSaving(true);
    const { ok, data } = await fetchJSON(`/api/projects/${projectId}/team`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: addMemberForm.name.trim(),
        costPerHour: addMemberForm.costPerHour ? parseFloat(addMemberForm.costPerHour) : null,
        billingRate: addMemberForm.billingRate ? parseFloat(addMemberForm.billingRate) : null,
        currency,
      }),
    });
    if (ok) {
      onChange([...teamMembers, data as TeamMember]);
      setAddMemberForm({ name: "", costPerHour: "", billingRate: "" });
      setPeopleSearch("");
      setAddingMember(false);
    }
    setAddMemberSaving(false);
  }

  // Monthly allocations (state lives in parent; editing/saving UI state is local)
  const [expandedAllocName, setExpandedAllocName] = useState<string | null>(null);
  const [savingAllocKey, setSavingAllocKey] = useState<string | null>(null);
  const [editingAllocKey, setEditingAllocKey] = useState<{ key: string; value: string } | null>(null);
  const [applyAllInput, setApplyAllInput] = useState("");
  const [applyAllSaving, setApplyAllSaving] = useState(false);

  // All months that have either a timesheet import OR an allocation record, sorted.
  // Including allocation months means future-month allocations (added before timesheets
  // exist) appear in the strip immediately after being set.
  const allMonths = useMemo(() => {
    const months = new Set(timesheets.map(t => t.month));
    for (const a of allocations) {
      // Expand multi-month allocations so every month in the range gets a card.
      let [sy, sm] = a.startDate.slice(0, 7).split("-").map(Number);
      const [ey, em] = a.endDate.slice(0, 7).split("-").map(Number);
      while (sy < ey || (sy === ey && sm <= em)) {
        months.add(`${sy}-${String(sm).padStart(2, "0")}`);
        sm++;
        if (sm > 12) { sm = 1; sy++; }
      }
    }
    return [...months].sort();
  }, [timesheets, allocations]);

  function getAlloc(memberName: string, month: string): number | null {
    const candidates = allocations.filter(a =>
      a.memberName.toLowerCase() === memberName.toLowerCase() &&
      month >= a.startDate.slice(0, 7) &&
      month <= a.endDate.slice(0, 7)
    );
    if (candidates.length === 0) {
      return teamMembers.find(m => m.name === memberName)?.allocationPercent ?? null;
    }
    // Prefer an exact single-month record over a spanning range, so a per-month
    // override from the project detail wins over a multi-month drawer allocation.
    const exact = candidates.find(a => a.startDate.slice(0, 7) === month && a.endDate.slice(0, 7) === month);
    return (exact ?? candidates[0]).allocationPercent;
  }

  async function saveMonthAlloc(memberName: string, month: string, rawValue: string) {
    const pct = Math.min(100, Math.max(1, parseInt(rawValue) || 100));
    const key = `${memberName}|${month}`;
    const { startDate, endDate } = monthToDateRange(month);
    setSavingAllocKey(key);
    setEditingAllocKey(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/allocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberName, startDate, endDate, allocationPercent: pct }),
      });
      if (res.ok) {
        const updated = await res.json() as MonthAllocation;
        onAllocationsChange(updated);
      }
    } finally {
      setSavingAllocKey(null);
    }
  }

  async function saveAllMonths(memberName: string, rawValue: string) {
    const pct = Math.min(100, Math.max(1, parseInt(rawValue) || 100));
    setApplyAllSaving(true);
    setApplyAllInput("");
    try {
      const results = await Promise.all(
        allMonths.map(month => {
          const { startDate, endDate } = monthToDateRange(month);
          return fetch(`/api/projects/${projectId}/allocations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ memberName, startDate, endDate, allocationPercent: pct }),
          }).then(r => r.ok ? r.json() as Promise<MonthAllocation> : null);
        })
      );
      for (const updated of results) {
        if (updated) onAllocationsChange(updated);
      }
    } finally {
      setApplyAllSaving(false);
    }
  }

  function formatMonth(ym: string) {
    const [y, m] = ym.split("-");
    return new Date(parseInt(y), parseInt(m) - 1, 1)
      .toLocaleDateString("en-AE", { month: "short", year: "2-digit" });
  }

  function startEdit(row: TeamRow) {
    setEditingName(row.name);
    setForm({
      costPerHour: row.member?.costPerHour?.toString() ?? "",
      billingRate: row.member?.billingRate?.toString() ?? "",
      allocationPercent: (row.member?.allocationPercent ?? 100).toString(),
    });
  }

  async function saveRow(name: string) {
    setSaving(true);
    const { ok, data } = await fetchJSON(`/api/projects/${projectId}/team`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        costPerHour: form.costPerHour ? parseFloat(form.costPerHour) : null,
        billingRate: form.billingRate ? parseFloat(form.billingRate) : null,
        currency,
        allocationPercent: form.allocationPercent ? parseFloat(form.allocationPercent) : 100,
      }),
    });
    if (ok) {
      const m = data as TeamMember;
      const exists = teamMembers.some(x => x.id === m.id);
      onChange(exists ? teamMembers.map(x => x.id === m.id ? m : x) : [...teamMembers, m]);
      setEditingName(null);
    } else {
      alert((data as { error?: string }).error ?? "Save failed");
    }
    setSaving(false);
  }

  async function hideMember(row: TeamRow) {
    setDeletingName(row.name);
    if (row.member) {
      // Mark existing record as hidden
      const { ok, data } = await fetchJSON(`/api/projects/${projectId}/team/${row.member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: true }),
      });
      if (ok) onChange(teamMembers.map(m => m.id === (data as TeamMember).id ? (data as TeamMember) : m));
    } else {
      // No rate record yet — create a hidden placeholder so buildTeam excludes this name
      const { ok, data } = await fetchJSON(`/api/projects/${projectId}/team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: row.name, costPerHour: null, billingRate: null, hidden: true }),
      });
      if (ok) onChange([...teamMembers, data as TeamMember]);
    }
    setDeletingName(null);
  }

  const totalHours = team.reduce((s, r) => s + r.totalHours, 0);
  const totalLaborCost = team.reduce((s, r) => {
    const cost = r.member?.costPerHour ?? 0;
    const converted = r.member ? convertRate(cost, r.member.currency, currency, fxRates) : 0;
    return s + r.totalHours * converted;
  }, 0);
  const totalBillable = team.reduce((s, r) => {
    const bill = r.member?.billingRate ?? 0;
    const converted = r.member ? convertRate(bill, r.member.currency, currency, fxRates) : 0;
    return s + r.totalHours * converted;
  }, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Team</h2>
          {team.length > 0 && (
            <p className="text-[10px] text-gray-400 mt-0.5">
              {team.length} member{team.length !== 1 ? "s" : ""} · {totalHours.toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs total
            </p>
          )}
        </div>
        {canWrite && !addingMember && (
          <button
            onClick={openAddMember}
            className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            Add member
          </button>
        )}
      </div>

      {addingMember && (
        <form onSubmit={submitAddMember} className="mb-4 p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-3 sm:col-span-1 relative">
              <label className="block text-[10px] font-medium text-gray-400 mb-1">Name <span className="text-red-400">*</span></label>
              <input
                value={peopleSearch || addMemberForm.name}
                onChange={e => {
                  const v = e.target.value;
                  setPeopleSearch(v);
                  setAddMemberForm(f => ({ ...f, name: v }));
                  setShowPeopleDrop(true);
                }}
                onFocus={() => setShowPeopleDrop(true)}
                onBlur={() => setTimeout(() => setShowPeopleDrop(false), 150)}
                required
                placeholder="Search people or type name…"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300 bg-white"
              />
              {showPeopleDrop && peopleList.length > 0 && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-44 overflow-y-auto">
                  {peopleList
                    .filter(p => !peopleSearch || p.name.toLowerCase().includes(peopleSearch.toLowerCase()))
                    .filter(p => !teamMembers.some(m => m.name === p.name))
                    .map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={() => selectPerson(p)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-indigo-50 transition-colors"
                      >
                        <span className="font-medium text-gray-800">{p.name}</span>
                        {p.jobTitle && <span className="text-gray-400 ml-1.5">· {p.jobTitle}</span>}
                        {p.costPerHour != null && (
                          <span className="text-gray-400 ml-1.5">· {p.rateCurrency ?? currency} {p.costPerHour}/hr</span>
                        )}
                      </button>
                    ))}
                  {peopleList.filter(p => !peopleSearch || p.name.toLowerCase().includes(peopleSearch.toLowerCase())).length === 0 && (
                    <p className="text-xs text-gray-400 px-3 py-2">No match — will be added as new member</p>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-400 mb-1">Cost/hr ({currency})</label>
              <input
                type="number" min="0" step="any" placeholder="0"
                value={addMemberForm.costPerHour}
                onChange={e => setAddMemberForm(f => ({ ...f, costPerHour: e.target.value }))}
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-400 mb-1">Bill rate ({currency})</label>
              <input
                type="number" min="0" step="any" placeholder="0"
                value={addMemberForm.billingRate}
                onChange={e => setAddMemberForm(f => ({ ...f, billingRate: e.target.value }))}
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => { setAddingMember(false); setAddMemberForm({ name: "", costPerHour: "", billingRate: "" }); setPeopleSearch(""); }} className="text-xs text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg">Cancel</button>
            <button type="submit" disabled={addMemberSaving || !addMemberForm.name.trim()} className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-1.5 rounded-lg">
              {addMemberSaving ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      )}

      {team.length === 0 && !addingMember && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center mb-2">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="8" cy="6" r="3" stroke="#9ca3af" strokeWidth="1.4"/><path d="M2 17c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="#9ca3af" strokeWidth="1.4" strokeLinecap="round"/><path d="M15 9a2 2 0 1 0 0-4M18 17c0-2.21-1.343-4-3-4" stroke="#9ca3af" strokeWidth="1.3" strokeLinecap="round"/></svg>
          </div>
          <p className="text-xs font-medium text-gray-500">No team members yet</p>
          {canWrite && <p className="text-[11px] text-gray-400 mt-0.5">Add members manually or import a timesheet.</p>}
        </div>
      )}

      {team.length > 0 && <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500">Member</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-500">Hours</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-500">Cost / hr ({currency})</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-500">Billing rate / hr ({currency})</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-500">Labor cost ({currency})</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-500">Billable ({currency})</th>
              {canWrite && <th className="w-20" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {team.map(row => {
              const isEditing = editingName === row.name;
              const memberCur = row.member?.currency ?? currency;
              const costConverted = row.member?.costPerHour != null
                ? convertRate(row.member.costPerHour, memberCur, currency, fxRates) : 0;
              const billConverted = row.member?.billingRate != null
                ? convertRate(row.member.billingRate, memberCur, currency, fxRates) : 0;
              const laborCost = row.totalHours * costConverted;
              const billable = row.totalHours * billConverted;
              const ratesDiffer = row.member != null && memberCur !== currency;
              const notInSystem = peopleList.length > 0 && !peopleNameSet.has(row.name.toLowerCase());
              return (
                <React.Fragment key={row.name}>
                <tr className={`hover:bg-gray-50 transition-colors ${deletingName === row.name ? "opacity-40" : ""}`}>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-gray-800">{row.name}</p>
                    {row.role && <p className="text-[10px] text-gray-400 mt-0.5">{row.role}</p>}
                    {/* Person link */}
                    {canWrite && row.member && (() => {
                      const mem = row.member;
                      const isLinking = linkingMemberId === mem.id;
                      if (mem.personId && mem.person) {
                        // Linked — show badge with unlink option
                        return (
                          <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">
                            <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            {mem.person.name}
                            <button
                              type="button"
                              onClick={() => linkMemberToPerson(mem.id, null)}
                              disabled={linkingInProgress === mem.id}
                              className="ml-0.5 text-emerald-400 hover:text-red-500 transition-colors"
                              title="Unlink from person"
                            >×</button>
                          </div>
                        );
                      }
                      // Not linked — show link button or picker
                      return (
                        <div className="mt-1 relative">
                          {!isLinking ? (
                            <button
                              type="button"
                              onClick={() => { setLinkingMemberId(mem.id); setLinkSearch(""); }}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 rounded-full px-1.5 py-0.5 transition-colors"
                            >
                              <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M10 6H6a4 4 0 0 0 0 8h1M6 10h4a4 4 0 0 0 0-8H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                              Link to person
                            </button>
                          ) : (
                            <div className="bg-white border border-indigo-200 rounded-lg shadow-lg p-2 w-52 z-20 absolute top-0 left-0">
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] font-semibold text-gray-500">Link to person</span>
                                <button type="button" onClick={() => setLinkingMemberId(null)} className="text-gray-400 hover:text-gray-600 text-xs leading-none">×</button>
                              </div>
                              <input
                                autoFocus
                                type="text"
                                value={linkSearch}
                                onChange={e => setLinkSearch(e.target.value)}
                                placeholder="Search people…"
                                className="w-full h-6 px-2 text-xs border border-gray-200 rounded outline-none focus:ring-1 focus:ring-indigo-200 mb-1"
                              />
                              <div className="max-h-28 overflow-y-auto">
                                {peopleList
                                  .filter(p => !linkSearch || p.name.toLowerCase().includes(linkSearch.toLowerCase()))
                                  .map(p => (
                                    <button
                                      key={p.id}
                                      type="button"
                                      onClick={() => linkMemberToPerson(mem.id, p.id)}
                                      disabled={linkingInProgress === mem.id}
                                      className="w-full text-left px-2 py-1 text-xs hover:bg-indigo-50 rounded transition-colors"
                                    >
                                      <span className="font-medium text-gray-800">{p.name}</span>
                                      {p.jobTitle && <span className="text-gray-400 ml-1">· {p.jobTitle}</span>}
                                    </button>
                                  ))}
                                {peopleList.filter(p => !linkSearch || p.name.toLowerCase().includes(linkSearch.toLowerCase())).length === 0 && (
                                  <p className="text-xs text-gray-400 px-2 py-1">No match</p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {notInSystem && !row.member?.personId && canWrite && (
                      <button
                        onClick={() => setAddToSystemName(row.name)}
                        className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-full px-1.5 py-0.5 transition-colors"
                        title="Not in the People directory — click to add"
                      >
                        <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                          <path d="M5 1L9 8.5H1L5 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                          <path d="M5 4.5v1.5M5 7h.01" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                        </svg>
                        Not hired · Add to employees
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                    {row.totalHours.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </td>

                  {isEditing ? (
                    <>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-[10px] text-gray-400 shrink-0">{currency}</span>
                          <input
                            type="number" min="0" step="any" placeholder="0"
                            value={form.costPerHour}
                            onChange={e => setForm(f => ({ ...f, costPerHour: e.target.value }))}
                            className="w-20 text-xs text-right border border-indigo-300 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-[10px] text-gray-400 shrink-0">{currency}</span>
                          <input
                            type="number" min="0" step="any" placeholder="0"
                            value={form.billingRate}
                            onChange={e => setForm(f => ({ ...f, billingRate: e.target.value }))}
                            className="w-20 text-xs text-right border border-indigo-300 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-400">—</td>
                      <td className="px-3 py-2.5 text-right text-gray-400">—</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => saveRow(row.name)}
                            disabled={saving}
                            className="text-[10px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-2.5 py-1 rounded-lg transition-colors"
                          >
                            {saving ? "…" : "Save"}
                          </button>
                          <button
                            onClick={() => setEditingName(null)}
                            disabled={saving}
                            className="text-[10px] text-gray-400 hover:text-gray-600 px-1.5 py-1 rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                        {costConverted > 0 ? (
                          <span>
                            {fmtRate(costConverted, currency)}
                            {ratesDiffer && <span className="block text-[10px] text-gray-400">{fmtRate(row.member!.costPerHour!, memberCur)}</span>}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                        {billConverted > 0 ? (
                          <span>
                            {fmtRate(billConverted, currency)}
                            {ratesDiffer && <span className="block text-[10px] text-gray-400">{fmtRate(row.member!.billingRate!, memberCur)}</span>}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-gray-800">
                        {laborCost > 0 ? fmt(laborCost, currency) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-indigo-700">
                        {billable > 0 ? fmt(billable, currency) : <span className="text-gray-300">—</span>}
                      </td>
                      {canWrite && (
                        <td className="px-3 py-2">
                          {confirmDeleteName === row.name ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-[10px] text-gray-500">Remove?</span>
                              <button
                                onClick={async () => {
                                  setConfirmDeleteName(null);
                                  await hideMember(row);
                                }}
                                disabled={deletingName === row.name}
                                className="text-[10px] font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 px-2 py-0.5 rounded-md transition-colors"
                              >
                                {deletingName === row.name ? "…" : "Yes"}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteName(null)}
                                className="text-[10px] text-gray-400 hover:text-gray-700 px-1 py-0.5 rounded-md transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              {allMonths.length > 0 && (
                                <button
                                  onClick={() => setExpandedAllocName(n => n === row.name ? null : row.name)}
                                  className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${expandedAllocName === row.name ? "bg-indigo-100 text-indigo-700" : "text-gray-300 hover:text-indigo-500 hover:bg-indigo-50"}`}
                                  title="Set monthly allocations"
                                >
                                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/><rect x="7" y="1" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="7" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/><rect x="7" y="7" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/></svg>
                                  Alloc
                                </button>
                              )}
                              <button
                                onClick={() => startEdit(row)}
                                className="p-1 text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-md transition-colors"
                                title="Edit rates"
                              >
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5a1.414 1.414 0 0 1 2 2L3.5 10.5l-3 .5.5-3 7.5-7.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              </button>
                              <button
                                onClick={() => setConfirmDeleteName(row.name)}
                                className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                                title="Remove from team"
                              >
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M5 3V2.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5V3M9.5 3l-.6 6.7a.5.5 0 0 1-.5.3H3.6a.5.5 0 0 1-.5-.3L2.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </>
                  )}
                </tr>

                {/* ── Monthly allocation strip ── */}
                {expandedAllocName === row.name && allMonths.length > 0 && (
                  <tr>
                    <td colSpan={canWrite ? 7 : 6} className="px-3 pb-3 pt-0">
                      <div className="bg-indigo-50/60 rounded-xl p-3 border border-indigo-100">
                        <div className="flex items-center justify-between mb-2.5">
                          <p className="text-[10px] font-semibold text-indigo-600">
                            Monthly allocation — {row.name}
                            <span className="font-normal text-indigo-400 ml-1">(% of 160h/mo capacity)</span>
                          </p>
                          {canWrite && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-indigo-400">Set all months:</span>
                              <input
                                type="number" min="1" max="100" step="1"
                                value={applyAllInput}
                                onChange={e => setApplyAllInput(e.target.value)}
                                placeholder="100"
                                disabled={applyAllSaving}
                                className="w-14 text-xs text-center border border-indigo-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                              />
                              <span className="text-[10px] text-indigo-400">%</span>
                              <button
                                onClick={() => applyAllInput && saveAllMonths(row.name, applyAllInput)}
                                disabled={!applyAllInput || applyAllSaving}
                                className="text-[10px] font-semibold text-white bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 px-2.5 py-1 rounded-lg transition-colors"
                              >
                                {applyAllSaving ? "Saving…" : "Apply all"}
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {allMonths.map(month => {
                            const cellKey = `${row.name}|${month}`;
                            const alloc = getAlloc(row.name, month); // null = no allocation this month
                            const isEditingThis = editingAllocKey?.key === cellKey;
                            const isSaving = savingAllocKey === cellKey;
                            const capacity = alloc != null ? Math.round(160 * alloc / 100) : null;

                            // Find actual hours for this member+month
                            const ts = timesheets.find(t => t.month === month);
                            const hours = ts?.entries
                              .filter(e => e.employeeName === row.name)
                              .reduce((s, e) => s + e.hoursLogged, 0) ?? 0;
                            const utilPct = capacity != null && capacity > 0 && hours > 0
                              ? Math.round((hours / capacity) * 100) : null;

                            const utilCls = utilPct == null ? "text-indigo-300"
                              : utilPct > 100 ? "text-red-500"
                              : utilPct >= 80 ? "text-green-600"
                              : "text-amber-500";

                            const notAllocated = alloc == null;

                            return (
                              <div
                                key={month}
                                className={`flex flex-col items-center rounded-lg border px-3 py-2 min-w-[72px] shadow-sm ${notAllocated ? "bg-gray-50 border-gray-100" : "bg-white border-indigo-100"}`}
                              >
                                <span className="text-[10px] font-semibold text-gray-500 mb-1">
                                  {formatMonth(month)}
                                </span>

                                {/* Allocation input */}
                                {isEditingThis ? (
                                  <input
                                    type="number" min="1" max="100" step="1"
                                    autoFocus
                                    value={editingAllocKey!.value}
                                    onChange={e => setEditingAllocKey({ key: cellKey, value: e.target.value })}
                                    onBlur={() => saveMonthAlloc(row.name, month, editingAllocKey!.value)}
                                    onKeyDown={e => {
                                      if (e.key === "Enter") saveMonthAlloc(row.name, month, editingAllocKey!.value);
                                      if (e.key === "Escape") setEditingAllocKey(null);
                                    }}
                                    className="w-12 text-sm font-bold text-center text-indigo-700 border border-indigo-300 rounded-lg px-1 py-0.5 outline-none focus:ring-1 focus:ring-indigo-400 bg-indigo-50"
                                    disabled={isSaving}
                                  />
                                ) : notAllocated ? (
                                  <button
                                    onClick={() => canWrite && setEditingAllocKey({ key: cellKey, value: "100" })}
                                    disabled={!canWrite}
                                    className={`text-sm font-bold text-gray-300 transition-colors ${canWrite ? "hover:text-indigo-400 cursor-pointer" : "cursor-default"}`}
                                    title={canWrite ? "No allocation — click to set" : "No allocation set"}
                                  >
                                    —
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => canWrite && setEditingAllocKey({ key: cellKey, value: String(alloc) })}
                                    disabled={isSaving || !canWrite}
                                    className={`text-sm font-bold text-indigo-700 hover:text-indigo-900 transition-colors ${canWrite ? "cursor-pointer" : "cursor-default"}`}
                                    title={canWrite ? "Click to edit" : undefined}
                                  >
                                    {isSaving ? "…" : `${alloc}%`}
                                  </button>
                                )}

                                {capacity != null && (
                                  <span className="text-[9px] text-gray-400 mt-0.5">{capacity}h cap</span>
                                )}

                                {/* Utilization */}
                                {utilPct != null && (
                                  <span className={`text-[9px] font-bold mt-0.5 ${utilCls}`}>
                                    {utilPct}% used
                                  </span>
                                )}
                                {hours > 0 && (
                                  <span className="text-[9px] text-gray-400">{+hours.toFixed(2)}h logged</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
            })}
          </tbody>
          {team.length > 1 && (
            <tfoot>
              <tr className="bg-gray-50 font-semibold border-t border-gray-200">
                <td className="px-3 py-2 text-gray-700">Total</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                  {totalHours.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                </td>
                <td />{/* Cost / hr */}
                <td />{/* Billing rate / hr */}
                <td className="px-3 py-2 text-right tabular-nums text-gray-800">
                  {totalLaborCost > 0 ? fmt(totalLaborCost, currency) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-indigo-700">
                  {totalBillable > 0 ? fmt(totalBillable, currency) : "—"}
                </td>
                {canWrite && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>}

      {/* Add to employees modal — opens prefilled when a team member isn't found in People */}
      <AddPersonModal
        controlledOpen={addToSystemName !== null}
        prefillName={addToSystemName ?? ""}
        onClose={() => setAddToSystemName(null)}
        onCreated={() => {
          // Mark the member as now in system locally so the badge disappears
          if (addToSystemName) {
            setPeopleList(prev => [...prev, { id: "", name: addToSystemName, costPerHour: null, billingRate: null, rateCurrency: null, jobTitle: null }]);
          }
          setAddToSystemName(null);
        }}
      />
    </div>
  );
}

// ─── milestones section ───────────────────────────────────────────────────────

function MilestonesSection({
  projectId, milestones, allEntries, teamMembers, contractValue, currency, canWrite,
  fxRates = {}, onChange, clientDocs = [], clientName, refetchClientDocs, projectStartDate,
}: {
  projectId: string; milestones: Milestone[]; allEntries: TimesheetEntry[];
  teamMembers: TeamMember[]; contractValue: number | null; currency: string;
  canWrite: boolean; fxRates?: Record<string, number>; onChange: (ms: Milestone[]) => void;
  clientDocs?: ClientDocument[];
  clientName?: string | null;
  refetchClientDocs?: () => void;
  projectStartDate?: string | null;
}) {
  const rateByName = new Map(teamMembers.map(m => [m.name, m]));
  const entryStats = allEntries.reduce((acc, e) => {
    if (!e.milestoneId) return acc;
    if (!acc[e.milestoneId]) acc[e.milestoneId] = { hours: 0, cost: 0, billable: 0 };
    const member = rateByName.get(e.employeeName);
    const memberCur = member?.currency ?? currency;
    const costRate = member?.costPerHour != null
      ? convertRate(member.costPerHour, memberCur, currency, fxRates)
      : (e.hourlyRate ?? 0);
    const billRate = member?.billingRate != null
      ? convertRate(member.billingRate, memberCur, currency, fxRates)
      : 0;
    acc[e.milestoneId].hours    += e.hoursLogged;
    acc[e.milestoneId].cost     += e.hoursLogged * costRate;
    acc[e.milestoneId].billable += e.hoursLogged * billRate;
    return acc;
  }, {} as Record<string, { hours: number; cost: number; billable: number }>);
  const [milestoneView, setMilestoneView] = useState<"list" | "gantt">("list");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", dueDate: "", billingAmount: "", billingPercent: "", tasks: [] as MilestoneTask[] });
  const [saving, setSaving] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [addInvoice, setAddInvoice] = useState<Milestone | null>(null);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "", startDate: "", dueDate: "", billingAmount: "", billingPercent: "", completionPercent: "", estimatedHours: "", tasks: [] as MilestoneTask[] });
  const [savingEdit, setSavingEdit] = useState(false);
  const [shiftPrompt, setShiftPrompt] = useState<{ deltaDays: number; subsequent: Milestone[] } | null>(null);
  const [shifting, setShifting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedWithDiff[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importingRows, setImportingRows] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pctEditing, setPctEditing] = useState<Record<string, string>>({});
  const [pctSaving, setPctSaving] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [taskEditing, setTaskEditing] = useState<{ milestoneId: string; taskIndex: number; value: string } | null>(null);
  const [taskSaving, setTaskSaving] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  function normName(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  }

  function matchScore(a: string, b: string): number {
    const na = normName(a); const nb = normName(b);
    if (na === nb) return 1;
    const wa = na.split(" ").filter(w => w.length >= 3);
    const wb = nb.split(" ").filter(w => w.length >= 3);
    if (!wa.length || !wb.length) return 0;
    const overlap = wa.filter(w => wb.includes(w)).length;
    return overlap / Math.max(wa.length, wb.length);
  }

  async function runExtract(file: File) {
    setImporting(true);
    const fd = new FormData();
    fd.append("file", file);
    const { ok, data } = await fetchJSON(`/api/projects/${projectId}/milestones/extract`, { method: "POST", body: fd });
    if (ok) {
      const rawMilestones = (data as { milestones: ExtractedMilestone[] }).milestones;
      // Auto-sum activity hours to milestone level (overrides AI's milestone total)
      const raw = rawMilestones.map(m => {
        const hasActHours = m.activities?.some(a => a.estimatedHours != null);
        if (!hasActHours) return { ...m, startDate: m.startDate ?? null };
        const sum = m.activities!.reduce((s, a) => s + (a.estimatedHours ?? 0), 0);
        return { ...m, estimatedHours: sum, startDate: m.startDate ?? null };
      });
      const usedIds = new Set<string>();
      const withDiff: ExtractedWithDiff[] = raw.map(ex => {
        if (milestones.length === 0) return { ...ex, _diffKind: "new" as const };
        let best: { m: Milestone; score: number } | null = null;
        for (const m of milestones) {
          if (usedIds.has(m.id)) continue;
          const s = matchScore(ex.name, m.name);
          if (s >= 0.45 && (!best || s > best.score)) best = { m, score: s };
        }
        if (!best) return { ...ex, _diffKind: "new" as const };
        usedIds.add(best.m.id);
        const changes: DiffChange[] = [];
        const existingDue = best.m.dueDate ? best.m.dueDate.split("T")[0] : null;
        if (ex.dueDate !== existingDue) changes.push({ field: "Due date", from: existingDue, to: ex.dueDate });
        if (ex.billingAmount !== best.m.billingAmount) changes.push({ field: "Billing", from: best.m.billingAmount, to: ex.billingAmount });
        const existingPct = best.m.completionPercent ?? 0;
        if (ex.completionPercent != null && ex.completionPercent !== existingPct) changes.push({ field: "Completion", from: existingPct, to: ex.completionPercent });
        if (changes.length === 0) return { ...ex, _diffKind: "unchanged" as const, _matchedId: best.m.id };
        return { ...ex, _diffKind: "update" as const, _matchedId: best.m.id, _changes: changes };
      });
      setExtracted(withDiff);
      // pre-select new and update items; skip unchanged
      setSelected(new Set(withDiff.map((m, i) => m._diffKind !== "unchanged" ? i : -1).filter(i => i >= 0)));
    } else {
      const msg = (data as { error?: string }).error ?? "Extraction failed";
      alert(msg);
    }
    setImporting(false);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    runExtract(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) runExtract(file);
  }

  function updateExtracted(i: number, key: keyof ExtractedMilestone, value: string) {
    setExtracted(prev => prev ? prev.map((m, idx) => idx === i ? { ...m, [key]: value || null } : m) : prev);
  }

  async function importSelected() {
    if (!extracted) return;
    setImportingRows(true);
    const toImport = extracted.filter((_, i) => selected.has(i));
    let firstError: string | null = null;
    let failures = 0;
    for (const m of toImport) {
      const tasksJson = m.activities && m.activities.length > 0 ? JSON.stringify(m.activities) : null;
      // Derive milestone completion from activities when present; fall back to extractor value
      const effectivePct = m.activities && m.activities.length > 0
        ? Math.round(m.activities.reduce((s, a) => s + (a.completionPercent ?? 0), 0) / m.activities.length)
        : (m.completionPercent ?? 0);
      if (m._diffKind === "update" && m._matchedId) {
        const { ok, data } = await fetchJSON(`/api/projects/${projectId}/milestones/${m._matchedId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: m.name, description: m.description || null,
            startDate: m.startDate || null, dueDate: m.dueDate || null,
            billingAmount: m.billingAmount ?? null, estimatedHours: m.estimatedHours ?? null,
            tasks: tasksJson, completionPercent: effectivePct,
          }),
        });
        if (!ok) { failures++; if (!firstError) firstError = (data as { error?: string }).error ?? "Unknown error"; }
      } else if (m._diffKind === "new") {
        const { ok, data } = await fetchJSON(`/api/projects/${projectId}/milestones`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: m.name, description: m.description || null,
            startDate: m.startDate || null, dueDate: m.dueDate || null,
            billingAmount: m.billingAmount ?? null, estimatedHours: m.estimatedHours ?? null,
            tasks: tasksJson, completionPercent: effectivePct,
          }),
        });
        if (!ok) { failures++; if (!firstError) firstError = (data as { error?: string }).error ?? "Unknown error"; }
      }
    }
    // Re-fetch milestones from server to ensure the list reflects actual DB state
    const { ok: refetchOk, data: refetchData } = await fetchJSON(`/api/projects/${projectId}/milestones`);
    if (refetchOk) {
      const fresh = (refetchData as Array<Milestone & { invoices: unknown[] }>).map(m => ({
        ...m,
        dueDate: m.dueDate ?? null,
        completedAt: m.completedAt ?? null,
        invoices: (m.invoices ?? []) as Milestone["invoices"],
      }));
      onChange(fresh);
    }
    setExtracted(null);
    setSelected(new Set());
    setImportingRows(false);
    if (failures > 0) {
      alert(`${failures} milestone${failures !== 1 ? "s" : ""} could not be saved.\nError: ${firstError}`);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const setEf = (k: keyof typeof editForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setEditForm(f => ({ ...f, [k]: e.target.value }));

  function startEditMilestone(m: Milestone) {
    setEditingId(m.id);
    const parsedTasks: MilestoneTask[] = m.tasks ? (() => { try { return JSON.parse(m.tasks); } catch { return []; } })() : [];
    setEditForm({
      name: m.name,
      description: m.description ?? "",
      startDate: m.startDate ? m.startDate.split("T")[0] : "",
      dueDate: m.dueDate ? m.dueDate.split("T")[0] : "",
      billingAmount: m.billingAmount?.toString() ?? "",
      billingPercent: m.billingPercent?.toString() ?? "",
      completionPercent: (m.completionPercent ?? 0).toString(),
      estimatedHours: m.estimatedHours?.toString() ?? "",
      tasks: parsedTasks,
    });
  }

  async function saveEditMilestone(m: Milestone) {
    setSavingEdit(true);
    const taskHoursSum = editForm.tasks.some(t => t.estimatedHours != null)
      ? editForm.tasks.reduce((s, t) => s + (t.estimatedHours ?? 0), 0)
      : null;
    const estimatedHoursToSave = taskHoursSum ?? (editForm.estimatedHours !== "" ? parseFloat(editForm.estimatedHours) : null);
    // If any task has a completion %, derive the milestone % as the average of all tasks.
    const tasksWithPct = editForm.tasks.filter(t => t.completionPercent != null);
    const derivedPct = tasksWithPct.length > 0
      ? Math.round(editForm.tasks.reduce((s, t) => s + (t.completionPercent ?? 0), 0) / editForm.tasks.length)
      : editForm.completionPercent !== "" ? parseFloat(editForm.completionPercent) : null;
    const { ok, data } = await fetchJSON(`/api/projects/${projectId}/milestones/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editForm.name,
        description: editForm.description || null,
        startDate: editForm.startDate || null,
        dueDate: editForm.dueDate || null,
        billingAmount: editForm.billingAmount || null,
        billingPercent: editForm.billingPercent || null,
        completionPercent: derivedPct,
        estimatedHours: estimatedHoursToSave,
        tasks: editForm.tasks.length > 0 ? JSON.stringify(editForm.tasks) : null,
      }),
    });
    if (ok) {
      const updated = data as Milestone & { invoices: MilestoneInvoice[] };
      const nextMilestones = milestones.map(x => x.id === m.id ? { ...x, ...updated } : x);
      onChange(nextMilestones);
      setEditingId(null);

      const oldDate = m.dueDate ? new Date(m.dueDate) : null;
      const newDate = editForm.dueDate ? new Date(editForm.dueDate) : null;
      if (oldDate && newDate) {
        const deltaDays = Math.round((newDate.getTime() - oldDate.getTime()) / 86_400_000);
        if (deltaDays !== 0) {
          const subsequent = nextMilestones
            .filter(x => x.id !== m.id && x.order > m.order && x.dueDate)
            .sort((a, b) => a.order - b.order);
          if (subsequent.length > 0) setShiftPrompt({ deltaDays, subsequent });
        }
      }
    } else {
      alert((data as { error?: string }).error ?? "Save failed");
    }
    setSavingEdit(false);
  }

  async function applyShift() {
    if (!shiftPrompt) return;
    setShifting(true);
    const updated: Milestone[] = [];
    for (const m of shiftPrompt.subsequent) {
      const newDate = new Date(m.dueDate!);
      newDate.setDate(newDate.getDate() + shiftPrompt.deltaDays);
      const iso = newDate.toISOString().split("T")[0];
      const { ok, data } = await fetchJSON(`/api/projects/${projectId}/milestones/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueDate: iso }),
      });
      if (ok) updated.push({ ...m, dueDate: (data as Milestone).dueDate });
    }
    onChange(milestones.map(m => updated.find(u => u.id === m.id) ?? m));
    setShiftPrompt(null);
    setShifting(false);
  }

  async function submitMilestone(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const tasksJson = form.tasks.length > 0 ? JSON.stringify(form.tasks) : null;
    const taskHours = form.tasks.some(t => t.estimatedHours != null)
      ? form.tasks.reduce((s, t) => s + (t.estimatedHours ?? 0), 0)
      : null;
    const taskPct = form.tasks.some(t => t.completionPercent != null)
      ? Math.round(form.tasks.reduce((s, t) => s + (t.completionPercent ?? 0), 0) / form.tasks.length)
      : null;
    const { ok, data } = await fetchJSON(`/api/projects/${projectId}/milestones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        billingAmount: form.billingAmount || null,
        billingPercent: form.billingPercent || null,
        tasks: tasksJson,
        estimatedHours: taskHours,
        completionPercent: taskPct,
      }),
    });
    if (ok) {
      onChange([...milestones, { ...(data as Milestone), invoices: [] }]);
      setForm({ name: "", description: "", dueDate: "", billingAmount: "", billingPercent: "", tasks: [] });
      setShowAdd(false);
    } else {
      alert((data as { error?: string }).error ?? "Failed to add milestone");
    }
    setSaving(false);
  }

  async function toggleComplete(m: Milestone) {
    setCompletingId(m.id);
    const completedAt = m.completedAt ? null : new Date().toISOString();
    const { ok, data } = await fetchJSON(`/api/projects/${projectId}/milestones/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completedAt }),
    });
    if (ok) onChange(milestones.map(x => x.id === m.id ? { ...x, completedAt: (data as Milestone).completedAt } : x));
    setCompletingId(null);
  }

  async function savePct(m: Milestone, raw: string) {
    const pct = Math.min(100, Math.max(0, parseFloat(raw) || 0));
    setPctSaving(prev => new Set([...prev, m.id]));
    const { ok, data } = await fetchJSON(`/api/projects/${projectId}/milestones/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completionPercent: pct }),
    });
    if (ok) {
      const updated = data as Milestone & { invoices: Milestone["invoices"] };
      onChange(milestones.map(x => x.id === m.id ? { ...x, completionPercent: updated.completionPercent, completedAt: updated.completedAt } : x));
    }
    setPctEditing(prev => { const n = { ...prev }; delete n[m.id]; return n; });
    setPctSaving(prev => { const s = new Set(prev); s.delete(m.id); return s; });
  }

  async function saveTaskPct(m: Milestone, taskIndex: number, raw: string) {
    const pct = Math.min(100, Math.max(0, parseFloat(raw) || 0));
    setTaskSaving(true);
    let taskList: MilestoneTask[] = [];
    try { if (m.tasks) taskList = JSON.parse(m.tasks); } catch { /* ignore */ }
    taskList = taskList.map((t, i) => i === taskIndex ? { ...t, completionPercent: pct } : t);
    const newTasksJson = JSON.stringify(taskList);
    // Recalculate milestone completion as average of all task percents
    const avgPct = Math.round(taskList.reduce((s, t) => s + (t.completionPercent ?? 0), 0) / taskList.length);
    const { ok, data } = await fetchJSON(`/api/projects/${projectId}/milestones/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: newTasksJson, completionPercent: avgPct }),
    });
    if (ok) {
      const updated = data as Milestone & { invoices: Milestone["invoices"] };
      onChange(milestones.map(x => x.id === m.id ? { ...x, tasks: newTasksJson, completionPercent: updated.completionPercent, completedAt: updated.completedAt } : x));
    }
    setTaskEditing(null);
    setTaskSaving(false);
  }

  async function deleteProjectInvoice(milestoneId: string, invoiceId: string) {
    setDeletingInvoiceId(invoiceId);
    const { ok } = await fetchJSON(`/api/projects/${projectId}/invoices/${invoiceId}`, { method: "DELETE" });
    if (ok) {
      onChange(milestones.map(m =>
        m.id === milestoneId ? { ...m, invoices: m.invoices.filter(i => i.id !== invoiceId) } : m
      ));
    }
    setDeletingInvoiceId(null);
  }

  async function deleteMilestone(id: string) {
    setDeletingId(id);
    await fetchJSON(`/api/projects/${projectId}/milestones/${id}`, { method: "DELETE" });
    onChange(milestones.filter(m => m.id !== id));
    setDeletingId(null);
    setConfirmDelete(null);
  }

  async function deleteAllMilestones() {
    setDeletingAll(true);
    await Promise.all(milestones.map(m =>
      fetchJSON(`/api/projects/${projectId}/milestones/${m.id}`, { method: "DELETE" })
    ));
    onChange([]);
    setDeletingAll(false);
    setConfirmDeleteAll(false);
  }

  // Budget allocation helpers
  const totalAllocated = milestones.reduce((s, m) => s + (m.billingAmount ?? 0), 0);
  const addBillingValue = parseFloat(form.billingAmount) || 0;
  const addRemaining = contractValue != null ? contractValue - totalAllocated : null;
  const addOverBudget = addRemaining != null && addBillingValue > 0 && addBillingValue > addRemaining;

  return (
    <div
      className={`relative bg-white rounded-xl border p-4 transition-colors ${isDragging ? "border-indigo-400 bg-indigo-50/30" : "border-gray-200"}`}
      onDragOver={canWrite ? e => { e.preventDefault(); setIsDragging(true); } : undefined}
      onDragLeave={canWrite ? () => setIsDragging(false) : undefined}
      onDrop={canWrite ? handleDrop : undefined}
    >
      {isDragging && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl pointer-events-none z-10">
          <p className="text-xs font-semibold text-indigo-600 bg-white/90 px-3 py-1.5 rounded-lg border border-indigo-200 shadow-sm">
            Drop to extract milestones
          </p>
        </div>
      )}
      <SectionHeader
        title="Milestones"
        action={canWrite ? (
          <div className="flex items-center gap-3">
            <button
              onClick={() => importFileRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-indigo-600 disabled:opacity-40 transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v6M2 7.5l3.5 2.5 3.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M1 9.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              {importing ? "Extracting…" : "Import from plan"}
            </button>
            <input ref={importFileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" hidden onChange={handleImportFile} />
            {milestones.length > 0 && (
              <>
                {/* List / Gantt toggle */}
                <span className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => setMilestoneView("list")}
                    className={`px-2 py-1 text-[11px] font-semibold transition-colors ${milestoneView === "list" ? "bg-indigo-50 text-indigo-600" : "bg-white text-gray-400 hover:text-gray-600"}`}
                    title="List view"
                  >
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <path d="M2 3.5h10M2 7h10M2 10.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => setMilestoneView("gantt")}
                    className={`px-2 py-1 text-[11px] font-semibold transition-colors border-l border-gray-200 ${milestoneView === "gantt" ? "bg-indigo-50 text-indigo-600" : "bg-white text-gray-400 hover:text-gray-600"}`}
                    title="Gantt view"
                  >
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <rect x="1" y="2" width="7" height="2.5" rx="1" fill="currentColor"/>
                      <rect x="4" y="5.75" width="8" height="2.5" rx="1" fill="currentColor"/>
                      <rect x="2" y="9.5" width="5" height="2.5" rx="1" fill="currentColor"/>
                    </svg>
                  </button>
                </span>
                <button
                  onClick={() => setConfirmDeleteAll(true)}
                  className="text-xs font-semibold text-gray-400 hover:text-red-500 transition-colors"
                >
                  Delete all
                </button>
              </>
            )}
            <AddBtn onClick={() => setShowAdd(s => !s)} label="Add milestone" />
          </div>
        ) : undefined}
      />

      {shiftPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => !shifting && setShiftPrompt(null)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
              <div className="mt-0.5 w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v5l3 2" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><circle cx="7" cy="7" r="5.5" stroke="#d97706" strokeWidth="1.5" /></svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Shift upcoming milestones?</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Due date moved{" "}
                  <span className="font-semibold text-amber-600">
                    {shiftPrompt.deltaDays > 0 ? "+" : ""}{shiftPrompt.deltaDays} day{Math.abs(shiftPrompt.deltaDays) !== 1 ? "s" : ""}
                  </span>
                  . Apply the same shift to the {shiftPrompt.subsequent.length} milestone{shiftPrompt.subsequent.length !== 1 ? "s" : ""} that follow?
                </p>
              </div>
            </div>
            <ul className="px-5 py-3 space-y-1.5 max-h-48 overflow-y-auto">
              {shiftPrompt.subsequent.map((m, i) => (
                <li key={m.id} className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="w-4 h-4 rounded-full bg-gray-100 text-[9px] font-bold text-gray-400 flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="flex-1 truncate">{m.name}</span>
                  <span className="text-gray-400 shrink-0">{fmtDate(m.dueDate)} → {fmtDate(new Date(new Date(m.dueDate!).getTime() + shiftPrompt.deltaDays * 86400000).toISOString())}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => setShiftPrompt(null)}
                disabled={shifting}
                className="text-sm font-medium text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg transition-colors"
              >
                Keep as is
              </button>
              <button
                onClick={applyShift}
                disabled={shifting}
                className="text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 px-5 py-2 rounded-lg transition-colors"
              >
                {shifting ? "Shifting…" : "Shift milestones"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => !deletingAll && setConfirmDeleteAll(false)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
              <div className="mt-0.5 w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 4v4M7 10h.01" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" /><circle cx="7" cy="7" r="5.5" stroke="#dc2626" strokeWidth="1.5" /></svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Delete all milestones?</p>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  You are about to permanently delete all <span className="font-semibold text-red-600">{milestones.length} milestone{milestones.length !== 1 ? "s" : ""}</span>. This will also remove all associated timesheet assignments and invoice links. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="px-5 py-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteAll(false)}
                disabled={deletingAll}
                className="text-sm font-medium text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={deleteAllMilestones}
                disabled={deletingAll}
                className="text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 px-5 py-2 rounded-lg transition-colors"
              >
                {deletingAll ? "Deleting…" : "Delete all"}
              </button>
            </div>
          </div>
        </div>
      )}

      {importing && (
        <div className="mb-4 flex items-center gap-2 text-xs text-indigo-600 p-3 bg-indigo-50/60 rounded-xl border border-indigo-100">
          <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" /><path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          Extracting milestones from document…
        </div>
      )}

      {extracted && (() => {
        const hasDiff = milestones.length > 0;
        const newCount = extracted.filter(m => m._diffKind === "new").length;
        const updateCount = extracted.filter(m => m._diffKind === "update").length;
        const unchangedCount = extracted.filter(m => m._diffKind === "unchanged").length;
        const actionableCount = extracted.filter((_, i) => extracted[i]._diffKind !== "unchanged").length;
        const headerText = hasDiff
          ? `${newCount > 0 ? `${newCount} new` : ""}${newCount > 0 && updateCount > 0 ? ", " : ""}${updateCount > 0 ? `${updateCount} updated` : ""}${unchangedCount > 0 ? `, ${unchangedCount} unchanged` : ""} — select what to apply:`
          : `${extracted.length} milestone${extracted.length !== 1 ? "s" : ""} found — select which to import:`;
        return (
          <div className="mb-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-700">{headerText}</p>
              <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.size === actionableCount && actionableCount > 0}
                  onChange={e => setSelected(e.target.checked
                    ? new Set(extracted.map((m, i) => m._diffKind !== "unchanged" ? i : -1).filter(i => i >= 0))
                    : new Set()
                  )}
                  className="rounded"
                />
                Select all
              </label>
            </div>
            <div className="rounded-xl border border-gray-200 overflow-x-auto">
              <table className="w-full text-xs" style={{ minWidth: 780 }}>
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="w-8 px-2 py-2 shrink-0" />
                    {hasDiff && <th className="w-16 px-2 py-2 shrink-0" />}
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500">Milestone</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 w-20">Est. hrs</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 w-32">Start date</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 w-32">Due date</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 w-28">Billing ({currency})</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 w-16">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {extracted.map((m, i) => {
                    const isUnchanged = m._diffKind === "unchanged";
                    const rowBg = isUnchanged
                      ? "bg-gray-50/60 opacity-40"
                      : selected.has(i)
                        ? m._diffKind === "update" ? "bg-amber-50/40" : "bg-green-50/30"
                        : "bg-gray-50/60 opacity-50";
                    return (
                      <tr key={i} className={rowBg}>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={selected.has(i)}
                            disabled={isUnchanged}
                            onChange={e => setSelected(prev => { const s = new Set(prev); e.target.checked ? s.add(i) : s.delete(i); return s; })}
                            className="rounded"
                          />
                        </td>
                        {hasDiff && (
                          <td className="px-2 py-2">
                            {m._diffKind === "new" && (
                              <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">NEW</span>
                            )}
                            {m._diffKind === "update" && (
                              <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">UPDATE</span>
                            )}
                            {m._diffKind === "unchanged" && (
                              <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">SAME</span>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2">
                          <input
                            value={m.name}
                            onChange={e => updateExtracted(i, "name", e.target.value)}
                            className="w-full text-xs border-0 bg-transparent outline-none focus:ring-1 focus:ring-indigo-300 rounded px-1 -mx-1"
                          />
                          {m._changes && m._changes.length > 0 && (
                            <p className="text-[9px] text-amber-600 mt-0.5 px-1">
                              {m._changes.map(c => `${c.field}: ${c.from ?? "—"} → ${c.to ?? "—"}`).join(" · ")}
                            </p>
                          )}
                          {!m._changes && m.description && (
                            <p className="text-[10px] text-gray-400 mt-0.5 px-1">{m.description}</p>
                          )}
                          {m.activities && m.activities.length > 0 && (
                            <ul className="mt-1.5 space-y-1 pl-1">
                              {m.activities.map((a, ai) => (
                                <li key={ai} className="flex items-center gap-1.5">
                                  <span className="w-1 h-1 rounded-full bg-gray-300 shrink-0" />
                                  <span className="text-[10px] text-gray-500 flex-1 truncate">{a.name}</span>
                                  {a.estimatedHours != null && (
                                    <span className="text-[9px] text-indigo-400 shrink-0 font-medium">{a.estimatedHours}h</span>
                                  )}
                                  {a.completionPercent != null && (
                                    <span className="text-[9px] text-gray-400 shrink-0">{a.completionPercent}%</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {/* Est. hrs — auto-summed from activities, editable override */}
                          <div className="flex items-center gap-1">
                            <input
                              type="number" min="0" step="any"
                              value={m.estimatedHours ?? ""}
                              onChange={e => updateExtracted(i, "estimatedHours", e.target.value)}
                              placeholder="—"
                              className="text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-300 w-full font-medium text-indigo-700"
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="date"
                            value={m.startDate ?? ""}
                            min={projectStartDate ? projectStartDate.split("T")[0] : undefined}
                            onChange={e => updateExtracted(i, "startDate", e.target.value)}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-300 w-full"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="date"
                            value={m.dueDate ?? ""}
                            min={m.startDate || (projectStartDate ? projectStartDate.split("T")[0] : undefined)}
                            onChange={e => updateExtracted(i, "dueDate", e.target.value)}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-300 w-full"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" step="any"
                            value={m.billingAmount ?? ""}
                            onChange={e => updateExtracted(i, "billingAmount", e.target.value)}
                            placeholder="—"
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-300 w-full"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" max="100" step="1"
                            value={m.completionPercent ?? ""}
                            onChange={e => updateExtracted(i, "completionPercent", e.target.value)}
                            placeholder="—"
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-300 w-full"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 justify-end pt-1">
              <button
                onClick={() => { setExtracted(null); setSelected(new Set()); importFileRef.current?.click(); }}
                className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg"
              >
                ← Re-upload
              </button>
              <button
                onClick={importSelected}
                disabled={selected.size === 0 || importingRows}
                className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-1.5 rounded-lg transition-colors"
              >
                {importingRows ? "Applying…" : hasDiff ? `Apply ${selected.size} change${selected.size !== 1 ? "s" : ""}` : `Import ${selected.size} milestone${selected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        );
      })()}

      {showAdd && (
        <form onSubmit={submitMilestone} className="mb-4 p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="block text-[10px] font-medium text-gray-400 mb-1">Milestone name <span className="text-red-400">*</span></label>
              <input value={form.name} onChange={set("name")} required placeholder="e.g. Design approval" className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-400 mb-1">Due date</label>
              <input type="date" value={form.dueDate} onChange={set("dueDate")} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-400 mb-1">Billing amount ({currency})</label>
              <input
                value={form.billingAmount} onChange={set("billingAmount")}
                type="number" min="0" step="any" placeholder="0"
                className={`w-full text-xs border rounded-lg px-3 py-1.5 outline-none focus:ring-1 ${addOverBudget ? "border-red-400 focus:ring-red-300 bg-red-50" : "border-gray-200 focus:ring-indigo-300"}`}
              />
              {contractValue != null && addRemaining != null && (
                <p className={`text-[10px] mt-0.5 ${addOverBudget ? "text-red-600 font-semibold" : "text-gray-400"}`}>
                  {addOverBudget
                    ? `Exceeds contract by ${fmt(addBillingValue - addRemaining, currency)}`
                    : `${fmt(addRemaining, currency)} remaining of ${fmt(contractValue, currency)}`}
                </p>
              )}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-400 mb-1">Description</label>
            <textarea value={form.description} onChange={set("description")} rows={1} placeholder="Optional" className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300 resize-none" />
          </div>
          {/* Activities */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-medium text-gray-400">Activities</label>
              <button type="button"
                onClick={() => setForm(f => ({ ...f, tasks: [...f.tasks, { name: "", completionPercent: null, estimatedHours: null }] }))}
                className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
              >+ Add activity</button>
            </div>
            {form.tasks.length === 0 ? (
              <p className="text-[10px] text-gray-300 text-center py-2 border border-dashed border-gray-200 rounded-lg">No activities — optional</p>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium text-gray-400 text-[10px]">Activity name</th>
                      <th className="px-3 py-1.5 text-center font-medium text-gray-400 text-[10px] w-20">Done %</th>
                      <th className="px-3 py-1.5 text-center font-medium text-gray-400 text-[10px] w-20">Est. hrs</th>
                      <th className="px-2 py-1.5 w-7" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.tasks.map((t, ti) => (
                      <tr key={ti} className="border-t border-gray-100 hover:bg-gray-50/50">
                        <td className="px-3 py-1">
                          <input
                            value={t.name}
                            onChange={e => setForm(f => ({ ...f, tasks: f.tasks.map((x, idx) => idx === ti ? { ...x, name: e.target.value } : x) }))}
                            placeholder="Activity name"
                            className="w-full bg-transparent outline-none focus:bg-white focus:ring-1 focus:ring-indigo-200 rounded px-1 py-0.5 text-gray-800"
                          />
                        </td>
                        <td className="px-3 py-1">
                          <input
                            type="number" min="0" max="100" step="1"
                            value={t.completionPercent ?? ""}
                            onChange={e => setForm(f => ({ ...f, tasks: f.tasks.map((x, idx) => idx === ti ? { ...x, completionPercent: e.target.value !== "" ? parseFloat(e.target.value) : null } : x) }))}
                            placeholder="0"
                            className="w-full bg-transparent text-center outline-none focus:bg-white focus:ring-1 focus:ring-indigo-200 rounded px-1 py-0.5 text-gray-700"
                          />
                        </td>
                        <td className="px-3 py-1">
                          <input
                            type="number" min="0" step="any"
                            value={t.estimatedHours ?? ""}
                            onChange={e => setForm(f => ({ ...f, tasks: f.tasks.map((x, idx) => idx === ti ? { ...x, estimatedHours: e.target.value !== "" ? parseFloat(e.target.value) : null } : x) }))}
                            placeholder="—"
                            className="w-full bg-transparent text-center text-indigo-700 font-medium outline-none focus:bg-white focus:ring-1 focus:ring-indigo-200 rounded px-1 py-0.5"
                          />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <button type="button"
                            onClick={() => setForm(f => ({ ...f, tasks: f.tasks.filter((_, idx) => idx !== ti) }))}
                            className="text-gray-300 hover:text-red-400 transition-colors"
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {form.tasks.some(t => t.estimatedHours != null) && (
                    <tfoot className="border-t-2 border-gray-200 bg-indigo-50/50">
                      <tr>
                        <td colSpan={2} className="px-3 py-1.5 text-[10px] font-semibold text-gray-600">Total est. hours</td>
                        <td className="px-3 py-1.5 text-center text-[10px] font-bold text-indigo-700">
                          {form.tasks.reduce((s, t) => s + (t.estimatedHours ?? 0), 0)}h
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button type="button" onClick={() => setShowAdd(false)} className="text-xs text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving || addOverBudget} className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-1.5 rounded-lg">
              {saving ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      )}

      {milestones.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">No milestones yet.</p>
      ) : milestoneView === "gantt" ? (
        <MilestoneGantt
          milestones={milestones}
          projectStartDate={projectStartDate}
        />
      ) : (
        <div className="space-y-2">
          {milestones.map((m, i) => {
            const billing = m.billingAmount ?? (contractValue && m.billingPercent ? contractValue * m.billingPercent : null);
            const paidClientDocAmount = clientDocs
              .filter(d => d.milestoneId === m.id && d.isPaid && d.amount != null)
              .reduce((s, d) => s + (d.amount ?? 0), 0);
            const invoicedForMilestone = m.invoices.filter(i => i.status !== "draft").reduce((s, i) => s + i.amount, 0) + paidClientDocAmount;
            const stats = entryStats[m.id];

            // Revenue = billing amount (fixed price for milestone), falling back to T&M billable value.
            // Without either, no profitability indicator is shown.
            const milestoneCost = stats?.cost ?? 0;
            const milestoneRevenue = billing ?? (stats?.billable ?? 0) > 0 ? (billing ?? stats?.billable ?? 0) : null;
            const margin = milestoneRevenue && milestoneRevenue > 0 && milestoneCost > 0
              ? (milestoneRevenue - milestoneCost) / milestoneRevenue * 100
              : null;
            const profitStatus =
              margin === null ? null
              : margin >= 20  ? { label: "Profitable", chip: "bg-green-100 text-green-700", icon: "↑" }
              : margin >= 0   ? { label: "At risk",    chip: "bg-amber-100 text-amber-700", icon: "⚠" }
              :                 { label: "Over budget", chip: "bg-red-100 text-red-600",     icon: "↓" };
            return (
              <div key={m.id} className={`rounded-xl border transition-colors ${m.completedAt ? "bg-green-50/50 border-green-200" : "bg-white border-gray-200"}`}>
                {(
                  /* ── normal view ── */
                  <div className="p-4">
                    {/* Header: toggle + name + profit chip + actions */}
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => canWrite && toggleComplete(m)}
                        disabled={completingId === m.id || !canWrite}
                        className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${m.completedAt ? "border-green-500 bg-green-500" : "border-gray-300 hover:border-green-400"}`}
                      >
                        {m.completedAt && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4l2 2 3-3" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-semibold ${m.completedAt ? "text-green-800 line-through decoration-green-400" : "text-gray-900"}`}>
                                {i + 1}. {m.name}
                              </span>
                              {profitStatus && (
                                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${profitStatus.chip}`}>
                                  <span>{profitStatus.icon}</span>
                                  {profitStatus.label}{margin !== null ? ` · ${Math.abs(margin).toFixed(0)}%` : ""}
                                </span>
                              )}
                              {(() => {
                                const linkedDocs = clientDocs.filter(d => d.milestoneId === m.id);
                                const all = [
                                  ...linkedDocs.map(d => ({ label: d.referenceNumber ?? d.filename ?? "Invoice", href: `/records/${d.id}` })),
                                  ...m.invoices.map(i => ({ label: i.referenceNumber ?? "Invoice", href: null })),
                                ];
                                if (all.length === 0) return null;
                                const first = all[0];
                                const extra = all.length > 1 ? ` +${all.length - 1}` : "";
                                const chip = (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 transition-colors">
                                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" className="shrink-0">
                                      <path d="M1 1h10v10l-1.5-1L8 11l-1.5-1L5 11l-1.5-1L2 11V1z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                                    </svg>
                                    {first.label}{extra}
                                  </span>
                                );
                                return first.href
                                  ? <a href={first.href} onClick={e => e.stopPropagation()}>{chip}</a>
                                  : chip;
                              })()}
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                              {m.dueDate && (
                                <span className="text-[11px] text-gray-400">Due {fmtDate(m.dueDate)}</span>
                              )}
                              {m.completedAt && (
                                <span className="text-[11px] text-green-600 font-medium">Completed {fmtDate(m.completedAt)}</span>
                              )}
                            </div>
                            {m.description && (
                              <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">{m.description}</p>
                            )}
                            {/* Completion % */}
                            <div className="flex items-center gap-2 mt-2">
                              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${(m.completionPercent ?? 0) >= 100 ? "bg-green-500" : "bg-indigo-400"}`}
                                  style={{ width: `${Math.min(100, m.completionPercent ?? 0)}%` }}
                                />
                              </div>
                              {pctEditing[m.id] !== undefined ? (
                                <input
                                  type="number" min="0" max="100" autoFocus
                                  value={pctEditing[m.id]}
                                  onChange={e => setPctEditing(prev => ({ ...prev, [m.id]: e.target.value }))}
                                  onBlur={() => savePct(m, pctEditing[m.id])}
                                  onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setPctEditing(prev => { const n = { ...prev }; delete n[m.id]; return n; }); }}
                                  className="w-12 text-[10px] border border-indigo-300 rounded px-1 py-0.5 text-center outline-none focus:ring-1 focus:ring-indigo-300"
                                />
                              ) : (
                                <button
                                  disabled={!canWrite || pctSaving.has(m.id)}
                                  onClick={() => canWrite && setPctEditing(prev => ({ ...prev, [m.id]: String(m.completionPercent ?? 0) }))}
                                  className={`text-[10px] font-medium min-w-[2.5rem] text-right ${canWrite ? "text-gray-400 hover:text-indigo-500 cursor-pointer" : "text-gray-400 cursor-default"}`}
                                >
                                  {pctSaving.has(m.id) ? "…" : `${m.completionPercent ?? 0}%`}
                                </button>
                              )}
                            </div>
                            {/* Tasks list */}
                            {(() => {
                              let taskList: MilestoneTask[] = [];
                              try { if (m.tasks) taskList = JSON.parse(m.tasks); } catch { /* ignore */ }
                              if (taskList.length === 0) return null;
                              const isOpen = expandedTasks.has(m.id);
                              return (
                                <div className="mt-2.5">
                                  <div className="flex items-center gap-3">
                                  <button
                                    onClick={() => setExpandedTasks(prev => { const s = new Set(prev); isOpen ? s.delete(m.id) : s.add(m.id); return s; })}
                                    className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-indigo-500 transition-colors"
                                  >
                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>
                                      <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                    {taskList.length} task{taskList.length !== 1 ? "s" : ""}
                                  </button>
                                  {m.estimatedHours != null && (
                                    <span className="text-[10px] text-indigo-500 font-medium">{m.estimatedHours} hrs est.</span>
                                  )}
                                  </div>
                                  {isOpen && (
                                    <ul className="mt-1.5 space-y-1.5 pl-3 border-l border-gray-100">
                                      {taskList.map((t, ti) => {
                                        const pct = t.completionPercent ?? 0;
                                        const isEditingThis = taskEditing?.milestoneId === m.id && taskEditing.taskIndex === ti;
                                        return (
                                          <li key={ti} className="space-y-0.5 group/task">
                                            <div className="flex items-center gap-2">
                                              <span className="text-[11px] text-gray-600 leading-tight flex-1 min-w-0">{t.name}</span>
                                              {t.estimatedHours != null && (
                                                <span className="text-[10px] text-indigo-400 tabular-nums shrink-0">{t.estimatedHours}h</span>
                                              )}
                                              <span className="text-[10px] text-gray-400 tabular-nums shrink-0">{pct}%</span>
                                              {canWrite && (
                                                isEditingThis ? (
                                                  <input
                                                    type="number" min="0" max="100" autoFocus
                                                    value={taskEditing.value}
                                                    disabled={taskSaving}
                                                    onChange={e => setTaskEditing(prev => prev ? { ...prev, value: e.target.value } : prev)}
                                                    onBlur={() => saveTaskPct(m, ti, taskEditing.value)}
                                                    onKeyDown={e => {
                                                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                                      if (e.key === "Escape") setTaskEditing(null);
                                                    }}
                                                    className="w-12 text-[10px] border border-indigo-300 rounded px-1 py-0.5 text-center outline-none focus:ring-1 focus:ring-indigo-300 shrink-0 disabled:opacity-50"
                                                  />
                                                ) : (
                                                  <button
                                                    onClick={() => setTaskEditing({ milestoneId: m.id, taskIndex: ti, value: String(pct) })}
                                                    className="opacity-0 group-hover/task:opacity-100 transition-opacity p-0.5 text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 rounded shrink-0"
                                                    title="Edit progress"
                                                  >
                                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                                      <path d="M7 1.5a1.18 1.18 0 0 1 1.5 1.5L2.5 8.5l-2 .5.5-2L7 1.5z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                                                    </svg>
                                                  </button>
                                                )
                                              )}
                                            </div>
                                            <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                                              <div
                                                className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-green-400" : "bg-indigo-300"}`}
                                                style={{ width: `${Math.min(100, pct)}%` }}
                                              />
                                            </div>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                          {canWrite && (
                            <div className="flex items-center gap-1 shrink-0">
                              {confirmDelete === m.id ? (
                                <div className="flex items-center gap-1">
                                  {deletingId === m.id ? (
                                    <svg className="animate-spin text-red-400" width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
                                  ) : (
                                    <>
                                      <span className="text-[10px] text-red-600 font-medium whitespace-nowrap">Delete?</span>
                                      <button onClick={() => deleteMilestone(m.id)} className="text-[10px] font-semibold text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded transition-colors">Yes</button>
                                      <button onClick={() => setConfirmDelete(null)} className="text-[10px] text-gray-500 hover:text-gray-700 px-1.5 py-0.5 rounded transition-colors">No</button>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <>
                                  <button onClick={() => startEditMilestone(m)} className="p-1 text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-md transition-colors" title="Edit milestone">
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5a1.414 1.414 0 0 1 2 2L3.5 10.5l-3 .5.5-3 7.5-7.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  </button>
                                  <button onClick={() => setAddInvoice(m)} className="p-1 text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-md transition-colors" title="Create invoice">
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1h10v10l-1.5-1L8 11l-1.5-1L5 11l-1.5-1L2 11V1z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                                  </button>
                                  <button onClick={() => setConfirmDelete(m.id)} className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors">
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M5 3V2.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5V3M9.5 3l-.6 6.7a.5.5 0 0 1-.5.3H3.6a.5.5 0 0 1-.5-.3L2.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Stats mini-cards */}
                        {(stats || billing) && (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                            {stats && stats.hours > 0 && (
                              <div className="bg-gray-50 rounded-lg px-3 py-2">
                                <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Hours</p>
                                <p className="text-xs font-bold text-gray-800 mt-0.5">{stats.hours.toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs</p>
                              </div>
                            )}
                            {stats && stats.cost > 0 && (
                              <div className="bg-gray-50 rounded-lg px-3 py-2">
                                <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Labor cost</p>
                                <p className="text-xs font-bold text-gray-800 mt-0.5">{fmt(stats.cost, currency)}</p>
                              </div>
                            )}
                            {billing && (
                              <div className="bg-indigo-50 rounded-lg px-3 py-2">
                                <p className="text-[10px] text-indigo-400 font-medium uppercase tracking-wide">Billing</p>
                                <p className="text-xs font-bold text-indigo-700 mt-0.5">{fmt(billing, currency)}</p>
                              </div>
                            )}
                            {milestoneRevenue && milestoneCost > 0 && (
                              <div className={`rounded-lg px-3 py-2 ${milestoneRevenue - milestoneCost >= 0 ? "bg-green-50" : "bg-red-50"}`}>
                                <p className={`text-[10px] font-medium uppercase tracking-wide ${milestoneRevenue - milestoneCost >= 0 ? "text-green-500" : "text-red-400"}`}>Net profit</p>
                                <p className={`text-xs font-bold mt-0.5 ${milestoneRevenue - milestoneCost >= 0 ? "text-green-700" : "text-red-700"}`}>{fmt(milestoneRevenue - milestoneCost, currency)}</p>
                                <p className={`text-[10px] mt-0.5 ${milestoneRevenue - milestoneCost >= 0 ? "text-green-400" : "text-red-400"}`}>vs {billing ? "billing" : "T&M"}</p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Timesheet entries assigned to this milestone */}
                        {(() => {
                          const mEntries = allEntries.filter(e => e.milestoneId === m.id);
                          if (mEntries.length === 0) return null;
                          const isOpen = expandedEntries.has(m.id);
                          return (
                            <div className="mt-3">
                              <button
                                onClick={() => setExpandedEntries(prev => { const s = new Set(prev); isOpen ? s.delete(m.id) : s.add(m.id); return s; })}
                                className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-indigo-500 transition-colors"
                              >
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>
                                  <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                                {mEntries.length} time entr{mEntries.length !== 1 ? "ies" : "y"}
                              </button>
                              {isOpen && (
                                <div className="mt-1.5 space-y-1.5 pl-3 border-l border-gray-100">
                                  {mEntries.map(e => (
                                    <div key={e.id} className="flex items-center gap-2 text-[10px]">
                                      <span className="text-gray-600 font-medium truncate flex-1">{e.employeeName}</span>
                                      {e.taskName && <span className="text-gray-400 truncate max-w-[140px]">{e.taskName}</span>}
                                      {e.date && <span className="text-gray-400 shrink-0 tabular-nums">{e.date}</span>}
                                      <span className="text-indigo-500 font-medium shrink-0 tabular-nums">{+e.hoursLogged.toFixed(2)}h</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Invoicing progress bar */}
                        {billing && billing > 0 && (
                          <div className="mt-3">
                            <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1.5">
                              <span className="font-medium">Invoicing progress</span>
                              <span>{fmt(invoicedForMilestone, currency)} / {fmt(billing, currency)}</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${invoicedForMilestone >= billing ? "bg-green-500" : "bg-indigo-500"}`}
                                style={{ width: `${Math.min(100, (invoicedForMilestone / billing) * 100)}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Invoices list */}
                        {m.invoices.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                            {m.invoices.map(inv => (
                              <div key={inv.id} className="flex items-center justify-between gap-3 group">
                                <span className="text-xs font-semibold text-gray-700">{fmt(inv.amount, inv.currency)}</span>
                                <div className="flex items-center gap-2">
                                  {inv.referenceNumber && <span className="text-[10px] text-gray-400">{inv.referenceNumber}</span>}
                                  {inv.issuedAt && <span className="text-[10px] text-gray-400">{fmtDate(inv.issuedAt)}</span>}
                                  {invoiceStatusChip(inv.status)}
                                  {canWrite && (
                                    <button
                                      onClick={() => deleteProjectInvoice(m.id, inv.id)}
                                      disabled={deletingInvoiceId === inv.id}
                                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-40"
                                      title="Remove invoice"
                                    >
                                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                                        <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {addInvoice && (
        <InvoiceModal
          projectId={projectId}
          milestone={addInvoice}
          currency={currency}
          contractValue={contractValue}
          onClose={() => setAddInvoice(null)}
          onCreated={(inv) => {
            onChange(milestones.map(m =>
              m.id === addInvoice.id ? { ...m, invoices: [...m.invoices, inv] } : m
            ));
            setAddInvoice(null);
          }}
        />
      )}

      {/* ── Milestone edit modal ── */}
      {editingId && (() => {
        const editM = milestones.find(m => m.id === editingId);
        if (!editM) return null;
        const taskHoursSum = editForm.tasks.some(t => t.estimatedHours != null)
          ? editForm.tasks.reduce((s, t) => s + (t.estimatedHours ?? 0), 0)
          : null;
        const otherAllocated = milestones.filter(x => x.id !== editM.id).reduce((s, x) => s + (x.billingAmount ?? 0), 0);
        const editRemaining = contractValue != null ? contractValue - otherAllocated : null;
        const editValue = parseFloat(editForm.billingAmount) || 0;
        const editOver = editRemaining != null && editValue > 0 && editValue > editRemaining;
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto" onClick={() => setEditingId(null)}>
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl mb-8" onClick={e => e.stopPropagation()}>
              <form onSubmit={e => { e.preventDefault(); saveEditMilestone(editM); }}>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-900">Edit milestone</p>
                  <button type="button" onClick={() => setEditingId(null)} className="p-1 text-gray-400 hover:text-gray-600 rounded-md transition-colors">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-5">
                  {/* Name */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Milestone name <span className="text-red-400">*</span></label>
                    <input
                      value={editForm.name} onChange={setEf("name")} required
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300"
                    />
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Start date</label>
                      <input type="date" value={editForm.startDate} onChange={setEf("startDate")}
                        min={projectStartDate ? projectStartDate.split("T")[0] : undefined}
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-gray-600">Due date</label>
                        {(() => {
                          const hrs = taskHoursSum ?? (editForm.estimatedHours !== "" ? parseFloat(editForm.estimatedHours) : null);
                          if (!hrs || hrs <= 0) return null;
                          const workDays = Math.ceil(hrs / 8);
                          const fromDate = editForm.startDate || new Date().toISOString().split("T")[0];
                          const suggested = addWorkingDays(fromDate, workDays - 1);
                          return (
                            <button type="button"
                              onClick={() => setEditForm(f => ({ ...f, dueDate: suggested }))}
                              className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 flex items-center gap-1"
                              title={`${workDays} working day${workDays !== 1 ? "s" : ""} at 8 hrs/day`}
                            >
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v4l2.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.2" /></svg>
                              Suggest ({workDays}d)
                            </button>
                          );
                        })()}
                      </div>
                      <input type="date" value={editForm.dueDate} onChange={setEf("dueDate")}
                        min={editForm.startDate || (projectStartDate ? projectStartDate.split("T")[0] : undefined)}
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" />
                    </div>
                  </div>

                  {/* Billing + Completion + Est. hours */}
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Billing ({currency})</label>
                      <input type="number" min="0" step="any" value={editForm.billingAmount} onChange={setEf("billingAmount")} placeholder="0"
                        className={`w-full text-sm border rounded-lg px-3 py-2 outline-none focus:ring-1 ${editOver ? "border-red-400 focus:ring-red-300 bg-red-50" : "border-gray-200 focus:ring-indigo-300"}`} />
                      {editRemaining != null && (
                        <p className={`text-[10px] mt-0.5 ${editOver ? "text-red-600 font-semibold" : "text-gray-400"}`}>
                          {editOver ? `Exceeds by ${fmt(editValue - editRemaining, currency)}` : `${fmt(editRemaining, currency)} remaining`}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Completion %</label>
                      <input type="number" min="0" max="100" step="1" value={editForm.completionPercent} onChange={setEf("completionPercent")} placeholder="0"
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Est. hours {taskHoursSum !== null && <span className="text-[10px] text-indigo-500 font-normal ml-1">auto</span>}
                      </label>
                      {taskHoursSum !== null ? (
                        <div className="w-full text-sm border border-indigo-200 bg-indigo-50 rounded-lg px-3 py-2 font-semibold text-indigo-700">
                          {taskHoursSum}
                        </div>
                      ) : (
                        <input type="number" min="0" step="any" value={editForm.estimatedHours} onChange={setEf("estimatedHours")} placeholder="—"
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" />
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                    <textarea value={editForm.description} onChange={setEf("description")} rows={2} placeholder="Optional"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300 resize-none" />
                  </div>

                  {/* Activities */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-gray-600">Activities</label>
                      <button type="button"
                        onClick={() => setEditForm(f => ({ ...f, tasks: [...f.tasks, { name: "", completionPercent: null, estimatedHours: null }] }))}
                        className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                      >+ Add activity</button>
                    </div>
                    {editForm.tasks.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-3 border border-dashed border-gray-200 rounded-lg">No activities yet</p>
                    ) : (
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 border-b border-gray-100">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-gray-500">Activity name</th>
                              <th className="px-3 py-2 text-center font-medium text-gray-500 w-20">Done %</th>
                              <th className="px-3 py-2 text-center font-medium text-gray-500 w-20">Est. hrs</th>
                              <th className="px-2 py-2 w-8" />
                            </tr>
                          </thead>
                          <tbody>
                            {editForm.tasks.map((t, ti) => (
                              <tr key={ti} className="border-t border-gray-100 hover:bg-gray-50/50">
                                <td className="px-3 py-1.5">
                                  <input
                                    value={t.name}
                                    onChange={e => {
                                      const tasks = editForm.tasks.map((x, idx) => idx === ti ? { ...x, name: e.target.value } : x);
                                      setEditForm(f => ({ ...f, tasks }));
                                    }}
                                    placeholder="Activity name"
                                    className="w-full bg-transparent outline-none focus:bg-white focus:ring-1 focus:ring-indigo-200 rounded px-1 py-0.5 text-gray-800"
                                  />
                                </td>
                                <td className="px-3 py-1.5">
                                  <input
                                    type="number" min="0" max="100" step="1"
                                    value={t.completionPercent ?? ""}
                                    onChange={e => {
                                      const tasks = editForm.tasks.map((x, idx) => idx === ti ? { ...x, completionPercent: e.target.value !== "" ? parseFloat(e.target.value) : null } : x);
                                      const hasPct = tasks.some(t => t.completionPercent != null);
                                      const avgPct = hasPct ? String(Math.round(tasks.reduce((s, t) => s + (t.completionPercent ?? 0), 0) / tasks.length)) : editForm.completionPercent;
                                      setEditForm(f => ({ ...f, tasks, completionPercent: avgPct }));
                                    }}
                                    placeholder="0"
                                    className="w-full bg-transparent text-center outline-none focus:bg-white focus:ring-1 focus:ring-indigo-200 rounded px-1 py-0.5 text-gray-700"
                                  />
                                </td>
                                <td className="px-3 py-1.5">
                                  <input
                                    type="number" min="0" step="any"
                                    value={t.estimatedHours ?? ""}
                                    onChange={e => {
                                      const tasks = editForm.tasks.map((x, idx) => idx === ti ? { ...x, estimatedHours: e.target.value !== "" ? parseFloat(e.target.value) : null } : x);
                                      setEditForm(f => ({ ...f, tasks }));
                                    }}
                                    placeholder="—"
                                    className="w-full bg-transparent text-center text-indigo-700 font-medium outline-none focus:bg-white focus:ring-1 focus:ring-indigo-200 rounded px-1 py-0.5"
                                  />
                                </td>
                                <td className="px-2 py-1.5 text-center">
                                  <button type="button"
                                    onClick={() => {
                                      const tasks = editForm.tasks.filter((_, idx) => idx !== ti);
                                      const hasPct = tasks.some(t => t.completionPercent != null);
                                      const avgPct = hasPct ? String(Math.round(tasks.reduce((s, t) => s + (t.completionPercent ?? 0), 0) / tasks.length)) : editForm.completionPercent;
                                      setEditForm(f => ({ ...f, tasks, completionPercent: avgPct }));
                                    }}
                                    className="text-gray-300 hover:text-red-400 transition-colors"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          {taskHoursSum !== null && (
                            <tfoot className="border-t-2 border-gray-200 bg-indigo-50/50">
                              <tr>
                                <td colSpan={2} className="px-3 py-2 text-xs font-semibold text-gray-600">Total est. hours</td>
                                <td className="px-3 py-2 text-center text-xs font-bold text-indigo-700">{taskHoursSum}</td>
                                <td />
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
                  <button type="button" onClick={() => setEditingId(null)} disabled={savingEdit}
                    className="text-xs text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg">Cancel</button>
                  <button type="submit" disabled={savingEdit || editOver}
                    className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-5 py-2 rounded-lg">
                    {savingEdit ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── invoice modal ────────────────────────────────────────────────────────────

function InvoiceModal({
  projectId, milestone, service, currency, contractValue, onClose, onCreated,
}: {
  projectId: string;
  milestone?: Milestone | null;
  service?: { id: string; name: string; billingAmount: number | null } | null;
  currency: string;
  contractValue: number | null;
  onClose: () => void;
  onCreated: (inv: MilestoneInvoice) => void;
}) {
  const defaultAmount = milestone?.billingAmount ??
    service?.billingAmount ??
    (contractValue && milestone?.billingPercent ? contractValue * milestone.billingPercent : null);

  const [form, setForm] = useState({
    amount: defaultAmount?.toString() ?? "",
    currency,
    issuedAt: new Date().toISOString().split("T")[0],
    dueDate: "",
    status: "draft",
    referenceNumber: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { ok, data } = await fetchJSON(`/api/projects/${projectId}/invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, milestoneId: milestone?.id ?? null, serviceId: service?.id ?? null }),
    });
    if (ok) onCreated(data as MilestoneInvoice);
    else alert((data as { error?: string }).error ?? "Failed to create invoice");
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <form onSubmit={submit}>
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">Create invoice{milestone ? ` — ${milestone.name}` : service ? ` — ${service.name}` : ""}</p>
          </div>
          <div className="px-5 py-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount *</label>
                <input type="number" min="0" step="any" value={form.amount} onChange={set("amount")} required className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
                <input value={form.currency} onChange={set("currency")} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Issue date</label>
                <input type="date" value={form.issuedAt} onChange={set("issuedAt")} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Due date</label>
                <input type="date" value={form.dueDate} onChange={set("dueDate")} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                <select value={form.status} onChange={set("status")} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300 bg-white">
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reference #</label>
                <input value={form.referenceNumber} onChange={set("referenceNumber")} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" placeholder="INV-001" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <textarea value={form.notes} onChange={set("notes")} rows={2} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300 resize-none" />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100 bg-gray-50">
            <button type="button" onClick={onClose} className="text-sm font-medium text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving} className="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-5 py-2 rounded-lg">
              {saving ? "Creating…" : "Create invoice"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── timesheets section ───────────────────────────────────────────────────────

function TimesheetsSection({
  projectId, projectName, timesheets, milestones, services, canWrite, onChange,
  teamMembers, onTeamChange, initialAsanaProjectGid, isTM, isPS,
}: {
  projectId: string; projectName: string; timesheets: TimesheetImport[]; milestones: Milestone[];
  services?: ProjectService[];
  canWrite: boolean; onChange: (ts: TimesheetImport[]) => void;
  teamMembers: TeamMember[]; onTeamChange: (members: TeamMember[]) => void;
  initialAsanaProjectGid?: string | null;
  isTM?: boolean;
  isPS?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [parsingTrigger, setParsingTrigger] = useState<"upload" | "toggle-single" | "toggle-all" | "refetch" | null>(null);
  const parsing = parsingTrigger !== null;
  const [uploadError, setUploadError] = useState("");
  const [tsAiPrompt, setTsAiPrompt] = useState("");
  const [showCsvForm, setShowCsvForm] = useState(false);
  const [refiltering, setRefiltering] = useState(false);
  const [importAllMonths, setImportAllMonths] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<{ importId: string; entryId: string } | null>(null);
  const [patchingEntryId, setPatchingEntryId] = useState<string | null>(null);

  // Bulk assignment — key format: "${importId}|${entryId}"
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [bulkServiceId, setBulkServiceId] = useState("");
  const [bulkMilestoneId, setBulkMilestoneId] = useState("");
  const [assigningBulk, setAssigningBulk] = useState(false);

  const canBulkAssign = canWrite && ((isPS && (services ?? []).length > 0) || (!isPS && milestones.length > 0));

  const [applyingId, setApplyingId] = useState<string | null>(null);
  const { startMilestoneSuggest, getTaskByImport, dismissTask } = useBackgroundTasks();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const cachedFileRef = useRef<File | null>(null);

  // Preview state
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; hasProjectCol: boolean; hasDateCol: boolean; monthFiltered: boolean; totalRowCount: number; suggestedCount: number; filename: string; projectName: string; clientName: string | null; aiFilterApplied?: boolean; aiPrompt?: string; detectedMonth?: string | null; availableMonths?: string[]; allMonths?: boolean } | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [previewTab, setPreviewTab] = useState<"all" | "suggested">("all");

  const [asanaModal, setAsanaModal] = useState(false);
  const [asanaProjects, setAsanaProjects] = useState<{ gid: string; name: string }[] | null>(null);
  const [asanaProjectGid, setAsanaProjectGid] = useState(initialAsanaProjectGid ?? "");
  const [asanaProjectSearch, setAsanaProjectSearch] = useState("");
  const [asanaLoading, setAsanaLoading] = useState(false);
  const [asanaError, setAsanaError] = useState("");

  async function openAsanaModal() {
    setAsanaModal(true);
    setShowCsvForm(false);
    setAsanaError("");
    setAsanaLoading(true);
    const { ok, data, status } = await fetchJSON("/api/asana/projects");
    console.log("[asana/projects]", status, data);
    if (ok) {
      const list = (data as { projects: { gid: string; name: string }[] }).projects ?? [];
      setAsanaProjects(list);
      if (list.length > 0 && !asanaProjectGid) setAsanaProjectGid(list[0].gid);
    } else {
      setAsanaError((data as { error?: string }).error ?? `Failed to load Asana projects (${status})`);
    }
    setAsanaLoading(false);
  }

  async function importFromAsana() {
    if (!asanaProjectGid) return;
    setAsanaLoading(true);
    setAsanaError("");
    const { ok, data } = await fetchJSON(`/api/projects/${projectId}/timesheets/asana-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asanaProjectGid, month, aiPrompt: tsAiPrompt.trim() || undefined }),
    });
    if (ok) {
      const result = data as { rows: PreviewRow[]; hasProjectCol: boolean; hasDateCol: boolean; monthFiltered: boolean; totalRowCount: number; suggestedCount: number; filename: string; projectName: string; clientName: string | null; aiFilterApplied?: boolean };
      const sorted = [...result.rows].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      setPreview({ ...result, rows: sorted, aiPrompt: tsAiPrompt.trim() || undefined });
      setSelectedIndices(new Set(sorted.filter(r => r.suggested).map(r => r.index)));
      setAsanaModal(false);
    } else {
      setAsanaError((data as { error?: string }).error ?? "Failed to fetch Asana data");
    }
    setAsanaLoading(false);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    cachedFileRef.current = file;
    await runPreview(file, importAllMonths);
  }

  async function runPreview(file: File, allMonthsMode: boolean, monthOverride?: string, trigger: "upload" | "toggle-single" | "toggle-all" | "refetch" = "upload") {
    setParsingTrigger(trigger);
    setUploadError("");
    const fd = new FormData();
    fd.append("file", file);
    if (tsAiPrompt.trim()) fd.append("aiPrompt", tsAiPrompt.trim());
    if (allMonthsMode) fd.append("allMonths", "true");
    if (monthOverride) fd.append("month", monthOverride);
    const { ok, data } = await fetchJSON(`/api/projects/${projectId}/timesheets/preview`, { method: "POST", body: fd });
    if (ok) {
      const result = data as { rows: PreviewRow[]; hasProjectCol: boolean; hasDateCol: boolean; monthFiltered: boolean; totalRowCount: number; suggestedCount: number; filename: string; projectName: string; clientName: string | null; aiFilterApplied?: boolean; detectedMonth?: string | null; availableMonths?: string[]; allMonths?: boolean };
      const sorted = [...result.rows].sort((a, b) => b.matchScore - a.matchScore);
      if (result.detectedMonth && !allMonthsMode) setMonth(result.detectedMonth);
      setImportAllMonths(allMonthsMode);
      setPreview({ ...result, rows: sorted, aiPrompt: tsAiPrompt.trim() || undefined });
      setSelectedIndices(new Set(sorted.filter(r => r.suggested).map(r => r.index)));
    } else {
      setUploadError((data as { error?: string }).error ?? "Failed to parse file");
    }
    setParsingTrigger(null);
    setShowCsvForm(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function cancelPreview() {
    setPreview(null);
    setSelectedIndices(new Set());
    setUploadError("");
    setPreviewTab("all");
    setShowCsvForm(false);
    setImportAllMonths(false);
    cachedFileRef.current = null;
  }

  async function refilterPreview(newPrompt: string) {
    if (!preview || refiltering) return;
    setRefiltering(true);
    setUploadError("");
    const { ok, data } = await fetchJSON(`/api/projects/${projectId}/timesheets/refilter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: preview.rows,
        aiPrompt: newPrompt,
        projectName: preview.projectName,
        clientName: preview.clientName,
        hasProjectCol: preview.hasProjectCol,
      }),
    });
    if (ok) {
      const result = data as { rows: Array<{ index: number; include: boolean; reason: string }> };
      const byIndex = new Map(result.rows.map(r => [r.index, r]));
      const updatedRows = preview.rows.map(row => {
        const ai = byIndex.get(row.index);
        return ai ? { ...row, suggested: ai.include, aiReason: ai.reason } : row;
      });
      const newSuggested = new Set(updatedRows.filter(r => r.suggested).map(r => r.index));
      setPreview({ ...preview, rows: updatedRows, aiFilterApplied: true, aiPrompt: newPrompt, suggestedCount: newSuggested.size });
      setSelectedIndices(newSuggested);
    } else {
      setUploadError((data as { error?: string }).error ?? "AI filter failed — check your Anthropic API key in settings");
    }
    setRefiltering(false);
  }

  async function confirmImport() {
    if (!preview) return;
    const selected = preview.rows.filter(r => selectedIndices.has(r.index));
    if (selected.length === 0) { setUploadError("Select at least one row to import."); return; }
    setConfirming(true);
    setUploadError("");

    // In all-months mode, group selected rows by month and create one import per group
    const monthGroups: Array<{ month: string; rows: typeof selected }> = [];
    if (importAllMonths) {
      const byMonth = new Map<string, typeof selected>();
      for (const row of selected) {
        const m = row.date?.slice(0, 7) ?? month ?? "unknown";
        if (!byMonth.has(m)) byMonth.set(m, []);
        byMonth.get(m)!.push(row);
      }
      for (const [m, rows] of [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        monthGroups.push({ month: m, rows });
      }
    } else {
      // In single-month mode, only import rows that match the chosen month
      // (or have no date). Rows from other months that were auto-checked by AI
      // are excluded here regardless of checkbox state.
      const monthRows = preview.hasDateCol
        ? selected.filter(r => !r.date || r.date.slice(0, 7) === month)
        : selected;
      monthGroups.push({ month, rows: monthRows });
    }

    const results = await Promise.all(monthGroups.map(g =>
      fetchJSON(`/api/projects/${projectId}/timesheets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: g.month, filename: preview.filename, rows: g.rows, aiPrompt: preview.aiPrompt }),
      })
    ));

    const anyFailed = results.find(r => !r.ok);
    if (anyFailed) {
      setUploadError((anyFailed.data as { error?: string }).error ?? "Import failed");
      setConfirming(false);
      return;
    }

    const newImports = results.map(r => r.data as TimesheetImport);
    onChange([...newImports, ...timesheets]);
    setExpanded(newImports[0].id);
    cancelPreview();

    // Collect all selected rows for rate matching (same logic as before)
    const ok = true;
    const data = newImports[0];
    if (ok) {

      // Build a map of matched rates + personId by employee name
      const byName = new Map<string, { personId: string | null; costPerHour: number | null; billingRate: number | null; currency: string }>();
      for (const row of selected) {
        if (!byName.has(row.employeeName)) {
          byName.set(row.employeeName, {
            personId: row.matchedPersonId ?? null,
            costPerHour: row.matchedCostPerHour,
            billingRate: row.matchedBillingRate,
            currency: row.matchedRateCurrency ?? "AED",
          });
        }
      }

      // All unique names in this import (including those without matched rates)
      const allNames = [...new Set(selected.map(r => r.employeeName))];

      const upserted: TeamMember[] = [];
      for (const name of allNames) {
        const existing = teamMembers.find(m => m.name === name);
        const rates = byName.get(name);

        if (existing?.hidden) {
          // Re-activate: un-hide the member; fill in rates if they were blank and now available
          const body: Record<string, unknown> = { hidden: false };
          if (rates?.personId && !existing.personId) body.personId = rates.personId;
          if (rates && existing.costPerHour == null && existing.billingRate == null) {
            Object.assign(body, { costPerHour: rates.costPerHour, billingRate: rates.billingRate, currency: rates.currency });
          }
          const { ok: tOk, data: tData } = await fetchJSON(`/api/projects/${projectId}/team/${existing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (tOk) upserted.push(tData as TeamMember);
          continue;
        }

        // Link personId even if rates already exist (keeps the people link fresh)
        if (existing && rates?.personId && !existing.personId) {
          const { ok: tOk, data: tData } = await fetchJSON(`/api/projects/${projectId}/team/${existing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ personId: rates.personId }),
          });
          if (tOk) upserted.push(tData as TeamMember);
          continue;
        }

        if (!rates) continue;
        if (existing) continue; // already has rates, already processed above
        const { ok: tOk, data: tData } = await fetchJSON(`/api/projects/${projectId}/team`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, personId: rates.personId, costPerHour: rates.costPerHour, billingRate: rates.billingRate, currency: rates.currency }),
        });
        if (tOk) upserted.push(tData as TeamMember);
      }
      if (upserted.length > 0) {
        const merged = [...teamMembers];
        for (const m of upserted) {
          const idx = merged.findIndex(x => x.id === m.id);
          if (idx >= 0) merged[idx] = m; else merged.push(m);
        }
        onTeamChange(merged);
      }
    }
    setConfirming(false);
  }

  async function deleteImport(id: string) {
    setDeletingId(id);
    await fetchJSON(`/api/projects/${projectId}/timesheets/${id}`, { method: "DELETE" });
    onChange(timesheets.filter(t => t.id !== id));
    setDeletingId(null);
  }

  async function deleteEntry(importId: string, entryId: string) {
    setDeletingEntryId(entryId);
    await fetchJSON(`/api/projects/${projectId}/timesheets/${importId}/entries/${entryId}`, { method: "DELETE" });
    onChange(timesheets.map(t =>
      t.id === importId ? { ...t, entries: t.entries.filter(e => e.id !== entryId) } : t
    ));
    setDeletingEntryId(null);
  }

  async function patchMilestone(importId: string, entryId: string, milestoneId: string | null) {
    setPatchingEntryId(entryId);
    const { ok } = await fetchJSON(`/api/projects/${projectId}/timesheets/${importId}/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ milestoneId }),
    });
    if (ok) {
      const linked = milestones.find(m => m.id === milestoneId) ?? null;
      onChange(timesheets.map(t =>
        t.id === importId
          ? { ...t, entries: t.entries.map(e => e.id === entryId ? { ...e, milestoneId, milestone: linked ? { id: linked.id, name: linked.name } : null } : e) }
          : t
      ));
    }
    setPatchingEntryId(null);
  }

  async function patchService(importId: string, entryId: string, serviceId: string | null) {
    setPatchingEntryId(entryId);
    const { ok } = await fetchJSON(`/api/projects/${projectId}/timesheets/${importId}/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceId }),
    });
    if (ok) {
      const linked = (services ?? []).find(s => s.id === serviceId) ?? null;
      onChange(timesheets.map(t =>
        t.id === importId
          ? { ...t, entries: t.entries.map(e => e.id === entryId ? { ...e, serviceId, service: linked ? { id: linked.id, name: linked.name } : null } : e) }
          : t
      ));
    }
    setPatchingEntryId(null);
  }

  async function bulkAssignService() {
    if (!bulkServiceId || selectedEntries.size === 0) return;
    setAssigningBulk(true);
    const items = Array.from(selectedEntries).map(key => {
      const [importId, entryId] = key.split("|");
      return { importId, entryId };
    });
    await Promise.all(items.map(({ importId, entryId }) =>
      fetchJSON(`/api/projects/${projectId}/timesheets/${importId}/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: bulkServiceId }),
      })
    ));
    const linked = (services ?? []).find(s => s.id === bulkServiceId) ?? null;
    onChange(timesheets.map(t => ({
      ...t,
      entries: t.entries.map(e =>
        selectedEntries.has(`${t.id}|${e.id}`)
          ? { ...e, serviceId: bulkServiceId, service: linked ? { id: linked.id, name: linked.name } : null }
          : e
      ),
    })));
    setSelectedEntries(new Set());
    setAssigningBulk(false);
  }

  async function bulkAssignMilestone() {
    if (!bulkMilestoneId || selectedEntries.size === 0) return;
    setAssigningBulk(true);
    const items = Array.from(selectedEntries).map(key => {
      const [importId, entryId] = key.split("|");
      return { importId, entryId };
    });
    await Promise.all(items.map(({ importId, entryId }) =>
      fetchJSON(`/api/projects/${projectId}/timesheets/${importId}/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestoneId: bulkMilestoneId }),
      })
    ));
    const linked = milestones.find(m => m.id === bulkMilestoneId) ?? null;
    onChange(timesheets.map(t => ({
      ...t,
      entries: t.entries.map(e =>
        selectedEntries.has(`${t.id}|${e.id}`)
          ? { ...e, milestoneId: bulkMilestoneId, milestone: linked ? { id: linked.id, name: linked.name } : null }
          : e
      ),
    })));
    setSelectedEntries(new Set());
    setAssigningBulk(false);
  }

  async function applyAllSuggestions(importId: string) {
    const task = getTaskByImport(importId);
    const sug = task?.result;
    if (!sug) return;
    setApplyingId(importId);

    await Promise.all(
      Object.entries(sug.entries).map(([entryId, { milestoneId }]) =>
        fetchJSON(`/api/projects/${projectId}/timesheets/${importId}/entries/${entryId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ milestoneId }),
        }),
      ),
    );

    onChange(timesheets.map(t => {
      if (t.id !== importId) return t;
      return {
        ...t,
        entries: t.entries.map(e => {
          const s = sug.entries[e.id];
          if (!s) return e;
          const linked = milestones.find(m => m.id === s.milestoneId) ?? null;
          return { ...e, milestoneId: s.milestoneId, milestone: linked ? { id: linked.id, name: linked.name } : null };
        }),
      };
    }));

    setApplyingId(null);
    dismissTask(importId);
  }

  const totalHours = (entries: TimesheetEntry[]) => entries.reduce((s, e) => s + e.hoursLogged, 0);

  const selectedRows = preview ? preview.rows.filter(r => selectedIndices.has(r.index)) : [];
  const selectedHours = selectedRows.reduce((s, r) => s + r.hoursLogged, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <SectionHeader title="Timesheets" />

      {canWrite && !preview && (
        <div className="mb-4 space-y-2">
        {/* Default: import trigger buttons */}
        {!showCsvForm && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => { setShowCsvForm(true); setUploadError(""); setTsAiPrompt(""); }}
              disabled={parsing}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${parsing ? "opacity-50 pointer-events-none" : "text-indigo-600 border-indigo-200 hover:bg-indigo-50"}`}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v7M3 4l3-3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M1 9v1.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
              Import CSV / Excel
            </button>
            <button
              onClick={openAsanaModal}
              disabled={parsing}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-pink-200 text-pink-700 hover:bg-pink-50 transition-colors disabled:opacity-50"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.372 0 0 5.373 0 12c0 6.628 5.372 12 12 12s12-5.372 12-12C24 5.373 18.628 0 12 0zm0 4.5a2.625 2.625 0 1 1 0 5.25A2.625 2.625 0 0 1 12 4.5zm-4.875 7.875a2.625 2.625 0 1 1 0 5.25 2.625 2.625 0 0 1 0-5.25zm9.75 0a2.625 2.625 0 1 1 0 5.25 2.625 2.625 0 0 1 0-5.25z"/></svg>
              Import from Asana
            </button>
          </div>
        )}
        {/* CSV import form — shown after clicking "Import CSV / Excel" */}
        {showCsvForm && (
          <div className="border border-indigo-100 bg-indigo-50/30 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-indigo-700">Import CSV / Excel</span>
              <button type="button" onClick={() => { setShowCsvForm(false); setUploadError(""); }} className="text-gray-400 hover:text-gray-600 text-sm leading-none">×</button>
            </div>
            <div className="flex items-start gap-2">
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide w-16 shrink-0 pt-1.5">AI filter</label>
              <div className="relative flex-1">
                <input
                  type="text"
                  value={tsAiPrompt}
                  onChange={e => setTsAiPrompt(e.target.value)}
                  placeholder="e.g. only include backend team, or exclude internal meetings"
                  className="w-full h-7 pl-2.5 pr-6 text-xs border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-200 focus:border-indigo-300 placeholder-gray-400 bg-white transition-colors"
                />
                {tsAiPrompt && (
                  <button type="button" onClick={() => setTsAiPrompt("")} className="absolute right-2 top-1.5 text-gray-300 hover:text-gray-500">
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  </button>
                )}
              </div>
            </div>
            {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
            <div className="flex items-center gap-2 pt-1">
              <label className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${parsing ? "opacity-50 pointer-events-none" : "text-indigo-600 border-indigo-200 bg-white hover:bg-indigo-50"}`}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v7M3 4l3-3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M1 9v1.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                {parsing ? "Parsing…" : "Choose file…"}
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileSelect} disabled={parsing} />
              </label>
              <span className="text-[11px] text-gray-400">.csv, .xlsx, .xls</span>
            </div>
          </div>
        )}
        {!showCsvForm && uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
        {/* Asana project picker modal */}
        {asanaModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Import from Asana</h3>
                <button onClick={() => setAsanaModal(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
              </div>
              <p className="text-xs text-gray-500">Select the Asana project to pull time tracking entries from, then confirm the month.</p>
              {asanaLoading && !asanaProjects ? (
                <p className="text-xs text-gray-400 text-center py-4">Loading Asana projects…</p>
              ) : asanaProjects ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Asana project <span className="normal-case font-normal text-gray-400">({asanaProjects.length} found)</span>
                    </label>
                    <input
                      type="text"
                      value={asanaProjectSearch}
                      onChange={e => setAsanaProjectSearch(e.target.value)}
                      placeholder="Search projects…"
                      className="w-full h-8 px-3 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-pink-100 focus:border-pink-300 mb-1"
                    />
                    <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                      {asanaProjects
                        .filter(p => !asanaProjectSearch || p.name.toLowerCase().includes(asanaProjectSearch.toLowerCase()))
                        .map(p => (
                          <button
                            key={p.gid}
                            type="button"
                            onClick={() => setAsanaProjectGid(p.gid)}
                            className={`w-full text-left px-3 py-2 text-xs transition-colors ${asanaProjectGid === p.gid ? "bg-pink-50 text-pink-700 font-semibold" : "text-gray-700 hover:bg-gray-50"}`}
                          >
                            {p.name}
                          </button>
                        ))}
                      {asanaProjects.filter(p => !asanaProjectSearch || p.name.toLowerCase().includes(asanaProjectSearch.toLowerCase())).length === 0 && (
                        <p className="text-xs text-gray-400 text-center py-3">No projects match</p>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Don&apos;t see it?{" "}
                      <button type="button" onClick={() => setAsanaProjectSearch("")} className="text-pink-600 underline">Clear search</button>
                      {" "}or paste the GID below.
                    </p>
                    <input
                      type="text"
                      value={asanaProjectGid}
                      onChange={e => setAsanaProjectGid(e.target.value)}
                      placeholder="Paste Asana project GID manually…"
                      className="w-full h-8 px-3 text-xs font-mono border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-pink-100 focus:border-pink-300 mt-1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Month</label>
                    <input
                      type="month"
                      value={month}
                      onChange={e => setMonth(e.target.value)}
                      className="w-full h-9 px-3 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-pink-100 focus:border-pink-300"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">Only entries logged in this month will be pre-selected.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">AI filter <span className="normal-case font-normal text-gray-400">(optional)</span></label>
                    <div className="relative">
                      <input
                        type="text"
                        value={tsAiPrompt}
                        onChange={e => setTsAiPrompt(e.target.value)}
                        placeholder="e.g. only include backend team, or exclude internal meetings"
                        className="w-full h-8 pl-3 pr-7 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-pink-100 focus:border-pink-300 placeholder-gray-400"
                      />
                      {tsAiPrompt && (
                        <button type="button" onClick={() => setTsAiPrompt("")} className="absolute right-2 top-2 text-gray-300 hover:text-gray-500 transition-colors">
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
              {asanaError && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{asanaError}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => setAsanaModal(false)} className="flex-1 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                <button
                  onClick={importFromAsana}
                  disabled={asanaLoading || !asanaProjectGid}
                  className="flex-1 px-3 py-2 text-sm font-semibold text-white bg-pink-600 hover:bg-pink-700 disabled:opacity-50 rounded-lg transition-colors"
                >
                  {asanaLoading ? "Fetching…" : "Fetch entries"}
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      )}

      {/* ── Preview panel ── */}
      {preview && (
        <div className="mb-4 border border-indigo-200 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-indigo-50 border-b border-indigo-100">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-semibold text-indigo-800 truncate">{preview.filename}</span>
              <span className="text-[10px] text-indigo-400 shrink-0">
                {preview.hasProjectCol
                  ? `Matching: "${preview.projectName}"${preview.clientName ? ` · "${preview.clientName}"` : ""}`
                  : "No project / client column — all rows shown"}
              </span>
              {preview.aiFilterApplied && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full shrink-0">
                  <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l1.5 4.5h4.5l-3.5 2.5 1.5 4.5L8 10.5 4 13l1.5-4.5L2 6h4.5z" fill="currentColor"/></svg>
                  AI filtered
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              {/* Single / All-months segmented toggle */}
              {(preview.availableMonths?.length ?? 0) > 1 && (
                <div className="flex items-center rounded-lg border border-indigo-200 overflow-hidden text-[11px] font-semibold shrink-0">
                  <button
                    type="button"
                    disabled={parsing}
                    onClick={async () => { if (importAllMonths && cachedFileRef.current) await runPreview(cachedFileRef.current, false, undefined, "toggle-single"); }}
                    className={`flex items-center gap-1 px-2 py-1 transition-colors ${!importAllMonths ? "bg-indigo-600 text-white" : "text-indigo-500 bg-white hover:bg-indigo-50"}`}
                  >
                    {parsingTrigger === "toggle-single"
                      ? <svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3"/><path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      : <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M1 7h14" stroke="currentColor" strokeWidth="1.5"/><path d="M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    }
                    Single month
                  </button>
                  <div className="w-px h-5 bg-indigo-200" />
                  <button
                    type="button"
                    disabled={parsing}
                    onClick={async () => { if (!importAllMonths && cachedFileRef.current) await runPreview(cachedFileRef.current, true, undefined, "toggle-all"); }}
                    className={`flex items-center gap-1 px-2 py-1 transition-colors ${importAllMonths ? "bg-indigo-600 text-white" : "text-indigo-500 bg-white hover:bg-indigo-50"}`}
                  >
                    {parsingTrigger === "toggle-all"
                      ? <svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3"/><path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      : <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="3" y="1" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M3 5h12" stroke="currentColor" strokeWidth="1.4"/><rect x="1" y="5" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="white"/><path d="M1 9h12" stroke="currentColor" strokeWidth="1.4"/></svg>
                    }
                    All {preview.availableMonths!.length} months
                  </button>
                </div>
              )}
              {/* Single-month picker — hidden in all-months mode */}
              {!importAllMonths && (
                <div className="flex items-center gap-1">
                  <input
                    type="month"
                    value={month}
                    onChange={e => setMonth(e.target.value)}
                    title="Month for this import — auto-detected from dates in the file"
                    className="text-[11px] border border-gray-200 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-indigo-300 bg-white text-gray-600"
                  />
                  <button
                    type="button"
                    disabled={parsing || !cachedFileRef.current}
                    onClick={() => { if (cachedFileRef.current) runPreview(cachedFileRef.current, false, month, "refetch"); }}
                    className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-40 bg-white shrink-0"
                  >
                    {parsingTrigger === "refetch"
                      ? <><svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3"/><path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>Fetching…</>
                      : "Fetch entries"
                    }
                  </button>
                </div>
              )}
              <button onClick={cancelPreview} className="text-[10px] text-gray-400 hover:text-gray-600">✕</button>
            </div>
          </div>
          {/* AI filter bar — always visible during preview */}
          <div className="px-3 py-1.5 bg-indigo-50/60 border-b border-indigo-100 space-y-1">
            {preview.hasProjectCol && preview.aiFilterApplied && !tsAiPrompt && (
              <p className="text-[10px] text-violet-500 flex items-center gap-1">
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l1.5 4.5h4.5l-3.5 2.5 1.5 4.5L8 10.5 4 13l1.5-4.5L2 6h4.5z" fill="currentColor"/></svg>
                AI filtered for <span className="font-semibold">{preview.projectName}</span> — name variations accepted. Add an instruction below to refine further.
              </p>
            )}
            <div className="flex items-center gap-2">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="text-violet-400 shrink-0"><path d="M8 1.5l1.5 4.5h4.5l-3.5 2.5 1.5 4.5L8 10.5 4 13l1.5-4.5L2 6h4.5z" fill="currentColor"/></svg>
              <div className="relative flex-1">
                <input
                  type="text"
                  value={tsAiPrompt}
                  onChange={e => { setTsAiPrompt(e.target.value); setUploadError(""); }}
                  onKeyDown={e => { if (e.key === "Enter" && tsAiPrompt.trim()) refilterPreview(tsAiPrompt); }}
                  placeholder={preview.hasProjectCol ? "Refine further — e.g. only include senior staff, exclude overtime" : "AI filter — e.g. only include backend team, or exclude internal meetings"}
                  className={`w-full h-6 pl-2 pr-6 text-xs border rounded outline-none focus:ring-1 placeholder-gray-400 transition-colors bg-white ${uploadError ? "border-red-300 focus:ring-red-200" : "border-violet-100 focus:ring-violet-200 focus:border-violet-300"}`}
                />
                {tsAiPrompt && (
                  <button type="button" onClick={() => { setTsAiPrompt(""); setUploadError(""); }} className="absolute right-1.5 top-1 text-gray-300 hover:text-gray-500">
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => tsAiPrompt.trim() && refilterPreview(tsAiPrompt)}
                disabled={!tsAiPrompt.trim() || refiltering}
                className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors"
              >
                {refiltering ? "Filtering…" : "Apply"}
              </button>
            </div>
            {uploadError && <p className="text-[11px] text-red-600 pl-4">{uploadError}</p>}
            {importAllMonths && preview.availableMonths && preview.availableMonths.length > 0 && (
              <div className="flex items-center gap-1.5 pl-4 flex-wrap">
                <span className="text-[10px] text-gray-400">Will create:</span>
                {preview.availableMonths.map(m => {
                  const count = preview.rows.filter(r => selectedIndices.has(r.index) && r.date?.slice(0, 7) === m).length;
                  return (
                    <span key={m} className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-full">
                      {new Date(m + "-02").toLocaleDateString("en-AE", { month: "short", year: "numeric" })} · {count} entries
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tabs */}
          {(() => {
            const suggestedRows = preview.rows.filter(r => r.suggested);
            const visibleRows = previewTab === "suggested" ? suggestedRows : preview.rows;
            const allVisibleSelected = visibleRows.length > 0 && visibleRows.every(r => selectedIndices.has(r.index));
            return (
              <>
                <div className="flex items-center justify-between border-b border-gray-100 px-3">
                  <div className="flex">
                    {(["all", "suggested"] as const).map(tab => {
                      const count = tab === "suggested" ? preview.suggestedCount : preview.totalRowCount;
                      const active = previewTab === tab;
                      return (
                        <button
                          key={tab}
                          onClick={() => setPreviewTab(tab)}
                          className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${active ? "border-indigo-500 text-indigo-700" : "border-transparent text-gray-400 hover:text-gray-700"}`}
                        >
                          {tab === "suggested" ? "Suggested" : "All"} <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full ${active ? "bg-indigo-100 text-indigo-600" : "bg-gray-100 text-gray-400"}`}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedIndices(s => { const n = new Set(s); visibleRows.forEach(r => n.add(r.index)); return n; })}
                      className="text-[10px] text-indigo-500 hover:text-indigo-700 font-medium"
                    >
                      Select all
                    </button>
                    <span className="text-[10px] text-gray-300">·</span>
                    <button
                      onClick={() => setSelectedIndices(s => { const n = new Set(s); visibleRows.forEach(r => n.delete(r.index)); return n; })}
                      className="text-[10px] text-gray-400 hover:text-gray-600 font-medium"
                    >
                      None
                    </button>
                  </div>
                </div>

                {/* Row table */}
                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-white border-b border-gray-100">
                        <th className="px-3 py-2 w-8">
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={e => setSelectedIndices(s => {
                              const n = new Set(s);
                              e.target.checked ? visibleRows.forEach(r => n.add(r.index)) : visibleRows.forEach(r => n.delete(r.index));
                              return n;
                            })}
                            className="rounded accent-indigo-600"
                          />
                        </th>
                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500">Employee</th>
                        <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500">Task</th>
                        {preview.hasDateCol && (
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 w-24">Date</th>
                        )}
                        <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-500">Hours</th>
                        {preview.hasProjectCol && (
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500">Project / client</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {visibleRows.map(row => {
                        const checked = selectedIndices.has(row.index);
                        return (
                          <tr
                            key={row.index}
                            onClick={() => setSelectedIndices(s => { const n = new Set(s); checked ? n.delete(row.index) : n.add(row.index); return n; })}
                            className={`cursor-pointer transition-colors ${checked ? "bg-indigo-50/70 hover:bg-indigo-50" : "hover:bg-gray-50"}`}
                          >
                            <td className="px-3 py-2">
                              <input type="checkbox" checked={checked} readOnly className="rounded accent-indigo-600" />
                            </td>
                            <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{row.employeeName}</td>
                            <td className="px-3 py-2 text-gray-500 max-w-[180px]">
                              <span className="truncate block" title={row.taskName ?? undefined}>
                                {row.taskName ?? <span className="text-gray-300">—</span>}
                              </span>
                              {row.aiReason && (
                                <span className="text-[9px] text-violet-500 truncate block" title={row.aiReason}>
                                  ✦ {row.aiReason}
                                </span>
                              )}
                            </td>
                            {preview.hasDateCol && (
                              <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-[11px]">
                                {row.date
                                  ? new Date(row.date).toLocaleDateString("en-AE", { day: "2-digit", month: "short", year: "numeric" })
                                  : <span className="text-gray-300">—</span>}
                              </td>
                            )}
                            <td className="px-3 py-2 text-right tabular-nums text-gray-700">{row.hoursLogged}</td>
                            {preview.hasProjectCol && (
                              <td className="px-3 py-2 whitespace-nowrap">
                                {!row.projectColValue ? (
                                  <span className="text-[10px] text-gray-300">—</span>
                                ) : row.matchScore >= 0.8 ? (
                                  <span className="text-[10px] text-green-600 font-medium">✓ {row.projectColValue}</span>
                                ) : row.matchScore >= 0.3 ? (
                                  <span className="text-[10px] text-amber-600">≈ {row.projectColValue}</span>
                                ) : (
                                  <span className="text-[10px] text-gray-400">{row.projectColValue}</span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 border-t border-gray-100">
            <div className="text-[10px] text-gray-500">
              <span className="font-semibold text-gray-700">{selectedIndices.size}</span> of {preview.rows.length} rows selected
              {selectedHours > 0 && (
                <span className="ml-2">· <span className="font-semibold text-gray-700">{selectedHours.toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs</span></span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400">Month:</span>
                <input
                  type="month"
                  value={month}
                  onChange={e => setMonth(e.target.value)}
                  className="text-[10px] border border-gray-200 rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-300"
                />
              </div>
              <button
                onClick={confirmImport}
                disabled={confirming || selectedIndices.size === 0}
                className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-1.5 rounded-lg transition-colors"
              >
                {confirming ? "Importing…" : `Import ${selectedIndices.size} row${selectedIndices.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {timesheets.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">No timesheets imported yet.</p>
      ) : (
        <div className="space-y-2">
          {timesheets.map(ts => {
            const hours = totalHours(ts.entries);
            const isOpen = expanded === ts.id;
            const unassignedCount = isPS ? ts.entries.filter(e => !e.serviceId).length : 0;
            return (
              <div key={ts.id} className="border border-gray-100 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  onClick={() => setExpanded(isOpen ? null : ts.id)}
                >
                  <svg className={`shrink-0 w-3.5 h-3.5 text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`} viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-800">{ts.month}</span>
                    {ts.filename && <span className="text-[10px] text-gray-400">{ts.filename}</span>}
                    {unassignedCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                        {unassignedCount} unassigned
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-gray-500">{hours.toLocaleString("en-US")} hrs</span>
                    {canWrite && (
                      <button
                        onClick={e => { e.stopPropagation(); deleteImport(ts.id); }}
                        disabled={deletingId === ts.id}
                        className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M5 3V2.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5V3M9.5 3l-.6 6.7a.5.5 0 0 1-.5.3H3.6a.5.5 0 0 1-.5-.3L2.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                    )}
                  </div>
                </button>
                {isOpen && ts.entries.length > 0 && (
                  <div className="border-t border-gray-100">
                    {/* AI suggest bar */}
                    {canWrite && !isTM && milestones.length > 0 && (() => {
                      const task = getTaskByImport(ts.id);
                      const isRunning = task?.status === "running";
                      const isDone = task?.status === "done";
                      const isError = task?.status === "error";
                      return (
                        <div className="flex items-start gap-3 px-3 py-2.5 bg-indigo-50/60 border-b border-indigo-100">
                          <button
                            onClick={() => startMilestoneSuggest({
                              projectId,
                              projectName,
                              importId: ts.id,
                              importMonth: ts.month,
                            })}
                            disabled={isRunning || applyingId === ts.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[11px] font-medium transition-colors shrink-0"
                          >
                            {isRunning ? (
                              <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" fill="currentColor" /></svg>
                            )}
                            {isRunning ? "Thinking…" : "AI suggest milestones"}
                          </button>
                          {isRunning && (
                            <p className="flex-1 text-[11px] text-indigo-600 self-center">Working in background — you can navigate away</p>
                          )}
                          {isError && (
                            <p className="flex-1 text-[11px] text-red-600 self-center">{task.error}</p>
                          )}
                          {isDone && task.result && (
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] text-indigo-800 leading-snug">{task.result.summary}</p>
                              <div className="flex items-center gap-2 mt-1.5">
                                <button
                                  onClick={() => applyAllSuggestions(ts.id)}
                                  disabled={applyingId === ts.id}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[10px] font-medium transition-colors"
                                >
                                  {applyingId === ts.id && (
                                    <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
                                  )}
                                  Apply all
                                </button>
                                <button
                                  onClick={() => dismissTask(ts.id)}
                                  className="text-[10px] text-indigo-500 hover:text-indigo-700 transition-colors"
                                >
                                  Dismiss
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50">
                          {canBulkAssign && (
                            <th className="w-8 px-2 py-2">
                              <input
                                type="checkbox"
                                checked={ts.entries.length > 0 && ts.entries.every(e => selectedEntries.has(`${ts.id}|${e.id}`))}
                                onChange={ev => setSelectedEntries(prev => {
                                  const next = new Set(prev);
                                  ts.entries.forEach(e => ev.target.checked ? next.add(`${ts.id}|${e.id}`) : next.delete(`${ts.id}|${e.id}`));
                                  return next;
                                })}
                                className="rounded accent-violet-600"
                              />
                            </th>
                          )}
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500">Employee</th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500">Task</th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 w-24">Date</th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500">Role</th>
                          {isPS && <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500">Service</th>}
                          {!isPS && <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500">Milestone</th>}
                          <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-500">Hours</th>
                          {canWrite && <th className="w-8" />}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {ts.entries.map(entry => (
                          <tr key={entry.id} className={`hover:bg-gray-50 transition-colors ${deletingEntryId === entry.id ? "opacity-40" : ""} ${selectedEntries.has(`${ts.id}|${entry.id}`) ? "bg-violet-50/60" : ""}`}>
                            {canBulkAssign && (
                              <td className="px-2 py-2">
                                <input
                                  type="checkbox"
                                  checked={selectedEntries.has(`${ts.id}|${entry.id}`)}
                                  onChange={ev => setSelectedEntries(prev => {
                                    const next = new Set(prev);
                                    ev.target.checked ? next.add(`${ts.id}|${entry.id}`) : next.delete(`${ts.id}|${entry.id}`);
                                    return next;
                                  })}
                                  className="rounded accent-violet-600"
                                />
                              </td>
                            )}
                            <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{entry.employeeName}</td>
                            <td className="px-3 py-2 max-w-[240px]">
                              {entry.taskName ? (
                                <div className="relative group/task-tip">
                                  <span className="block truncate text-gray-700 cursor-default">{entry.taskName}</span>
                                  <div className="pointer-events-none absolute z-50 bottom-full left-0 mb-1.5 hidden group-hover/task-tip:block">
                                    <div className="bg-gray-900 text-white text-[11px] leading-snug rounded-lg px-3 py-2 shadow-lg max-w-xs whitespace-normal break-words">
                                      {entry.taskName}
                                      <div className="absolute top-full left-4 border-4 border-transparent border-t-gray-900" />
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-[11px]">
                              {entry.date
                                ? new Date(entry.date).toLocaleDateString("en-AE", { day: "2-digit", month: "short", year: "numeric" })
                                : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{entry.role ?? "—"}</td>
                            {isPS && <td className="px-3 py-2">
                              {(services ?? []).length > 0 ? (
                                <select
                                  value={entry.serviceId ?? ""}
                                  onChange={e => patchService(ts.id, entry.id, e.target.value || null)}
                                  disabled={patchingEntryId === entry.id}
                                  className="text-[10px] border border-gray-200 rounded-md px-1.5 py-0.5 bg-white outline-none focus:ring-1 focus:ring-violet-300 max-w-[160px] disabled:opacity-50"
                                >
                                  <option value="">— none —</option>
                                  {(services ?? []).map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-gray-300 text-[10px]">No services</span>
                              )}
                            </td>}
                            {!isPS && <td className="px-3 py-2">
                              {milestones.length > 0 ? (
                                <div className="flex flex-col gap-1">
                                  <select
                                    value={entry.milestoneId ?? ""}
                                    onChange={e => patchMilestone(ts.id, entry.id, e.target.value || null)}
                                    disabled={patchingEntryId === entry.id}
                                    className="text-[10px] border border-gray-200 rounded-md px-1.5 py-0.5 bg-white outline-none focus:ring-1 focus:ring-indigo-300 max-w-[140px] disabled:opacity-50"
                                  >
                                    <option value="">— none —</option>
                                    {milestones.map(m => (
                                      <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                  </select>
                                  {(() => {
                                    const sug = getTaskByImport(ts.id)?.result?.entries[entry.id];
                                    if (!sug || sug.milestoneId === entry.milestoneId) return null;
                                    const sugName = milestones.find(m => m.id === sug.milestoneId)?.name ?? "None";
                                    return (
                                      <div className="group/sug relative">
                                        <button
                                          onClick={() => patchMilestone(ts.id, entry.id, sug.milestoneId)}
                                          className="flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
                                        >
                                          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" /></svg>
                                          <span className="truncate max-w-[120px]">{sugName}</span>
                                        </button>
                                        <div className="pointer-events-none absolute z-50 bottom-full left-0 mb-1.5 hidden group-hover/sug:block">
                                          <div className="bg-gray-900 text-white text-[10px] leading-snug rounded-lg px-2.5 py-1.5 shadow-lg max-w-[220px] whitespace-normal break-words">
                                            {sug.reason}
                                            <div className="absolute top-full left-3 border-[3px] border-transparent border-t-gray-900" />
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              ) : (
                                <span className="text-gray-300 text-[10px]">—</span>
                              )}
                            </td>}
                            <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{entry.hoursLogged}</td>
                            {canWrite && (
                              <td className="px-2 py-2">
                                {confirmDeleteEntry?.entryId === entry.id ? (
                                  <div className="flex items-center gap-1">
                                    {deletingEntryId === entry.id ? (
                                      <svg className="animate-spin text-red-400" width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
                                    ) : (
                                      <>
                                        <span className="text-[10px] text-red-600 font-medium whitespace-nowrap">Delete?</span>
                                        <button
                                          onClick={() => { setConfirmDeleteEntry(null); deleteEntry(ts.id, entry.id); }}
                                          className="text-[10px] font-semibold text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded transition-colors"
                                        >
                                          Yes
                                        </button>
                                        <button
                                          onClick={() => setConfirmDeleteEntry(null)}
                                          className="text-[10px] text-gray-500 hover:text-gray-700 px-1.5 py-0.5 rounded transition-colors"
                                        >
                                          No
                                        </button>
                                      </>
                                    )}
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setConfirmDeleteEntry({ importId: ts.id, entryId: entry.id })}
                                    disabled={deletingEntryId === entry.id}
                                    className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                    title="Remove row"
                                  >
                                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M5 3V2.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5V3M9.5 3l-.6 6.7a.5.5 0 0 1-.5.3H3.6a.5.5 0 0 1-.5-.3L2.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gray-50 font-semibold">
                          <td className="px-3 py-2 text-gray-700" colSpan={(isPS && canWrite && (services ?? []).length > 0 ? 6 : 5)}>Total</td>
                          <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{hours.toLocaleString("en-US")}</td>
                          {canWrite && <td />}
                        </tr>
                      </tfoot>
                    </table>
                    </div>{/* /overflow-x-auto */}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Bulk assign toolbar — sticky at bottom */}
      {canBulkAssign && selectedEntries.size > 0 && (
        <div className="sticky bottom-0 z-10 flex items-center gap-3 -mx-4 -mb-4 px-4 py-3 bg-violet-50 border-t border-violet-200 rounded-b-xl shadow-[0_-2px_8px_rgba(109,40,217,0.08)]">
          <span className="text-xs font-semibold text-violet-700 shrink-0">
            {selectedEntries.size} entr{selectedEntries.size === 1 ? "y" : "ies"} selected
          </span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-violet-300 shrink-0"><path d="M3 6h6M7 4l2 2-2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          {isPS ? (
            <>
              <select
                value={bulkServiceId}
                onChange={e => setBulkServiceId(e.target.value)}
                className="text-xs border border-violet-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-violet-300 min-w-[160px]"
              >
                <option value="">Select service…</option>
                {(services ?? []).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button
                onClick={bulkAssignService}
                disabled={!bulkServiceId || assigningBulk}
                className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-1.5 rounded-lg transition-colors shrink-0"
              >
                {assigningBulk ? "Assigning…" : "Assign to service"}
              </button>
            </>
          ) : (
            <>
              <select
                value={bulkMilestoneId}
                onChange={e => setBulkMilestoneId(e.target.value)}
                className="text-xs border border-violet-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-violet-300 min-w-[160px]"
              >
                <option value="">Select milestone…</option>
                {milestones.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <button
                onClick={bulkAssignMilestone}
                disabled={!bulkMilestoneId || assigningBulk}
                className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-1.5 rounded-lg transition-colors shrink-0"
              >
                {assigningBulk ? "Assigning…" : "Assign to milestone"}
              </button>
            </>
          )}
          <button
            onClick={() => { setSelectedEntries(new Set()); setBulkMilestoneId(""); setBulkServiceId(""); }}
            className="ml-auto text-xs text-violet-400 hover:text-violet-700 transition-colors"
          >
            Clear selection
          </button>
        </div>
      )}
    </div>
  );
}

// ─── expenses section ─────────────────────────────────────────────────────────

function ExpensesSection({
  projectId, expenses, currency, canWrite, onChange,
}: {
  projectId: string; expenses: ProjectExpense[]; currency: string;
  canWrite: boolean; onChange: (ex: ProjectExpense[]) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ description: "", amount: "", currency, date: new Date().toISOString().split("T")[0], category: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ description: "", amount: "", date: "", category: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));
  const setEf = (k: keyof typeof editForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEditForm(f => ({ ...f, [k]: e.target.value }));

  function startEdit(ex: ProjectExpense) {
    setEditingId(ex.id);
    setEditForm({
      description: ex.description,
      amount: ex.amount.toString(),
      date: ex.date.split("T")[0],
      category: ex.category ?? "",
    });
  }

  async function saveEdit(id: string) {
    setSavingEdit(true);
    const { ok, data } = await fetchJSON(`/api/projects/${projectId}/expenses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editForm, amount: parseFloat(editForm.amount) || 0 }),
    });
    if (ok) {
      onChange(expenses.map(e => e.id === id ? { ...e, ...(data as ProjectExpense) } : e));
      setEditingId(null);
    } else {
      alert((data as { error?: string }).error ?? "Failed to save");
    }
    setSavingEdit(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { ok, data } = await fetchJSON(`/api/projects/${projectId}/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (ok) {
      onChange([data as ProjectExpense, ...expenses]);
      setForm(f => ({ ...f, description: "", amount: "", category: "", notes: "" }));
      setShowAdd(false);
    } else {
      alert((data as { error?: string }).error ?? "Failed to add expense");
    }
    setSaving(false);
  }

  async function deleteExpense(id: string) {
    setDeletingId(id);
    await fetchJSON(`/api/projects/${projectId}/expenses/${id}`, { method: "DELETE" });
    onChange(expenses.filter(e => e.id !== id));
    setDeletingId(null);
  }

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <SectionHeader
        title="Direct expenses"
        action={canWrite ? <AddBtn onClick={() => setShowAdd(s => !s)} label="Add expense" /> : undefined}
      />

      {showAdd && (
        <form onSubmit={submit} className="mb-4 p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <input value={form.description} onChange={set("description")} required placeholder="Description *" className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300" />
            </div>
            <div className="flex items-stretch gap-1">
              <span className="text-xs border border-gray-200 border-r-0 rounded-l-lg px-2.5 py-1.5 bg-gray-50 text-gray-500 font-medium shrink-0 flex items-center">{currency}</span>
              <input type="number" min="0" step="any" value={form.amount} onChange={set("amount")} required placeholder="Amount *" className="flex-1 text-xs border border-gray-200 rounded-r-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300 min-w-0" />
            </div>
            <input type="date" value={form.date} onChange={set("date")} required className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300" />
            <input value={form.category} onChange={set("category")} placeholder="Category (travel, materials…)" className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300 col-span-2" />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button type="button" onClick={() => setShowAdd(false)} className="text-xs text-gray-500 px-3 py-1.5 rounded-lg hover:text-gray-800">Cancel</button>
            <button type="submit" disabled={saving} className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-1.5 rounded-lg">
              {saving ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      )}

      {expenses.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">No direct expenses logged.</p>
      ) : (
        <>
          <div className="space-y-1">
            {expenses.map(ex => (
              <div key={ex.id}>
                {editingId === ex.id ? (
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-2 my-1">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2">
                        <input
                          value={editForm.description} onChange={setEf("description")} required autoFocus
                          placeholder="Description *"
                          className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300"
                        />
                      </div>
                      <div className="flex items-stretch gap-1">
                        <span className="text-xs border border-gray-200 border-r-0 rounded-l-lg px-2.5 py-1.5 bg-white text-gray-500 font-medium shrink-0 flex items-center">{currency}</span>
                        <input
                          type="number" min="0" step="any"
                          value={editForm.amount} onChange={setEf("amount")} required
                          placeholder="Amount *"
                          className="flex-1 text-xs border border-gray-200 rounded-r-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300 min-w-0"
                        />
                      </div>
                      <input type="date" value={editForm.date} onChange={setEf("date")} required className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300" />
                      <input value={editForm.category} onChange={setEf("category")} placeholder="Category" className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300 col-span-2" />
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                      <button type="button" onClick={() => setEditingId(null)} disabled={savingEdit} className="text-xs text-gray-500 px-3 py-1.5 rounded-lg hover:text-gray-800">Cancel</button>
                      <button type="button" onClick={() => saveEdit(ex.id)} disabled={savingEdit} className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-1.5 rounded-lg">
                        {savingEdit ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 py-1.5 group">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-gray-800 truncate">{ex.description}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        {ex.category && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{ex.category}</span>}
                        <span className="text-[10px] text-gray-400">{fmtDate(ex.date)}</span>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-gray-700 tabular-nums shrink-0">{fmt(ex.amount, ex.currency)}</span>
                    {canWrite && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button onClick={() => startEdit(ex)} className="p-1 text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-md transition-colors">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5a1.414 1.414 0 0 1 2 2L3.5 10.5l-3 .5.5-3 7.5-7.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </button>
                        <button onClick={() => deleteExpense(ex.id)} disabled={deletingId === ex.id} className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M5 3V2.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5V3M9.5 3l-.6 6.7a.5.5 0 0 1-.5.3H3.6a.5.5 0 0 1-.5-.3L2.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          {expenses.length > 1 && (
            <div className="flex justify-end pt-2 border-t border-gray-100 mt-2">
              <span className="text-xs font-semibold text-gray-700">{fmt(total, currency)} total</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── invoices section ─────────────────────────────────────────────────────────

function InvoicesSection({
  projectId, clientName, milestones, services, isPS, currency, canWrite,
  clientDocs, loadingClientDocs, refetchClientDocs, onIssueInvoice,
}: {
  projectId: string; clientName: string | null; milestones: Milestone[];
  services?: ProjectService[]; isPS?: boolean;
  currency: string; canWrite: boolean;
  clientDocs: ClientDocument[]; loadingClientDocs: boolean; refetchClientDocs: () => void;
  onIssueInvoice?: () => void;
}) {
  const [assigningDocId, setAssigningDocId] = useState<string | null>(null);

  async function assignDocToEntity(docId: string, value: string | null, kind: "milestone" | "service") {
    setAssigningDocId(docId);
    if (value) {
      const body = kind === "service" ? { documentId: docId, serviceId: value } : { documentId: docId, milestoneId: value };
      const { ok } = await fetchJSON(`/api/projects/${projectId}/document-links`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (ok) refetchClientDocs();
    } else {
      const { ok } = await fetchJSON(`/api/projects/${projectId}/document-links?documentId=${docId}`, { method: "DELETE" });
      if (ok) refetchClientDocs();
    }
    setAssigningDocId(null);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <SectionHeader
        title="Client Invoices"
        action={canWrite && clientName ? <AddBtn onClick={() => onIssueInvoice?.()} label="Issue invoice" /> : undefined}
      />

      {!clientName ? (
        <p className="text-xs text-gray-400 py-4 text-center">Assign a client to this project to track invoices.</p>
      ) : loadingClientDocs ? (
        <div className="space-y-2 mt-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="animate-pulse flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-3 bg-gray-200 rounded w-20" />
                  <div className="h-4 bg-gray-100 rounded-full w-12" />
                </div>
                <div className="h-2.5 bg-gray-100 rounded w-36" />
              </div>
              <div className="h-6 w-24 bg-gray-100 rounded-lg shrink-0" />
            </div>
          ))}
        </div>
      ) : clientDocs.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">No invoices found for this client.</p>
      ) : (
        <div className="space-y-2 mt-2">
          {clientDocs.map(doc => (
            <div key={doc.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {doc.amount != null && (
                    <span className="text-xs font-semibold text-gray-800">{fmt(doc.amount, doc.currency ?? currency)}</span>
                  )}
                  {doc.isPaid
                    ? <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Paid</span>
                    : <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Unpaid</span>
                  }
                  {doc.referenceNumber && (
                    <a href={`/records/${doc.id}`} className="text-[10px] text-indigo-500 hover:text-indigo-700 hover:underline font-medium transition-colors">
                      {doc.referenceNumber}
                    </a>
                  )}
                  {doc.milestoneName && (
                    <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{doc.milestoneName}</span>
                  )}
                  {doc.serviceName && (
                    <span className="text-[10px] font-medium text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">{doc.serviceName}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {doc.filename && (
                    <a href={`/records/${doc.id}`} className="text-[10px] text-gray-400 hover:text-indigo-500 hover:underline truncate max-w-xs transition-colors">
                      {doc.filename}
                    </a>
                  )}
                  {doc.issueDate && <span className="text-[10px] text-gray-400">Issued {fmtDate(doc.issueDate)}</span>}
                  {doc.paidAt && <span className="text-[10px] text-green-600">Paid {fmtDate(doc.paidAt)}</span>}
                </div>
              </div>
              {canWrite && isPS && (services ?? []).length > 0 && (
                <div className="shrink-0">
                  <select
                    value={doc.serviceId ?? ""}
                    disabled={assigningDocId === doc.id}
                    onChange={e => assignDocToEntity(doc.id, e.target.value || null, "service")}
                    className="text-[10px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 outline-none focus:ring-1 focus:ring-violet-300 disabled:opacity-50"
                  >
                    <option value="">— Service</option>
                    {(services ?? []).map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {canWrite && !isPS && milestones.length > 0 && (
                <div className="shrink-0">
                  <select
                    value={doc.milestoneId ?? ""}
                    disabled={assigningDocId === doc.id}
                    onChange={e => assignDocToEntity(doc.id, e.target.value || null, "milestone")}
                    className="text-[10px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 outline-none focus:ring-1 focus:ring-indigo-300 disabled:opacity-50"
                  >
                    <option value="">— Milestone</option>
                    {milestones.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

// ─── issue invoice modal ──────────────────────────────────────────────────────

function IssueInvoiceModal({
  defaultVendor, defaultCurrency, defaultAmount, projectId, milestoneId, serviceId, onClose, onCreated,
}: {
  defaultVendor: string; defaultCurrency: string; defaultAmount?: string;
  projectId?: string; milestoneId?: string; serviceId?: string;
  onClose: () => void; onCreated: () => void;
}) {
  const [form, setForm] = useState({
    vendor: defaultVendor,
    referenceNumber: "",
    issueDate: "",
    expiryDate: "",
    amount: defaultAmount ?? "",
    currency: defaultCurrency,
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const activeCurrencies = useActiveCurrencies();
  const [error, setError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/invoices/vendors")
      .then(r => r.ok ? r.json() : { vendors: [] })
      .then(d => setVendors(d.vendors ?? []))
      .catch(() => {});
  }, []);

  function set(key: keyof typeof form, value: string) {
    setForm(p => ({ ...p, [key]: value }));
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.vendor.trim()) { setError("Client is required"); return; }
    if (!form.issueDate) { setError("Invoice date is required"); return; }
    if (!form.expiryDate) { setError("Due date is required"); return; }
    setSaving(true);
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendor:          form.vendor.trim(),
        referenceNumber: form.referenceNumber || null,
        issueDate:       form.issueDate  || null,
        expiryDate:      form.expiryDate || null,
        amount:          form.amount ? parseFloat(form.amount) : null,
        currency:        form.currency || null,
        notes:           form.notes   || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to create"); setSaving(false); return; }
    if (projectId && data.id && (milestoneId || serviceId)) {
      const body = serviceId
        ? { documentId: data.id, serviceId }
        : { documentId: data.id, milestoneId };
      await fetch(`/api/projects/${projectId}/document-links`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Issue invoice to client</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Client <span className="text-red-400">*</span>
            </label>
            <VendorCombobox
              value={form.vendor}
              onChange={v => set("vendor", v)}
              vendors={vendors}
              placeholder="Search or add client…"
              inputClassName="h-9 px-3 text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-lg focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Reference #</label>
              <input
                value={form.referenceNumber}
                onChange={e => set("referenceNumber", e.target.value)}
                placeholder="INV-2026-001"
                className="w-full h-9 px-3 text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Currency</label>
              <select
                value={form.currency}
                onChange={e => set("currency", e.target.value)}
                className="w-full h-9 px-3 text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
              >
                {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Invoice date <span className="text-red-400">*</span></label>
              <input required type="date" value={form.issueDate} onChange={e => set("issueDate", e.target.value)}
                className="w-full h-9 px-3 text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Due date <span className="text-red-400">*</span></label>
              <input required type="date" value={form.expiryDate} onChange={e => set("expiryDate", e.target.value)}
                className="w-full h-9 px-3 text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Amount</label>
            <input
              type="number" value={form.amount} onChange={e => set("amount", e.target.value)}
              placeholder="0.00" min="0" step="0.01"
              className="w-full h-9 px-3 text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400 tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes</label>
            <input
              value={form.notes} onChange={e => set("notes", e.target.value)}
              placeholder="Optional"
              className="w-full h-9 px-3 text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400"
            />
          </div>

          {error && <p className="text-xs font-medium text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 rounded-lg transition-colors">
              {saving ? "Creating…" : "Create invoice"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── profitability panel ──────────────────────────────────────────────────────

function ProfitabilityPanel({ project, fxRates = {}, clientDocs = [] }: { project: Project; fxRates?: Record<string, number>; clientDocs?: ClientDocument[] }) {
  const allEntries = project.timesheets.flatMap(t => t.entries);
  const rateByName = new Map(project.teamMembers.map(m => [m.name, m]));
  const projectCurrency = project.currency;

  const totalHours = allEntries.reduce((s, e) => s + e.hoursLogged, 0);

  // Labor cost: what we pay the team (cost rate × hours), converted to project currency
  const laborCost = allEntries.reduce((s, e) => {
    const m = rateByName.get(e.employeeName);
    const memberCur = m?.currency ?? projectCurrency;
    const rate = m?.costPerHour != null
      ? convertRate(m.costPerHour, memberCur, projectCurrency, fxRates)
      : (e.hourlyRate ?? 0);
    return s + e.hoursLogged * rate;
  }, 0);

  const expenseCost = project.expenses.reduce((s, e) => s + e.amount, 0);
  const totalCost = laborCost + expenseCost;
  const budget = project.contractValue ?? 0;

  // Sum of milestone billing amounts (used for milestone-based projects)
  const milestoneBillingTotal = project.milestones.reduce((s, m) => {
    const b = m.billingAmount ?? (budget > 0 && m.billingPercent ? budget * m.billingPercent / 100 : 0);
    return s + b;
  }, 0);

  // T&M billing value: hours × billing rate, converted to project currency
  const billingValue = allEntries.reduce((s, e) => {
    const m = rateByName.get(e.employeeName);
    const memberCur = m?.currency ?? projectCurrency;
    const rate = m?.billingRate != null
      ? convertRate(m.billingRate, memberCur, projectCurrency, fxRates)
      : 0;
    return s + e.hoursLogged * rate;
  }, 0);

  // fixed is legacy — treat same as milestone
  const isMilestoneBased = project.billingType === "milestone" || project.billingType === "fixed";
  const isTM = project.billingType === "tm";
  const isPS = project.billingType === "ps";

  // PS revenue = sum of fixed service billing amounts (not T&M hours × rate)
  const psBillingTotal = project.services.reduce((s, svc) => s + (svc.billingAmount ?? 0), 0);

  // Revenue by billing type:
  //   milestone → sum of milestone billing amounts (contractValue acts as budget ceiling if set)
  //   tm        → hours × billing rate
  //   ps        → sum of service billing amounts (fixed per service, not T&M)
  const revenue = isPS
    ? (psBillingTotal > 0 ? psBillingTotal : budget)
    : isTM
      ? (billingValue > 0 ? billingValue : budget)
      : isMilestoneBased
        ? (milestoneBillingTotal > 0 ? milestoneBillingTotal : budget)
        : budget;

  // PS: net profit and margin are vs contract value (budget headroom view)
  const netProfit = isPS
    ? (budget > 0 ? budget - totalCost : null)
    : (revenue > 0 ? revenue - totalCost : null);
  const netMargin = isPS
    ? (budget > 0 ? ((budget - totalCost) / budget) * 100 : null)
    : (netProfit !== null && revenue > 0 ? (netProfit / revenue) * 100 : null);

  // PS burn bar: cost vs contractValue (budget ceiling), not vs service billing total
  const burnBase = isPS ? budget : revenue;
  const burnPct = burnBase > 0 ? Math.min((totalCost / burnBase) * 100, 200) : null;

  const serviceDocs = clientDocs.filter(d => d.serviceId != null && d.amount != null);
  const totalInvoiced = isPS
    ? serviceDocs.reduce((s, d) => s + (d.amount ?? 0), 0)
    : project.invoices.filter(i => i.status !== "draft").reduce((s, i) => s + i.amount, 0);
  const totalPaid = isPS
    ? serviceDocs.filter(d => d.isPaid).reduce((s, d) => s + (d.amount ?? 0), 0)
    : project.invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.amount, 0);

  const overBudget = burnBase > 0 && totalCost > burnBase;
  const health =
    burnBase === 0 ? null
    : overBudget
      ? { label: "Over budget",  bar: "bg-red-500",   chip: "bg-red-100 text-red-700" }
    : burnPct !== null && burnPct >= 80
      ? { label: "At risk",      bar: "bg-amber-400", chip: "bg-amber-100 text-amber-700" }
    :   { label: "On track",     bar: "bg-green-500", chip: "bg-green-100 text-green-700" };

  const revenueLabel = isPS ? "contract value" : budget > 0 ? "contract value" : isMilestoneBased ? "milestone billing" : "T&M billing";
  const burnLabel = isPS ? "contract value" : revenueLabel;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Red alert banner */}
      {health?.label === "Over budget" && (
        <div className="flex items-center justify-between gap-3 bg-red-600 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-white font-bold text-xs">⚠ Over budget</span>
            <span className="text-red-200 text-xs">
              {fmt(Math.abs(netProfit!), project.currency)} over {revenueLabel}
            </span>
          </div>
          {burnPct !== null && <span className="text-red-200 text-xs font-semibold">{burnPct.toFixed(0)}% consumed</span>}
        </div>
      )}

      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-800">Financial summary</h2>
          {health && (
            <span className={`inline-flex items-center text-[10px] font-semibold px-2.5 py-1 rounded-full ${health.chip}`}>
              {health.label}
              {netMargin !== null && ` · ${Math.abs(netMargin).toFixed(1)}% margin`}
            </span>
          )}
        </div>

        {/* Cost vs revenue burn bar */}
        {burnBase > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1.5">
              <span className="font-medium">Cost vs {burnLabel}</span>
              <span>{fmt(totalCost, project.currency)} / {fmt(burnBase, project.currency)}</span>
            </div>
            <div className="relative">
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${health?.bar ?? "bg-indigo-500"}`}
                  style={{ width: `${Math.min(100, burnPct ?? 0)}%` }}
                />
              </div>
              {/* Vertical tick at labor cost position */}
              {burnPct != null && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-px h-4 bg-gray-500 rounded-full"
                  style={{ left: `${Math.min(99, burnPct)}%` }}
                />
              )}
            </div>
            {/* Label anchored under the tick */}
            {burnPct != null && (
              <div className="relative h-4">
                <span
                  className="absolute -translate-x-1/2 text-[10px] text-gray-500 font-medium whitespace-nowrap"
                  style={{ left: `${Math.min(99, burnPct)}%` }}
                >
                  {fmt(totalCost, project.currency)} labor cost
                </span>
              </div>
            )}
            {netProfit !== null && (
              <p className={`text-[10px] mt-1.5 font-medium ${netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                {netProfit >= 0
                  ? `${fmt(netProfit, project.currency)} net profit`
                  : `${fmt(Math.abs(netProfit), project.currency)} over budget`}
              </p>
            )}
          </div>
        )}

        {/* T&M billing bar — only for pure T&M projects */}
        {isTM && billingValue > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1.5">
              <span className="font-medium">Labor cost vs billable</span>
              <span>{fmt(laborCost, project.currency)} cost / {fmt(billingValue, project.currency)} billable</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${billingValue > laborCost ? "bg-indigo-500" : "bg-red-400"}`}
                style={{ width: `${Math.min(100, (laborCost / billingValue) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* KPI grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-gray-50 rounded-xl px-3 py-2.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Hours logged</p>
            <p className="text-sm font-bold text-gray-900 mt-0.5">
              {totalHours > 0 ? `${totalHours.toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs` : "—"}
            </p>
          </div>
          <div className="bg-gray-50 rounded-xl px-3 py-2.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Labor cost</p>
            <p className="text-sm font-bold text-gray-900 mt-0.5">{laborCost > 0 ? fmt(laborCost, project.currency) : "—"}</p>
          </div>
          <div className="bg-gray-50 rounded-xl px-3 py-2.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Expenses</p>
            <p className="text-sm font-bold text-gray-900 mt-0.5">{expenseCost > 0 ? fmt(expenseCost, project.currency) : "—"}</p>
          </div>
          <div className="bg-gray-50 rounded-xl px-3 py-2.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Total cost</p>
            <p className={`text-sm font-bold mt-0.5 ${health?.label === "Over budget" ? "text-red-600" : "text-gray-900"}`}>
              {totalCost > 0 ? fmt(totalCost, project.currency) : "—"}
            </p>
          </div>

          {/* Revenue KPI — shows the relevant revenue source */}
          {budget > 0 && (
            <div className="bg-indigo-50 rounded-xl px-3 py-2.5">
              <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide">Contract value</p>
              <p className="text-sm font-bold text-indigo-700 mt-0.5">{fmt(budget, project.currency)}</p>
              <p className="text-[10px] text-indigo-400 mt-0.5">fixed price</p>
            </div>
          )}
          {isMilestoneBased && (
            <div className="bg-indigo-50 rounded-xl px-3 py-2.5">
              <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide">Milestone billing</p>
              <p className="text-sm font-bold text-indigo-700 mt-0.5">{fmt(milestoneBillingTotal, project.currency)}</p>
              <p className="text-[10px] text-indigo-400 mt-0.5">{project.milestones.filter(m => m.billingAmount).length} milestones</p>
            </div>
          )}
          {isTM && (
            <div className="bg-indigo-50 rounded-xl px-3 py-2.5">
              <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide">Billable value</p>
              <p className="text-sm font-bold text-indigo-700 mt-0.5">{fmt(billingValue, project.currency)}</p>
              <p className="text-[10px] text-indigo-400 mt-0.5">hrs × billing rate</p>
            </div>
          )}

          <div className={`rounded-xl px-3 py-2.5 ${netProfit === null ? "bg-gray-50" : netProfit >= 0 ? "bg-green-50" : "bg-red-50"}`}>
            <p className={`text-[10px] font-semibold uppercase tracking-wide ${netProfit === null ? "text-gray-400" : netProfit >= 0 ? "text-green-500" : "text-red-400"}`}>Net profit</p>
            <p className={`text-sm font-bold mt-0.5 ${netProfit === null ? "text-gray-900" : netProfit >= 0 ? "text-green-700" : "text-red-700"}`}>
              {netProfit !== null ? fmt(netProfit, project.currency) : "—"}
            </p>
            {netMargin !== null && (
              <p className={`text-[10px] mt-0.5 ${netProfit! >= 0 ? "text-green-500" : "text-red-400"}`}>
                {netMargin.toFixed(1)}% margin
              </p>
            )}
          </div>
          <div className="bg-gray-50 rounded-xl px-3 py-2.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Invoiced</p>
            <p className="text-sm font-bold text-gray-900 mt-0.5">{totalInvoiced > 0 ? fmt(totalInvoiced, project.currency) : "—"}</p>
          </div>
          <div className="bg-gray-50 rounded-xl px-3 py-2.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Collected</p>
            <p className="text-sm font-bold text-green-700 mt-0.5">{totalPaid > 0 ? fmt(totalPaid, project.currency) : "—"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── client picker ────────────────────────────────────────────────────────────

function ClientPicker({
  projectId, clientName, canWrite, onChange,
}: {
  projectId: string; clientName: string | null;
  canWrite: boolean; onChange: (name: string | null) => void;
}) {
  const [vendors, setVendors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function openEdit() {
    setDraft(clientName ?? "");
    setIsEditing(true);
    Promise.all([
      fetch("/api/legal-entities").then(r => r.ok ? r.json() : []).catch(() => []),
      fetch("/api/invoices/vendors").then(r => r.ok ? r.json() : { vendors: [] }).catch(() => ({ vendors: [] })),
    ]).then(([entities, { vendors = [] }]) => {
      const names = new Set<string>([
        ...(entities as { name: string }[]).map((e: { name: string }) => e.name),
        ...vendors as string[],
      ]);
      setVendors(Array.from(names).sort((a, b) => a.localeCompare(b)));
    });
  }

  async function handleSelect(value: string) {
    const name = value.trim() || null;
    setSaving(true);
    const { ok } = await fetchJSON(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientName: name }),
    });
    if (ok) { onChange(name); setIsEditing(false); }
    setSaving(false);
  }

  if (!canWrite && !clientName) return null;

  if (!canWrite) {
    return <span className="text-sm text-gray-700">{clientName}</span>;
  }

  if (!isEditing) {
    return (
      <button
        onClick={openEdit}
        className="flex items-center gap-1.5 group"
        title="Click to change client"
      >
        <span className="text-sm text-gray-700 group-hover:text-indigo-600 transition-colors">
          {clientName ?? <span className="text-gray-400 italic text-xs">No client — click to set</span>}
        </span>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-gray-300 group-hover:text-indigo-400 transition-colors shrink-0">
          <path d="M8.5 1.5a1.414 1.414 0 0 1 2 2L3.5 10.5l-3 .5.5-3 7.5-6.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <VendorCombobox
        value={draft}
        onChange={setDraft}
        onSelect={v => !saving && handleSelect(v)}
        vendors={vendors}
        placeholder="Search or add client…"
        className="w-full max-w-sm"
        inputClassName="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-300 outline-none"
      />
      {saving ? (
        <span className="text-[10px] text-gray-400 shrink-0">Saving…</span>
      ) : (
        <button
          onClick={() => setIsEditing(false)}
          className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors shrink-0"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

// ─── project summary card ─────────────────────────────────────────────────────

function ProjectSummaryCard({ project, clientDocs, fxRates = {} }: { project: Project; clientDocs: ClientDocument[]; fxRates?: Record<string, number> }) {
  const [milestonesOpen, setMilestonesOpen] = useState(true);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const total = project.milestones.length;
  const completed = project.milestones.filter(m => m.completedAt).length;
  const overdue = project.milestones.filter(m => !m.completedAt && m.dueDate && new Date(m.dueDate) < today).length;
  const completionPct = total > 0 ? Math.round(completed / total * 100) : 0;

  const budget = project.contractValue ?? 0;
  const projectCurrency = project.currency;

  // Budget burn for PS projects
  const isPS = project.billingType === "ps";
  const allEntries = project.timesheets.flatMap(t => t.entries);
  const rateByName = new Map(project.teamMembers.map(m => [m.name, m]));
  const laborCost = isPS ? allEntries.reduce((s, e) => {
    const m = rateByName.get(e.employeeName);
    const memberCur = m?.currency ?? projectCurrency;
    const rate = m?.costPerHour != null
      ? convertRate(m.costPerHour, memberCur, projectCurrency, fxRates)
      : (e.hourlyRate ?? 0);
    return s + e.hoursLogged * rate;
  }, 0) : 0;
  const expenseCost = isPS ? project.expenses.reduce((s, e) => s + e.amount, 0) : 0;
  const totalCost = laborCost + expenseCost;
  const burnPct = isPS && budget > 0 && totalCost > 0
    ? Math.min((totalCost / budget) * 100, 999)
    : null;
  const projectInvoiced = project.invoices.filter(i => i.status !== "draft").reduce((s, i) => s + i.amount, 0);
  const projectPaid = project.invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.amount, 0);
  const serviceLinkedDocs = clientDocs.filter(d => d.serviceId != null && d.amount != null);
  const milestoneLinkedDocs = clientDocs.filter(d => d.milestoneId != null && d.amount != null);
  const totalInvoiced = isPS
    ? serviceLinkedDocs.reduce((s, d) => s + (d.amount ?? 0), 0)
    : projectInvoiced + milestoneLinkedDocs.reduce((s, d) => s + (d.amount ?? 0), 0);
  const totalCollected = isPS
    ? serviceLinkedDocs.filter(d => d.isPaid).reduce((s, d) => s + (d.amount ?? 0), 0)
    : projectPaid + milestoneLinkedDocs.filter(d => d.isPaid).reduce((s, d) => s + (d.amount ?? 0), 0);
  const collectionPct = budget > 0 ? Math.min(100, Math.round(totalCollected / budget * 100)) : 0;
  const invoicedPct = budget > 0 ? Math.min(100, Math.round(totalInvoiced / budget * 100)) : 0;

  const daysRemaining = project.endDate
    ? Math.ceil((new Date(project.endDate).getTime() - today.getTime()) / 86400000)
    : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-5">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Project snapshot</p>

      {/* Overall completion / Budget burn */}
      <div>
        {isPS ? (
          <>
            <div className="flex items-end justify-between mb-2">
              <div>
                <span className={`text-3xl font-bold ${(burnPct ?? 0) >= 100 ? "text-red-600" : (burnPct ?? 0) >= 85 ? "text-amber-500" : "text-gray-900"}`}>
                  {burnPct != null ? `${Math.round(Math.min(burnPct, 999))}%` : "—"}
                </span>
                <span className="text-xs text-gray-400 ml-1.5">budget consumed</span>
              </div>
              {(burnPct ?? 0) >= 100 && (
                <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">
                  Over budget
                </span>
              )}
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, burnPct ?? 0)}%`,
                  backgroundColor: (burnPct ?? 0) >= 100 ? "#ef4444" : (burnPct ?? 0) >= 85 ? "#f59e0b" : "#10b981",
                }}
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">
              {budget > 0 && totalCost > 0
                ? `${fmt(totalCost, projectCurrency)} of ${fmt(budget, projectCurrency)} used`
                : "No cost data yet"}
            </p>
          </>
        ) : (
          <>
            <div className="flex items-end justify-between mb-2">
              <div>
                <span className="text-3xl font-bold text-gray-900">{completionPct}%</span>
                <span className="text-xs text-gray-400 ml-1.5">complete</span>
              </div>
              {overdue > 0 && (
                <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">
                  {overdue} overdue
                </span>
              )}
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${completionPct === 100 ? "bg-green-500" : "bg-indigo-500"}`}
                style={{ width: `${completionPct}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">{completed} of {total} milestones complete</p>
          </>
        )}
      </div>

      {/* Milestones breakdown — hidden for PS */}
      {!isPS && total > 0 && (
        <div>
          <button
            onClick={() => setMilestonesOpen(o => !o)}
            className="flex items-center justify-between w-full group"
          >
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide group-hover:text-gray-600 transition-colors">
              Milestones
            </p>
            <svg
              width="12" height="12" viewBox="0 0 12 12" fill="none"
              className={`text-gray-300 group-hover:text-gray-500 transition-all ${milestonesOpen ? "rotate-0" : "-rotate-90"}`}
            >
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {milestonesOpen && (
            <div className="space-y-2.5 mt-2.5">
              {project.milestones.map((m, i) => {
                const isDone = !!m.completedAt;
                const isOver = !isDone && !!m.dueDate && new Date(m.dueDate) < today;
                const billing = m.billingAmount ?? (budget > 0 && m.billingPercent ? budget * m.billingPercent / 100 : null);
                return (
                  <div key={m.id} className="flex items-start gap-2.5">
                    <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      isDone ? "border-green-500 bg-green-500" : isOver ? "border-red-400 bg-red-50" : "border-gray-200"
                    }`}>
                      {isDone && <svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1.5 4l2 2 3-3" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium leading-tight ${isDone ? "text-gray-400 line-through decoration-gray-300" : "text-gray-800"}`}>
                        {i + 1}. {m.name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {m.dueDate && (
                          <span className={`text-[10px] ${isOver ? "text-red-500 font-semibold" : isDone ? "text-gray-300" : "text-gray-400"}`}>
                            {isOver ? "⚠ " : ""}{fmtDate(m.dueDate)}
                          </span>
                        )}
                        {billing != null && (
                          <span className={`text-[10px] font-medium ${isDone ? "text-green-600" : "text-indigo-500"}`}>
                            {fmt(billing, project.currency)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Collection tracker */}
      {budget > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Collection progress</p>
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="text-gray-700 font-semibold">{fmt(totalCollected, project.currency)} collected</span>
            <span className={`font-semibold ${collectionPct >= 100 ? "text-green-600" : "text-gray-500"}`}>{collectionPct}%</span>
          </div>
          {/* Layered bar: invoiced (light) behind collected (solid) */}
          <div className="relative h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-indigo-200 transition-all"
              style={{ width: `${invoicedPct}%` }}
            />
            <div
              className={`absolute inset-y-0 left-0 rounded-full transition-all ${collectionPct >= 100 ? "bg-green-500" : "bg-indigo-500"}`}
              style={{ width: `${collectionPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[10px] text-gray-400">of {fmt(budget, project.currency)} contract</p>
            {totalInvoiced > totalCollected && (
              <p className="text-[10px] text-indigo-400">{fmt(totalInvoiced, project.currency)} invoiced</p>
            )}
          </div>
        </div>
      )}

      {/* Timeline */}
      {daysRemaining !== null && (
        <div className={`rounded-xl px-3 py-2.5 ${daysRemaining < 0 ? "bg-red-50 border border-red-100" : daysRemaining <= 30 ? "bg-amber-50 border border-amber-100" : "bg-gray-50 border border-gray-100"}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wide ${daysRemaining < 0 ? "text-red-500" : daysRemaining <= 30 ? "text-amber-600" : "text-gray-400"}`}>
            {daysRemaining < 0 ? "Deadline passed" : "Time remaining"}
          </p>
          <p className={`text-lg font-bold mt-0.5 ${daysRemaining < 0 ? "text-red-700" : daysRemaining <= 30 ? "text-amber-700" : "text-gray-900"}`}>
            {Math.abs(daysRemaining)} days
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">End date: {fmtDate(project.endDate)}</p>
        </div>
      )}
    </div>
  );
}

// ─── edit project modal ───────────────────────────────────────────────────────

const BILLING_TYPES_EDIT = [
  { value: "milestone", label: "Milestone-based",      icon: "🏁" },
  { value: "tm",        label: "Time & Material",      icon: "⏱" },
  { value: "ps",        label: "Professional Services", icon: "🔧" },
] as const;

function EditProjectModal({
  project, onClose, onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved: (updated: Partial<Project>) => void;
}) {
  const activeCurrencies = useActiveCurrencies();
  const [form, setForm] = useState({
    name: project.name,
    description: project.description ?? "",
    contractValue: project.contractValue != null ? String(project.contractValue) : "",
    currency: project.currency,
    startDate: project.startDate ? project.startDate.split("T")[0] : "",
    endDate: project.endDate ? project.endDate.split("T")[0] : "",
    billingType: (project.billingType === "fixed" ? "milestone" : project.billingType) as "milestone" | "tm" | "ps",
    color: project.color ?? PROJECT_COLORS[0].bar,
  });
  const [saving, setSaving] = useState(false);

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }));

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    const { ok, data } = await fetchJSON(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        description: form.description.trim() || null,
        contractValue: form.contractValue || null,
        currency: form.currency,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        billingType: form.billingType,
        color: form.color,
      }),
    });
    if (ok) {
      const p = data as Project;
      onSaved({
        name: p.name,
        description: p.description,
        contractValue: p.contractValue,
        currency: p.currency,
        startDate: p.startDate,
        endDate: p.endDate,
        billingType: p.billingType,
        color: p.color,
      });
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Edit project</h2>
        </div>
        <form onSubmit={handleSave} className="overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Project name <span className="text-red-400">*</span></label>
            <div className="flex items-center gap-2">
              <input required value={form.name} onChange={set("name")} className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" />
              <div className="w-8 h-8 rounded-lg border-2 border-white shadow shrink-0" style={{ backgroundColor: form.color }} />
            </div>
          </div>
          <div>
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
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <textarea value={form.description} onChange={set("description")} rows={2} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300 resize-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Billing type</label>
            <div className="grid grid-cols-3 gap-2">
              {BILLING_TYPES_EDIT.map(bt => (
                <button key={bt.value} type="button"
                  onClick={() => setForm(f => ({ ...f, billingType: bt.value }))}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-center transition-all ${
                    form.billingType === bt.value
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  <span className="text-base">{bt.icon}</span>
                  <span className="text-[10px] font-semibold leading-tight">{bt.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Contract value</label>
              <input type="number" min="0" step="any" value={form.contractValue} onChange={set("contractValue")} placeholder="0" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
              <select value={form.currency} onChange={set("currency")} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300 bg-white">
                {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Start date</label>
              <input type="date" value={form.startDate} onChange={set("startDate")} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">End date</label>
              <input type="date" value={form.endDate} onChange={set("endDate")} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300" />
            </div>
          </div>
        </form>
        <div className="px-6 pb-6 pt-4 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !form.name.trim()} className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-60">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function ProjectDetailClient({ project: initial, canWrite, fxRates }: { project: Project; canWrite: boolean; fxRates: Record<string, number> }) {
  const router = useRouter();
  const [project, setProject] = useState(initial);
  const [editStatus, setEditStatus] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showIssueInvoice, setShowIssueInvoice] = useState(false);
  const [issueInvoiceAmount, setIssueInvoiceAmount] = useState<string | undefined>(undefined);
  const activityRef = useRef<ProjectActivityPanelHandle>(null);
  const refreshActivity = useCallback(() => activityRef.current?.refresh(), []);
  const [activityOpen, setActivityOpen] = useState(true);
  const [clientDocs, setClientDocs] = useState<ClientDocument[]>([]);
  const [loadingClientDocs, setLoadingClientDocs] = useState(false);
  const [allocations, setAllocations] = useState<MonthAllocation[]>([]);
  const [issueServiceInvoice, setIssueServiceInvoice] = useState<ProjectService | null>(null);
  const isTM = project.billingType === "tm";
  const isPS = project.billingType === "ps";
  const isNoMilestone = isTM || isPS;
  const [activeSection, setActiveSection] = useState("overview");

  useEffect(() => {
    const ids = isPS
      ? ["overview", "team", "services", "invoices", "timesheets", "resources", "expenses"]
      : isNoMilestone
        ? ["overview", "team", "invoices", "timesheets", "resources", "expenses"]
        : ["overview", "team", "milestones", "invoices", "timesheets", "resources", "expenses"];
    const observers: IntersectionObserver[] = [];
    for (const id of ids) {
      const el = document.getElementById(`section-${id}`);
      if (!el) continue;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveSection(id); },
        { rootMargin: "-96px 0px -60% 0px" },
      );
      obs.observe(el);
      observers.push(obs);
    }
    return () => observers.forEach(o => o.disconnect());
  }, []);

  function scrollToSection(id: string) {
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth" });
  }

  useEffect(() => {
    fetch(`/api/projects/${project.id}/allocations`)
      .then(r => r.json())
      .then((data: MonthAllocation[]) => setAllocations(data))
      .catch(() => {});
  }, [project.id]);

  const handleAllocationChange = useCallback((updated: MonthAllocation) => {
    setAllocations(prev => {
      // Try by id first; fall back to memberName+startDate (API may return a newly-created id)
      let idx = updated.id ? prev.findIndex(a => a.id === updated.id) : -1;
      if (idx < 0) {
        idx = prev.findIndex(
          a => a.memberName === updated.memberName &&
               a.startDate.slice(0, 10) === updated.startDate.slice(0, 10),
        );
      }
      return idx >= 0 ? prev.map((a, i) => i === idx ? updated : a) : [...prev, updated];
    });
  }, []);

  const refetchClientDocs = useCallback(() => {
    if (!project.clientName) { setClientDocs([]); return; }
    setLoadingClientDocs(true);
    fetch(`/api/projects/${project.id}/client-invoices`)
      .then(r => r.json())
      .then(setClientDocs)
      .catch(() => setClientDocs([]))
      .finally(() => setLoadingClientDocs(false));
  }, [project.clientName, project.id]);

  useEffect(() => { refetchClientDocs(); }, [refetchClientDocs]);

  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) refetchClientDocs(); };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [refetchClientDocs]);

  async function deleteProject() {
    setDeleting(true);
    const { ok } = await fetchJSON(`/api/projects/${project.id}`, { method: "DELETE" });
    if (ok) router.push("/projects");
    else setDeleting(false);
  }

  async function updateStatus(status: string) {
    setSavingStatus(true);
    const { ok } = await fetchJSON(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (ok) { setProject(p => ({ ...p, status })); refreshActivity(); }
    setSavingStatus(false);
    setEditStatus(false);
  }

  const statusColors: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    completed: "bg-blue-100 text-blue-800",
    on_hold: "bg-amber-100 text-amber-800",
    cancelled: "bg-red-100 text-red-800",
  };
  const statusLabel: Record<string, string> = {
    active: "Active", completed: "Completed", on_hold: "On Hold", cancelled: "Cancelled",
  };

  return (
    <div className="flex gap-5 items-start">
      <div className="flex-1 min-w-0">
      {/* Project header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{project.name}</h1>
            {project.description && <p className="text-xs text-gray-400 mt-1 max-w-lg">{project.description}</p>}
            <div className="mt-2">
              <ClientPicker
                projectId={project.id}
                clientName={project.clientName}
                canWrite={canWrite}
                onChange={name => { setProject(p => ({ ...p, clientName: name })); refreshActivity(); }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {editStatus ? (
              <div className="flex items-center gap-1.5">
                {["active", "on_hold", "completed", "cancelled"].map(s => (
                  <button
                    key={s}
                    onClick={() => updateStatus(s)}
                    disabled={savingStatus}
                    className={`text-[10px] font-semibold px-2 py-1 rounded-full transition-colors ${project.status === s ? statusColors[s] : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                  >
                    {statusLabel[s]}
                  </button>
                ))}
                <button onClick={() => setEditStatus(false)} className="text-[10px] text-gray-400 hover:text-gray-600 px-1">✕</button>
              </div>
            ) : (
              <button
                onClick={() => canWrite && setEditStatus(true)}
                className={`inline-flex items-center text-[10px] font-semibold px-2.5 py-1 rounded-full ${statusColors[project.status] ?? "bg-gray-100 text-gray-600"} ${canWrite ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
              >
                {statusLabel[project.status] ?? project.status}
              </button>
            )}
            <button
              onClick={() => setShowInsights(true)}
              title="Analyze project with AI"
              className="flex items-center gap-1.5 text-xs font-semibold text-violet-600 bg-violet-50 hover:bg-violet-100 border border-violet-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                <path d="M8 1l1.5 4.5H14l-3.5 2.5 1.5 4.5L8 10l-4 2.5L5.5 8 2 5.5h4.5L8 1z" fill="currentColor" />
              </svg>
              Analyze
            </button>
            {canWrite && (
              <button
                onClick={() => setShowEditModal(true)}
                title="Edit project details"
                className="p-1.5 text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {canWrite && (
              <button
                onClick={() => setConfirmDelete(true)}
                title="Delete project"
                className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 3.5h10M5.5 3.5V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M11 3.5l-.7 7.7a.6.6 0 0 1-.6.3H4.3a.6.6 0 0 1-.6-.3L3 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3 flex-wrap text-xs text-gray-500">
          {{
            milestone: <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">🏁 Milestone-based</span>,
            fixed:     <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">🏁 Milestone-based</span>,
            tm:        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">⏱ Time &amp; Material</span>,
            ps:        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">🔧 Professional Services</span>,
          }[project.billingType] ?? null}
          {project.contractValue && (
            <span>Contract: <span className="font-semibold text-gray-800">{fmt(project.contractValue, project.currency)}</span></span>
          )}
          {project.startDate && <span>Start: {fmtDate(project.startDate)}</span>}
          {project.endDate && <span>End: {fmtDate(project.endDate)}</span>}
        </div>
      </div>

      {/* Section nav tabs */}
      {(() => {
        const hasResources = project.timesheets.some(t => t.entries.length > 0);
        const tabs = [
          { id: "overview",   label: "Overview"   },
          { id: "team",       label: "Team"       },
          ...(!isNoMilestone ? [{ id: "milestones", label: "Milestones" }] : []),
          ...(isPS ? [{ id: "services", label: "Services" }] : []),
          { id: "invoices",   label: "Invoices"   },
          { id: "timesheets", label: "Timesheets" },
          ...(hasResources ? [{ id: "resources", label: "Resources" }] : []),
          { id: "expenses",   label: "Expenses"   },
          { id: "forecast",   label: "Forecast"   },
        ];
        return (
          <nav className="sticky top-[52px] z-10 bg-white/95 backdrop-blur-sm border-b border-gray-100 mt-3">
            <div className="flex overflow-x-auto">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => scrollToSection(tab.id)}
                  className={`px-4 py-2.5 text-[11px] font-semibold whitespace-nowrap border-b-2 transition-colors ${
                    activeSection === tab.id
                      ? "border-indigo-500 text-indigo-600"
                      : "border-transparent text-gray-400 hover:text-gray-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </nav>
        );
      })()}

      <div className="space-y-5 mt-5">

      {/* Financial summary */}
      <div id="section-overview" style={{ scrollMarginTop: 104 }}>
      <ProfitabilityPanel project={project} fxRates={fxRates} clientDocs={clientDocs} />
      </div>

      {/* AI Insights Drawer */}
      {showInsights && (
        <ProjectInsightsDrawer
          projectId={project.id}
          currency={project.currency}
          onClose={() => setShowInsights(false)}
          onOpenEditModal={() => { setShowInsights(false); setShowEditModal(true); }}
          onIssueInvoice={(amount?: number) => {
            setShowInsights(false);
            if (amount) setIssueInvoiceAmount(amount.toString());
            setShowIssueInvoice(true);
          }}
          onViewSection={(id: string) => {
            setShowInsights(false);
            setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }), 150);
          }}
        />
      )}

      {/* Team */}
      <div id="section-team" style={{ scrollMarginTop: 104 }}>
      <TeamSection
        projectId={project.id}
        teamMembers={project.teamMembers}
        timesheets={project.timesheets}
        currency={project.currency}
        canWrite={canWrite}
        fxRates={fxRates}
        onChange={members => setProject(p => ({ ...p, teamMembers: members }))}
        allocations={allocations}
        onAllocationsChange={handleAllocationChange}
      />
      </div>

      {/* Milestones — milestone-based projects only */}
      {!isNoMilestone && <div id="section-milestones" style={{ scrollMarginTop: 104 }}>
      <MilestonesSection
        projectId={project.id}
        milestones={project.milestones}
        allEntries={project.timesheets.flatMap(t => t.entries)}
        teamMembers={project.teamMembers}
        contractValue={project.contractValue}
        currency={project.currency}
        canWrite={canWrite}
        fxRates={fxRates}
        onChange={ms => setProject(p => ({ ...p, milestones: ms }))}
        clientDocs={clientDocs}
        clientName={project.clientName}
        refetchClientDocs={refetchClientDocs}
        projectStartDate={project.startDate}
      />
      </div>}

      {/* Services — Professional Services projects only */}
      {isPS && (
        <div id="section-services" style={{ scrollMarginTop: 104 }}>
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
            <SectionHeader title="Services" />
            <ServicesSection
              projectId={project.id}
              initialServices={project.services}
              onServicesChange={svcs => setProject(p => ({ ...p, services: svcs }))}
              canWrite={canWrite}
              currency={project.currency}
              timesheetEntries={project.timesheets.flatMap(t =>
                t.entries.map(e => ({
                  id: e.id,
                  serviceId: e.serviceId,
                  employeeName: e.employeeName,
                  taskName: e.taskName,
                  date: e.date,
                  hoursLogged: e.hoursLogged,
                }))
              )}
              teamMembers={project.teamMembers.map(m => ({
                name: m.name,
                costPerHour: m.costPerHour,
                billingRate: m.billingRate,
                currency: m.currency,
              }))}
              fxRates={fxRates}
              clientDocs={clientDocs.filter(d => d.serviceId != null)}
              clientName={project.clientName}
              onIssueInvoice={(svc) => setIssueServiceInvoice(project.services.find(s => s.id === svc.id) ?? null)}
              refetchClientDocs={refetchClientDocs}
            />
            {issueServiceInvoice && (
              <IssueInvoiceModal
                defaultVendor={project.clientName ?? ""}
                defaultCurrency={project.currency}
                defaultAmount={issueServiceInvoice.billingAmount != null ? String(issueServiceInvoice.billingAmount) : undefined}
                projectId={project.id}
                serviceId={issueServiceInvoice.id}
                onClose={() => setIssueServiceInvoice(null)}
                onCreated={() => { setIssueServiceInvoice(null); refetchClientDocs(); }}
              />
            )}
          </div>
        </div>
      )}

      {/* Invoices */}
      <div id="section-invoices" style={{ scrollMarginTop: 104 }}>
      <InvoicesSection
        projectId={project.id}
        clientName={project.clientName}
        milestones={isNoMilestone ? [] : project.milestones}
        services={isPS ? project.services : undefined}
        isPS={isPS}
        currency={project.currency}
        canWrite={canWrite}
        clientDocs={clientDocs}
        loadingClientDocs={loadingClientDocs}
        refetchClientDocs={refetchClientDocs}
        onIssueInvoice={() => { setIssueInvoiceAmount(undefined); setShowIssueInvoice(true); }}
      />
      {showIssueInvoice && (
        <IssueInvoiceModal
          defaultVendor={project.clientName ?? ""}
          defaultCurrency={project.currency}
          defaultAmount={issueInvoiceAmount}
          onClose={() => { setShowIssueInvoice(false); setIssueInvoiceAmount(undefined); }}
          onCreated={() => { setShowIssueInvoice(false); setIssueInvoiceAmount(undefined); refetchClientDocs(); }}
        />
      )}
      </div>

      {/* Timesheets */}
      <div id="section-timesheets" style={{ scrollMarginTop: 104 }}>
      <TimesheetsSection
        projectId={project.id}
        projectName={project.name}
        timesheets={project.timesheets}
        milestones={isNoMilestone ? [] : project.milestones}
        services={isPS ? project.services : undefined}
        canWrite={canWrite}
        onChange={ts => setProject(p => ({ ...p, timesheets: ts }))}
        teamMembers={project.teamMembers}
        onTeamChange={members => setProject(p => ({ ...p, teamMembers: members }))}
        initialAsanaProjectGid={project.asanaProjectGid}
        isTM={isNoMilestone}
        isPS={isPS}
      />
      </div>

      {/* Resource utilization */}
      {project.timesheets.some(t => t.entries.length > 0) && (
        <div id="section-resources" style={{ scrollMarginTop: 104 }}>
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
            <SectionHeader title="Resource Utilization" />
            <ResourceUtilizationChart
              entries={project.timesheets.flatMap(t => t.entries)}
              teamMembers={project.teamMembers}
              milestones={isNoMilestone ? [] : project.milestones}
              services={isPS ? project.services : undefined}
              projectId={project.id}
              allocations={allocations}
              isTM={project.billingType === "tm"}
              isPS={isPS}
            />
          </div>
        </div>
      )}

      {/* Direct expenses */}
      <div id="section-expenses" style={{ scrollMarginTop: 104 }}>
      <ExpensesSection
        projectId={project.id}
        expenses={project.expenses}
        currency={project.currency}
        canWrite={canWrite}
        onChange={ex => setProject(p => ({ ...p, expenses: ex }))}
      />
      </div>

      {/* Forecast */}
      <div id="section-forecast" style={{ scrollMarginTop: 104 }}>
        <div className="px-1 pt-1">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Project Forecast</h2>
          <ForecastTab
            projectId={project.id}
            projectCurrency={project.currency}
            contractValue={project.contractValue}
            endDate={project.endDate}
            startDate={project.startDate}
            teamMembers={project.teamMembers}
            allocations={allocations}
            timesheets={project.timesheets}
            fxRates={fxRates}
            milestones={project.milestones}
          />
        </div>
      </div>

      </div>{/* end sections */}
      </div>{/* end main column */}

      {/* Summary sidebar */}
      <div className="w-80 shrink-0 sticky top-4 hidden lg:block space-y-4">
        <ProjectSummaryCard project={project} clientDocs={clientDocs} fxRates={fxRates} />
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
            onClick={() => setActivityOpen(o => !o)}
          >
            <h2 className="text-sm font-semibold text-gray-900">Activity</h2>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${activityOpen ? "rotate-180" : ""}`}
              viewBox="0 0 16 16" fill="none"
            >
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {activityOpen && <ProjectActivityPanel ref={activityRef} projectId={project.id} />}
        </div>
      </div>

      {/* Edit project modal */}
      {showEditModal && (
        <EditProjectModal
          project={project}
          onClose={() => setShowEditModal(false)}
          onSaved={updated => { setProject(p => ({ ...p, ...updated })); setShowEditModal(false); refreshActivity(); }}
        />
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-red-100 shrink-0">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 5v4M8 11h.01M2.5 13.5h11l-5.5-11-5.5 11z" stroke="#ef4444" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Delete project?</p>
                <p className="text-xs text-gray-400 mt-0.5">This cannot be undone.</p>
              </div>
            </div>
            <p className="text-xs text-gray-600 mb-5">
              <span className="font-semibold text-gray-800">{project.name}</span> and all its milestones, timesheets, expenses, and invoice links will be permanently deleted.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={deleteProject}
                disabled={deleting}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
