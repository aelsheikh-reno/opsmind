"use client";

import { useState } from "react";

type Activity = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  order: number;
};

type Service = {
  id: string;
  name: string;
  description: string | null;
  billingAmount: number | null;
  paymentTerms: string | null;
  order: number;
  activities: Activity[];
};

type TimesheetEntry = {
  id: string;
  serviceId: string | null;
  employeeName: string;
  taskName: string | null;
  date: string | null;
  hoursLogged: number;
};

type TeamMember = {
  name: string;
  costPerHour: number | null;
  billingRate: number | null;
  currency: string;
};

type ClientDocument = {
  id: string;
  filename: string | null;
  referenceNumber: string | null;
  amount: number | null;
  currency: string | null;
  issueDate: string | null;
  isPaid: boolean;
  paidAt: string | null;
  serviceId: string | null;
};

const STATUS_CYCLE: Record<string, string> = {
  pending: "in_progress",
  in_progress: "completed",
  completed: "pending",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-gray-100 text-gray-500",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
};

function fmtAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function fmtHours(h: number) {
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AE", { day: "2-digit", month: "short" });
}

function toProjectCurrency(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to || !amount) return amount;
  const usd = from === "USD" ? amount : amount / (rates[from] ?? 1);
  return to === "USD" ? usd : usd * (rates[to] ?? 1);
}

