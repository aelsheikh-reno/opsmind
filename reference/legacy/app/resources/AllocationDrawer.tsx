"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type ProjectOption = {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

type AllocRecord = {
  id: string;
  projectId: string;
  memberName: string;
  startDate: string;
  endDate: string;
  allocationPercent: number;
  project: { id: string; name: string; status: string; startDate: string | null; endDate: string | null };
};

type EditState = {
  projectId: string;
  startDate: string;
  endDate: string;
  allocationPercent: number;
};

type Props = {
  memberName: string;
  projects: ProjectOption[];
  initialMonth?: string;   // "YYYY-MM" — pre-fills start/end to first/last day of that month
  initialProjectId?: string; // pre-selects the project dropdown
  onClose: () => void;
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function isoToDate(iso: string): string {
  return iso.split("T")[0];
}

function daysBetween(start: string, end: string): number {
  const a = new Date(start);
  const b = new Date(end);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

function monthBounds(ym: string): { startDate: string; endDate: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    startDate: `${ym}-01`,
    endDate: `${ym}-${String(last).padStart(2, "0")}`,
  };
}

export default function AllocationDrawer({ memberName, projects, initialMonth, initialProjectId, onClose }: Props) {
  const router = useRouter();
  const [allocations, setAllocations] = useState<AllocRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectDropOpen, setProjectDropOpen] = useState(false);

  const activeProjects = projects.filter((p) => p.status !== "cancelled");
  const todayISO = new Date().toISOString().split("T")[0];

  const initialDates = initialMonth ? monthBounds(initialMonth) : { startDate: todayISO, endDate: todayISO };

  const [form, setForm] = useState({
    projectId: initialProjectId ?? activeProjects[0]?.id ?? "",
    startDate: initialDates.startDate,
    endDate: initialDates.endDate,
    allocationPercent: 100,
  });

  useEffect(() => {
    setLoading(true);
    fetch(`/api/allocations?memberName=${encodeURIComponent(memberName)}`)
      .then((r) => r.json())
      .then((data: AllocRecord[]) => { setAllocations(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [memberName]);

  function setField<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setEditField<K extends keyof EditState>(key: K, value: EditState[K]) {
    setEditForm((f) => f ? { ...f, [key]: value } : f);
  }

  function startEdit(rec: AllocRecord) {
    setEditingId(rec.id);
    setEditError(null);
    setEditForm({
      projectId: rec.projectId,
      startDate: isoToDate(rec.startDate),
      endDate: isoToDate(rec.endDate),
      allocationPercent: rec.allocationPercent,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
    setEditError(null);
  }

  async function handleAdd() {
    if (!form.projectId || !form.startDate || !form.endDate) {
      setError("Select a project and both dates.");
      return;
    }
    if (form.startDate > form.endDate) {
      setError("Start date must be before or equal to end date.");
      return;
    }
    setError(null);
    setSaving(true);
    const res = await fetch("/api/allocations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: form.projectId,
        memberName,
        startDate: form.startDate,
        endDate: form.endDate,
        allocationPercent: form.allocationPercent,
      }),
    });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "Failed to save.");
      setSaving(false);
      return;
    }
    const updated: AllocRecord[] = await fetch(`/api/allocations?memberName=${encodeURIComponent(memberName)}`).then((r) => r.json());
    setAllocations(updated);
    setSaving(false);
    router.refresh();
  }

  async function handleSaveEdit(id: string) {
    if (!editForm) return;
    if (editForm.startDate > editForm.endDate) {
      setEditError("Start date must be before or equal to end date.");
      return;
    }
    setEditError(null);
    setEditSaving(true);
    const res = await fetch(`/api/allocations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: editForm.projectId,
        startDate: editForm.startDate,
        endDate: editForm.endDate,
        allocationPercent: editForm.allocationPercent,
      }),
    });
    if (!res.ok) {
      const d = await res.json();
      setEditError(d.error ?? "Failed to save.");
      setEditSaving(false);
      return;
    }
    const updated: AllocRecord = await res.json();
    setAllocations((prev) => prev.map((a) => a.id === id ? updated : a));
    setEditingId(null);
    setEditForm(null);
    setEditSaving(false);
    router.refresh();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    await fetch(`/api/allocations/${id}`, { method: "DELETE" });
    setAllocations((prev) => prev.filter((a) => a.id !== id));
    setDeletingId(null);
    if (editingId === id) cancelEdit();
    router.refresh();
  }

  // Sort newest-first, then group by project.
  // If a specific month was clicked, records overlapping that month sort to the top.
  const sorted = [...allocations].sort((a, b) => {
    if (initialMonth) {
      const aOverlaps = a.startDate.slice(0, 7) <= initialMonth && a.endDate.slice(0, 7) >= initialMonth;
      const bOverlaps = b.startDate.slice(0, 7) <= initialMonth && b.endDate.slice(0, 7) >= initialMonth;
      if (aOverlaps && !bOverlaps) return -1;
      if (!aOverlaps && bOverlaps) return 1;
    }
    return b.startDate.localeCompare(a.startDate); // newest first
  });

  const byProject = new Map<string, AllocRecord[]>();
  for (const a of sorted) {
    if (!byProject.has(a.projectId)) byProject.set(a.projectId, []);
    byProject.get(a.projectId)!.push(a);
  }

  const selectedProject = activeProjects.find((p) => p.id === form.projectId);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />

      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Allocate team member</h2>
            <p className="text-sm text-gray-500 mt-0.5">{memberName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Add new allocation */}
          <div className="px-6 py-5 border-b border-surface-border">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Assign to project</p>

            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Project</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder={selectedProject ? selectedProject.name : "Search projects…"}
                  value={projectSearch}
                  onFocus={() => setProjectDropOpen(true)}
                  onChange={(e) => { setProjectSearch(e.target.value); setProjectDropOpen(true); }}
                  onBlur={() => setTimeout(() => setProjectDropOpen(false), 150)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder:text-gray-400"
                />
                {projectDropOpen && (
                  <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                    {activeProjects
                      .filter(p => p.name.toLowerCase().includes(projectSearch.toLowerCase()))
                      .map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onMouseDown={() => {
                            setField("projectId", p.id);
                            setProjectSearch("");
                            setProjectDropOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors ${form.projectId === p.id ? "font-semibold text-indigo-700 bg-indigo-50/60" : "text-gray-700"}`}
                        >
                          {p.name}
                        </button>
                      ))}
                    {activeProjects.filter(p => p.name.toLowerCase().includes(projectSearch.toLowerCase())).length === 0 && (
                      <p className="px-3 py-2 text-sm text-gray-400">No projects found</p>
                    )}
                  </div>
                )}
              </div>
              {selectedProject && (selectedProject.startDate || selectedProject.endDate) && (
                <p className="text-[11px] text-gray-400 mt-1.5 flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <rect x="1" y="1.5" width="8" height="7" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
                    <path d="M3.5 1.5V0.5m3 1V0.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                    <path d="M1 4h8" stroke="currentColor" strokeWidth="0.8" />
                  </svg>
                  {selectedProject.startDate ? fmtDate(selectedProject.startDate) : "?"} → {selectedProject.endDate ? fmtDate(selectedProject.endDate) : "ongoing"}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Start date</label>
                <input
                  type="date" value={form.startDate}
                  onChange={(e) => {
                    setField("startDate", e.target.value);
                    if (!form.endDate || e.target.value > form.endDate) setField("endDate", e.target.value);
                  }}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">End date</label>
                <input
                  type="date" value={form.endDate} min={form.startDate}
                  onChange={(e) => setField("endDate", e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            </div>

            {form.startDate && form.endDate && form.startDate <= form.endDate && (
              <p className="text-[11px] text-gray-400 mb-3">
                {fmtDate(form.startDate)} → {fmtDate(form.endDate)} · {daysBetween(form.startDate, form.endDate)} day{daysBetween(form.startDate, form.endDate) !== 1 ? "s" : ""}
              </p>
            )}

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Allocation — {form.allocationPercent}%</label>
              <div className="flex items-center gap-3">
                <input type="range" min={10} max={100} step={10} value={form.allocationPercent}
                  onChange={(e) => setField("allocationPercent", Number(e.target.value))}
                  className="flex-1 accent-indigo-600" />
                <input type="number" min={1} max={100} value={form.allocationPercent}
                  onChange={(e) => setField("allocationPercent", Math.min(100, Math.max(1, Number(e.target.value))))}
                  className="w-16 text-sm text-center border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
            </div>

            {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-3">{error}</p>}

            <button
              onClick={handleAdd}
              disabled={saving || !form.projectId || !form.startDate || !form.endDate}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              {saving ? (
                <><svg className="animate-spin" width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="white" strokeWidth="1.5" strokeDasharray="8 6" /></svg>Saving…</>
              ) : "Add allocation"}
            </button>
          </div>

          {/* Existing allocations */}
          <div className="px-6 py-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Current allocations</p>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="8 6" />
                </svg>
                Loading…
              </div>
            ) : allocations.length === 0 ? (
              <p className="text-sm text-gray-400 py-4">No allocations yet.</p>
            ) : (
              <div className="space-y-5">
                {Array.from(byProject.entries()).map(([projectId, records]) => {
                  const projName = records[0].project.name;
                  const projStart = records[0].project.startDate;
                  const projEnd = records[0].project.endDate;
                  return (
                    <div key={projectId}>
                      <div className="flex items-baseline gap-2 mb-2">
                        <span className="text-sm font-semibold text-gray-800">{projName}</span>
                        {(projStart || projEnd) && (
                          <span className="text-[10px] text-gray-400">
                            {fmtDate(projStart)} → {fmtDate(projEnd) || "ongoing"}
                          </span>
                        )}
                      </div>

                      <div className="space-y-2">
                        {records.map((rec) => {
                          const isEditing = editingId === rec.id;
                          const isDeleting = deletingId === rec.id;
                          const days = daysBetween(isoToDate(rec.startDate), isoToDate(rec.endDate));

                          if (isEditing && editForm) {
                            const editDays = editForm.startDate && editForm.endDate && editForm.startDate <= editForm.endDate
                              ? daysBetween(editForm.startDate, editForm.endDate) : null;
                            return (
                              <div key={rec.id} className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-3">
                                {/* Project selector */}
                                <div>
                                  <label className="block text-[10px] font-medium text-gray-500 mb-1">Project</label>
                                  <select
                                    value={editForm.projectId}
                                    onChange={(e) => setEditField("projectId", e.target.value)}
                                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                  >
                                    {activeProjects.map((p) => (
                                      <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                  </select>
                                </div>
                                {/* Date pickers */}
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[10px] font-medium text-gray-500 mb-1">Start date</label>
                                    <input
                                      type="date" value={editForm.startDate}
                                      onChange={(e) => {
                                        setEditField("startDate", e.target.value);
                                        if (e.target.value > editForm.endDate) setEditField("endDate", e.target.value);
                                      }}
                                      className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-medium text-gray-500 mb-1">End date</label>
                                    <input
                                      type="date" value={editForm.endDate} min={editForm.startDate}
                                      onChange={(e) => setEditField("endDate", e.target.value)}
                                      className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                                    />
                                  </div>
                                </div>

                                {editDays != null && (
                                  <p className="text-[10px] text-gray-400">
                                    {fmtDate(editForm.startDate)} → {fmtDate(editForm.endDate)} · {editDays} day{editDays !== 1 ? "s" : ""}
                                  </p>
                                )}

                                {/* % slider */}
                                <div>
                                  <label className="block text-[10px] font-medium text-gray-500 mb-1">
                                    Allocation — {editForm.allocationPercent}%
                                  </label>
                                  <div className="flex items-center gap-2">
                                    <input type="range" min={10} max={100} step={10} value={editForm.allocationPercent}
                                      onChange={(e) => setEditField("allocationPercent", Number(e.target.value))}
                                      className="flex-1 accent-indigo-600" />
                                    <input type="number" min={1} max={100} value={editForm.allocationPercent}
                                      onChange={(e) => setEditField("allocationPercent", Math.min(100, Math.max(1, Number(e.target.value))))}
                                      className="w-14 text-xs text-center border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white" />
                                  </div>
                                </div>

                                {editError && <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded-lg">{editError}</p>}

                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleSaveEdit(rec.id)}
                                    disabled={editSaving}
                                    className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                                  >
                                    {editSaving ? (
                                      <><svg className="animate-spin" width="11" height="11" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="white" strokeWidth="1.5" strokeDasharray="8 6" /></svg>Saving…</>
                                    ) : (
                                      <><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>Save changes</>
                                    )}
                                  </button>
                                  <button
                                    onClick={cancelEdit}
                                    disabled={editSaving}
                                    className="px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 bg-white border border-gray-200 rounded-lg transition-colors"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleDelete(rec.id)}
                                    disabled={isDeleting || editSaving}
                                    className="p-2 text-gray-400 hover:text-red-500 bg-white border border-gray-200 rounded-lg transition-colors"
                                    title="Delete allocation"
                                  >
                                    {isDeleting ? (
                                      <svg className="animate-spin" width="12" height="12" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8 6" /></svg>
                                    ) : (
                                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M5 3V2h2v1M4 3v6h4V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                    )}
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          // Read-only row
                          const recEndYM = rec.endDate.slice(0, 7);
                          const isPast = recEndYM < todayISO.slice(0, 7);
                          const isClickedMonth = !!initialMonth &&
                            rec.startDate.slice(0, 7) <= initialMonth &&
                            rec.endDate.slice(0, 7) >= initialMonth;

                          return (
                            <div
                              key={rec.id}
                              className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors group ${
                                isClickedMonth
                                  ? "bg-indigo-50 border border-indigo-100 hover:bg-indigo-100"
                                  : isPast
                                  ? "bg-gray-50/60 opacity-60 hover:opacity-100 hover:bg-gray-100"
                                  : "bg-gray-50 hover:bg-gray-100"
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-12 h-1.5 rounded-full bg-gray-200 overflow-hidden shrink-0">
                                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${rec.allocationPercent}%` }} />
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs text-gray-700 font-medium">
                                    {fmtDate(isoToDate(rec.startDate))} → {fmtDate(isoToDate(rec.endDate))}
                                    {isPast && <span className="ml-1.5 text-[9px] font-semibold text-gray-400 uppercase tracking-wide">past</span>}
                                  </div>
                                  <div className="text-[10px] text-gray-400">{days} day{days !== 1 ? "s" : ""}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className={`text-xs font-semibold ${isClickedMonth ? "text-indigo-700" : "text-gray-700"}`}>{rec.allocationPercent}%</span>
                                {/* Edit button */}
                                <button
                                  onClick={() => startEdit(rec)}
                                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-500 transition-all p-1 rounded"
                                  title="Edit allocation"
                                >
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <path d="M8.5 1.5l2 2L3 11H1v-2L8.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </button>
                                {/* Delete button */}
                                <button
                                  onClick={() => handleDelete(rec.id)}
                                  disabled={isDeleting}
                                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all p-1 rounded"
                                  title="Delete allocation"
                                >
                                  {isDeleting ? (
                                    <svg className="animate-spin" width="12" height="12" viewBox="0 0 14 14" fill="none">
                                      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8 6" />
                                    </svg>
                                  ) : (
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                      <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                                    </svg>
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