export default function ServicesSection({
  projectId,
  initialServices,
  canWrite,
  currency,
  timesheetEntries = [],
  teamMembers = [],
  fxRates = {},
  clientDocs = [],
  clientName,
  onIssueInvoice,
  refetchClientDocs,
  onServicesChange,
}: {
  projectId: string;
  initialServices: Service[];
  canWrite: boolean;
  currency: string;
  timesheetEntries?: TimesheetEntry[];
  teamMembers?: TeamMember[];
  fxRates?: Record<string, number>;
  clientDocs?: ClientDocument[];
  clientName?: string | null;
  onIssueInvoice?: (service: { id: string; name: string; billingAmount: number | null }) => void;
  refetchClientDocs?: () => void;
  onServicesChange?: (services: Service[]) => void;
}) {
  const [services, setServices] = useState<Service[]>(initialServices);
  function updateServices(updater: (prev: Service[]) => Service[]) {
    setServices(prev => {
      const next = updater(prev);
      onServicesChange?.(next);
      return next;
    });
  }
  const [expandedId, setExpandedId] = useState<string | null>(
    initialServices.length > 0 ? initialServices[0].id : null
  );
  // Per-service activities section collapsed/expanded (default open)
  const [activitiesCollapsed, setActivitiesCollapsed] = useState<Set<string>>(new Set());

  // Add service
  const [showAddService, setShowAddService] = useState(false);
  const [addServiceForm, setAddServiceForm] = useState({ name: "", description: "", billingAmount: "" });
  const [addingService, setAddingService] = useState(false);

  // Edit service
  const [editServiceId, setEditServiceId] = useState<string | null>(null);
  const [editServiceForm, setEditServiceForm] = useState({ name: "", description: "", billingAmount: "" });
  const [savingService, setSavingService] = useState(false);

  // Edit activity
  const [editActivityId, setEditActivityId] = useState<string | null>(null);
  const [editActivityName, setEditActivityName] = useState("");
  const [savingActivity, setSavingActivity] = useState(false);

  // Document unlinking
  const [assigningDocId, setAssigningDocId] = useState<string | null>(null);

  // Rate lookup by member name
  const rateByName = new Map(teamMembers.map(m => [m.name.toLowerCase(), m]));

  function getMemberRates(name: string) {
    const m = rateByName.get(name.toLowerCase());
    const memberCur = m?.currency ?? currency;
    const cost = m?.costPerHour != null ? toProjectCurrency(m.costPerHour, memberCur, currency, fxRates) : 0;
    const bill = m?.billingRate != null ? toProjectCurrency(m.billingRate, memberCur, currency, fxRates) : 0;
    return { cost, bill };
  }

  async function handleAddService() {
    if (!addServiceForm.name.trim()) return;
    setAddingService(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addServiceForm.name,
          description: addServiceForm.description || null,
          billingAmount: addServiceForm.billingAmount || null,
        }),
      });
      if (res.ok) {
        const svc = await res.json();
        updateServices(s => [...s, svc]);
        setExpandedId(svc.id);
        setAddServiceForm({ name: "", description: "", billingAmount: "" });
        setShowAddService(false);
      }
    } finally {
      setAddingService(false);
    }
  }

  async function handleSaveService(serviceId: string) {
    setSavingService(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/services/${serviceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editServiceForm.name,
          description: editServiceForm.description || null,
          billingAmount: editServiceForm.billingAmount || null,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        updateServices(s => s.map(svc => svc.id === serviceId ? updated : svc));
        setEditServiceId(null);
      }
    } finally {
      setSavingService(false);
    }
  }

  async function handleDeleteService(serviceId: string) {
    if (!confirm("Delete this service and all its activities?")) return;
    await fetch(`/api/projects/${projectId}/services/${serviceId}`, { method: "DELETE" });
    updateServices(s => s.filter(svc => svc.id !== serviceId));
    if (expandedId === serviceId) setExpandedId(null);
  }

  async function handleCycleStatus(serviceId: string, activity: Activity) {
    const nextStatus = STATUS_CYCLE[activity.status] ?? "pending";
    const res = await fetch(
      `/api/projects/${projectId}/services/${serviceId}/activities/${activity.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      }
    );
    if (res.ok) {
      updateServices(s => s.map(svc =>
        svc.id === serviceId
          ? { ...svc, activities: svc.activities.map(a => a.id === activity.id ? { ...a, status: nextStatus } : a) }
          : svc
      ));
    }
  }

  async function handleSaveActivity(serviceId: string, activityId: string) {
    setSavingActivity(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/services/${serviceId}/activities/${activityId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: editActivityName }),
        }
      );
      if (res.ok) {
        const updated = await res.json();
        updateServices(s => s.map(svc =>
          svc.id === serviceId
            ? { ...svc, activities: svc.activities.map(a => a.id === activityId ? updated : a) }
            : svc
        ));
        setEditActivityId(null);
      }
    } finally {
      setSavingActivity(false);
    }
  }

  async function handleDeleteActivity(serviceId: string, activityId: string) {
    await fetch(`/api/projects/${projectId}/services/${serviceId}/activities/${activityId}`, { method: "DELETE" });
    updateServices(s => s.map(svc =>
      svc.id === serviceId
        ? { ...svc, activities: svc.activities.filter(a => a.id !== activityId) }
        : svc
    ));
  }

  async function unlinkDoc(docId: string) {
    setAssigningDocId(docId);
    try {
      await fetch(`/api/projects/${projectId}/document-links?documentId=${docId}`, { method: "DELETE" });
      refetchClientDocs?.();
    } finally {
      setAssigningDocId(null);
    }
  }

  const totalBilling = services.reduce((sum, s) => sum + (s.billingAmount ?? 0), 0);
  const totalActivities = services.reduce((sum, s) => sum + s.activities.length, 0);
  const completedActivities = services.reduce(
    (sum, s) => sum + s.activities.filter(a => a.status === "completed").length,
    0
  );
  const totalLoggedHours = timesheetEntries
    .filter(e => services.some(s => s.id === e.serviceId))
    .reduce((sum, e) => sum + e.hoursLogged, 0);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      {services.length > 0 && (
        <div className="flex items-center gap-6 px-4 py-3 bg-gray-50 rounded-xl border border-gray-100 text-xs">
          <div>
            <span className="text-gray-400">Services</span>
            <span className="ml-2 font-semibold text-gray-700">{services.length}</span>
          </div>
          {totalBilling > 0 && (
            <div>
              <span className="text-gray-400">Billable</span>
              <span className="ml-2 font-semibold text-gray-700">{fmtAmount(totalBilling, currency)}</span>
            </div>
          )}
          {totalActivities > 0 && (
            <div>
              <span className="text-gray-400">Activities</span>
              <span className="ml-2 font-semibold text-gray-700">
                {completedActivities}/{totalActivities} completed
              </span>
            </div>
          )}
          {totalLoggedHours > 0 && (
            <div>
              <span className="text-gray-400">Logged</span>
              <span className="ml-2 font-semibold text-gray-700">{fmtHours(totalLoggedHours)}</span>
            </div>
          )}
        </div>
      )}

      {/* Service cards */}
      {services.map(svc => {
        const isExpanded = expandedId === svc.id;
        const isEditing = editServiceId === svc.id;
        const doneCount = svc.activities.filter(a => a.status === "completed").length;
        const progressPct = svc.activities.length > 0
          ? Math.round((doneCount / svc.activities.length) * 100)
          : null;
        const serviceEntries = timesheetEntries
          .filter(e => e.serviceId === svc.id)
          .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
        const svcHours = serviceEntries.reduce((s, e) => s + e.hoursLogged, 0);
        const svcDocs = clientDocs.filter(d => d.serviceId === svc.id);
        const totalInvoiced = svcDocs
          .filter(d => d.amount != null)
          .reduce((sum, d) => sum + (d.amount ?? 0), 0);

        // Cost vs billable from logged timesheet entries
        let svcCost = 0;
        let svcBillable = 0;
        for (const entry of serviceEntries) {
          const { cost, bill } = getMemberRates(entry.employeeName);
          svcCost += entry.hoursLogged * cost;
          svcBillable += entry.hoursLogged * bill;
        }
        const margin = svc.billingAmount != null && svc.billingAmount > 0 && svcCost > 0
          ? ((svc.billingAmount - svcCost) / svc.billingAmount) * 100
          : null;

        const activitiesOpen = !activitiesCollapsed.has(svc.id);

        return (
          <div key={svc.id} className="rounded-xl border border-gray-200 overflow-hidden bg-white">
            {/* Service header */}
            <div
              className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50/80 transition-colors"
              onClick={() => !isEditing && setExpandedId(isExpanded ? null : svc.id)}
            >
              {/* Expand chevron */}
              <svg
                width="12" height="12" viewBox="0 0 12 12" fill="none"
                className={`shrink-0 mt-1 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              >
                <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>

              {isEditing ? (
                <div className="flex-1 space-y-2" onClick={e => e.stopPropagation()}>
                  <input
                    className="w-full text-sm font-semibold border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300"
                    value={editServiceForm.name}
                    onChange={e => setEditServiceForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Service name"
                  />
                  <textarea
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300 resize-none"
                    rows={2}
                    value={editServiceForm.description}
                    onChange={e => setEditServiceForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Description (optional)"
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="w-36 text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-indigo-300"
                    value={editServiceForm.billingAmount}
                    onChange={e => setEditServiceForm(f => ({ ...f, billingAmount: e.target.value }))}
                    placeholder="Billing amount"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveService(svc.id)}
                      disabled={savingService || !editServiceForm.name.trim()}
                      className="px-3 py-1 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-60"
                    >
                      {savingService ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => setEditServiceId(null)}
                      className="px-3 py-1 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-gray-800">{svc.name}</span>
                    {svc.activities.length > 0 && (
                      <span className="text-[10px] text-gray-400 shrink-0">
                        {doneCount}/{svc.activities.length} done
                      </span>
                    )}
                  </div>
                  {svc.description && (
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{svc.description}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {svc.billingAmount != null && (
                      <span className="inline-flex items-center text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                        {fmtAmount(svc.billingAmount, currency)}
                      </span>
                    )}
                    {totalInvoiced > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">
                        <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M3.5 4.5h5M3.5 6.5h3.5M3.5 8.5h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
                        {fmtAmount(totalInvoiced, currency)} invoiced
                      </span>
                    )}
                    {svcHours > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-700 bg-violet-50 border border-violet-100 rounded-full px-2 py-0.5">
                        <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/><path d="M6 3.5v2.75l1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                        {fmtHours(svcHours)} logged
                      </span>
                    )}
                    {progressPct != null && (
                      <div className="flex items-center gap-1.5">
                        <div className="w-20 h-1 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${progressPct === 100 ? "bg-green-500" : "bg-indigo-400"}`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <span className={`text-[10px] font-semibold ${progressPct === 100 ? "text-green-600" : "text-gray-500"}`}>
                          {progressPct}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              {canWrite && !isEditing && (
                <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  {onIssueInvoice && clientName && (
                    <button
                      onClick={() => onIssueInvoice(svc)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                      title="Issue invoice"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                        <path d="M4 6h4M6 4v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setEditServiceId(svc.id);
                      setEditServiceForm({
                        name: svc.name,
                        description: svc.description ?? "",
                        billingAmount: svc.billingAmount != null ? String(svc.billingAmount) : "",
                      });
                      setExpandedId(svc.id);
                    }}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                    title="Edit service"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M8.5 1.5l2 2L4 10l-2.5.5.5-2.5L8.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDeleteService(svc.id)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Delete service"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 3h8M5 3V1.5h2V3M4.5 5v4M7.5 5v4M3 3l.5 7h5l.5-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {/* Expanded body */}
            {isExpanded && !isEditing && (
              <div className="border-t border-gray-100 bg-gray-50/50">

                {/* Cost vs billable KPI row */}
                {(svcCost > 0 || svcBillable > 0) && (
                  <div className="px-4 pt-3 pb-2 flex items-center gap-4 text-xs border-b border-gray-100">
                    <div>
                      <span className="text-gray-400">Labor cost</span>
                      <span className="ml-1.5 font-semibold text-gray-700">{fmtAmount(svcCost, currency)}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Billable</span>
                      <span className="ml-1.5 font-semibold text-gray-700">{fmtAmount(svcBillable, currency)}</span>
                    </div>
                    {margin !== null && (
                      <div className={`ml-auto font-semibold text-[10px] px-2 py-0.5 rounded-full ${margin >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                        {margin >= 0 ? "+" : ""}{margin.toFixed(1)}% labor vs billing
                      </div>
                    )}
                  </div>
                )}

                <div className="px-4 py-3 space-y-2">
                  {/* Activities — collapsible */}
                  {svc.activities.length > 0 && (
                    <div>
                      <button
                        className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-600 transition-colors mb-2 w-full"
                        onClick={() => setActivitiesCollapsed(prev => {
                          const next = new Set(prev);
                          if (next.has(svc.id)) next.delete(svc.id);
                          else next.add(svc.id);
                          return next;
                        })}
                      >
                        <svg
                          width="10" height="10" viewBox="0 0 12 12" fill="none"
                          className={`transition-transform ${activitiesOpen ? "rotate-90" : ""}`}
                        >
                          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Activities · {doneCount}/{svc.activities.length}
                      </button>

                      {activitiesOpen && (
                        <div className="space-y-2">
                          {svc.activities.map(act => {
                            const isEditingAct = editActivityId === act.id;
                            return (
                              <div key={act.id} className="flex items-center gap-2 group">
                                <button
                                  onClick={() => canWrite && handleCycleStatus(svc.id, act)}
                                  className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center border transition-colors ${
                                    act.status === "completed"
                                      ? "bg-green-500 border-green-500"
                                      : act.status === "in_progress"
                                      ? "bg-blue-500 border-blue-500"
                                      : "bg-white border-gray-300 hover:border-indigo-400"
                                  } ${canWrite ? "cursor-pointer" : "cursor-default"}`}
                                  title={canWrite ? `Click to change: ${STATUS_LABEL[act.status]}` : STATUS_LABEL[act.status]}
                                  disabled={!canWrite}
                                >
                                  {act.status === "completed" && (
                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                      <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  )}
                                  {act.status === "in_progress" && (
                                    <div className="w-2 h-2 rounded-full bg-white" />
                                  )}
                                </button>

                                {isEditingAct ? (
                                  <div className="flex-1 flex items-center gap-2">
                                    <input
                                      className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-300"
                                      value={editActivityName}
                                      onChange={e => setEditActivityName(e.target.value)}
                                      onKeyDown={e => { if (e.key === "Enter") handleSaveActivity(svc.id, act.id); if (e.key === "Escape") setEditActivityId(null); }}
                                      autoFocus
                                    />
                                    <button onClick={() => handleSaveActivity(svc.id, act.id)} disabled={savingActivity} className="px-2 py-1 text-[10px] font-semibold text-white bg-indigo-600 rounded-md">Save</button>
                                    <button onClick={() => setEditActivityId(null)} className="px-2 py-1 text-[10px] font-semibold text-gray-600 bg-gray-100 rounded-md">Cancel</button>
                                  </div>
                                ) : (
                                  <>
                                    <span className={`flex-1 text-xs ${act.status === "completed" ? "line-through text-gray-400" : "text-gray-700"}`}>
                                      {act.name}
                                    </span>
                                    <span className={`shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_STYLE[act.status]}`}>
                                      {STATUS_LABEL[act.status]}
                                    </span>
                                    {canWrite && (
                                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                          onClick={() => { setEditActivityId(act.id); setEditActivityName(act.name); }}
                                          className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                        >
                                          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                                            <path d="M8.5 1.5l2 2L4 10l-2.5.5.5-2.5L8.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                                          </svg>
                                        </button>
                                        <button
                                          onClick={() => handleDeleteActivity(svc.id, act.id)}
                                          className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                        >
                                          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                                            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                                          </svg>
                                        </button>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {svc.activities.length === 0 && svcDocs.length === 0 && serviceEntries.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-2">No activities yet.</p>
                  )}

                  {/* Linked invoices */}
                  {svcDocs.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200/70">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M3.5 4.5h5M3.5 6.5h3.5M3.5 8.5h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
                        Invoices
                      </p>
                      <div className="space-y-1.5">
                        {svcDocs.map(doc => (
                          <div key={doc.id} className="flex items-center gap-2">
                            <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                              {doc.amount != null && (
                                <span className="text-xs font-semibold text-gray-700 shrink-0">
                                  {fmtAmount(doc.amount, doc.currency ?? currency)}
                                </span>
                              )}
                              {doc.isPaid
                                ? <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 shrink-0">Paid</span>
                                : <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 shrink-0">Unpaid</span>
                              }
                              {doc.referenceNumber && (
                                <a href={`/records/${doc.id}`} className="text-[10px] text-indigo-500 hover:text-indigo-700 hover:underline font-medium transition-colors truncate" onClick={e => e.stopPropagation()}>
                                  {doc.referenceNumber}
                                </a>
                              )}
                              {!doc.referenceNumber && doc.filename && (
                                <a href={`/records/${doc.id}`} className="text-[10px] text-gray-400 hover:text-indigo-500 hover:underline truncate transition-colors" onClick={e => e.stopPropagation()}>
                                  {doc.filename}
                                </a>
                              )}
                              {doc.issueDate && (
                                <span className="text-[10px] text-gray-400 shrink-0">{fmtDate(doc.issueDate)}</span>
                              )}
                            </div>
                            {canWrite && (
                              <button
                                onClick={() => unlinkDoc(doc.id)}
                                disabled={assigningDocId === doc.id}
                                className="shrink-0 p-1 rounded text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors disabled:opacity-40"
                                title="Unlink invoice"
                              >
                                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                                  <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                                </svg>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Logged time */}
                  {serviceEntries.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200/70">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/><path d="M6 3.5v2.75l1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                        Logged time · {fmtHours(svcHours)}
                      </p>
                      <div className="space-y-1">
                        {serviceEntries.map(entry => (
                          <div key={entry.id} className="flex items-center gap-2 text-xs">
                            <span className="font-medium text-gray-700 shrink-0 w-28 truncate" title={entry.employeeName}>
                              {entry.employeeName}
                            </span>
                            <span className="flex-1 text-gray-400 truncate min-w-0" title={entry.taskName ?? undefined}>
                              {entry.taskName ?? <span className="text-gray-300">—</span>}
                            </span>
                            <span className="text-[10px] text-gray-400 shrink-0 w-14 text-right">
                              {fmtDate(entry.date)}
                            </span>
                            <span className="text-[10px] font-semibold text-violet-700 shrink-0 w-10 text-right tabular-nums">
                              {fmtHours(entry.hoursLogged)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Empty state */}
      {services.length === 0 && !showAddService && (
        <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-sm text-gray-400 mb-1">No services defined yet</p>
          <p className="text-xs text-gray-300">Group your project activities into billable services</p>
        </div>
      )}

      {/* Add service form */}
      {showAddService && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-600">New service</p>
          <input
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300 bg-white"
            value={addServiceForm.name}
            onChange={e => setAddServiceForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Service name *"
            autoFocus
          />
          <textarea
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300 resize-none bg-white"
            rows={2}
            value={addServiceForm.description}
            onChange={e => setAddServiceForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Description (optional)"
          />
          <div className="relative w-40">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{currency}</span>
            <input
              type="number"
              min="0"
              step="any"
              className="w-full text-xs border border-gray-200 rounded-lg pl-10 pr-3 py-2 outline-none focus:ring-1 focus:ring-indigo-300 bg-white"
              value={addServiceForm.billingAmount}
              onChange={e => setAddServiceForm(f => ({ ...f, billingAmount: e.target.value }))}
              placeholder="Billing amount"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddService}
              disabled={addingService || !addServiceForm.name.trim()}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-60"
            >
              {addingService ? "Adding…" : "Add service"}
            </button>
            <button
              onClick={() => { setShowAddService(false); setAddServiceForm({ name: "", description: "", billingAmount: "" }); }}
              className="px-4 py-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Add service button */}
      {canWrite && !showAddService && (
        <button
          onClick={() => setShowAddService(true)}
          className="flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          Add service
        </button>
      )}
    </div>
  );
}
