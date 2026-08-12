"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { PROJECT_COLORS } from "@/lib/projectColors";
import type { ProjectSummary } from "./ProjectsClient";
import type { ParsedRow } from "@/lib/timesheetParser";

type DetectedProject = {
  name: string;
  exists: boolean;
  fuzzyMatch: boolean;
  fuzzyScore: number;
  existingProjectId: string | null;
  existingProjectName: string | null;
  existingProjectStatus: string | null;
};

type BillingType = "milestone" | "tm" | "ps";

type ProjectRow = DetectedProject & {
  billingType: BillingType;
  selected: boolean;
  useExisting: boolean; // for fuzzyMatch rows: true = link to existing, false = create new
};

type MonthGroup = {
  ym: string;           // YYYY-MM
  entries: ParsedRow[];
  totalHours: number;
};

type AssignItem = {
  projectName: string;
  projectId: string;
  billingType: string;
  milestoneName: string; // non-empty → create milestone and assign all entries to it
  months: MonthGroup[];  // one group per calendar month found in entries
  totalEntries: number;
  totalHours: number;
  expanded: boolean;
};

function inferMonth(entries: ParsedRow[]): string {
  const counts: Record<string, number> = {};
  for (const e of entries) {
    if (e.date) { const m = e.date.slice(0, 7); counts[m] = (counts[m] ?? 0) + 1; }
  }
  const months = Object.keys(counts);
  if (!months.length) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  return months.reduce((a, b) => counts[a] >= counts[b] ? a : b);
}

function groupByMonth(entries: ParsedRow[]): MonthGroup[] {
  const fallback = inferMonth(entries);
  const byMonth = new Map<string, ParsedRow[]>();
  for (const e of entries) {
    const ym = e.date ? e.date.slice(0, 7) : fallback;
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym)!.push(e);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, ents]) => ({
      ym,
      entries: ents,
      totalHours: Math.round(ents.reduce((s, e) => s + e.hoursLogged, 0) * 10) / 10,
    }));
}

function formatYM(ym: string): string {
  const [y, m] = ym.split("-");
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${MONTHS[parseInt(m, 10) - 1] ?? m} ${y}`;
}

const BILLING_OPTIONS: { value: BillingType; label: string; desc: string }[] = [
  { value: "milestone", label: "Milestone", desc: "Scoped, pay on milestone" },
  { value: "tm",        label: "T&M",       desc: "Hours × billing rate"   },
  { value: "ps",        label: "PS",        desc: "Activity-based services" },
];

const STATUS_LABELS: Record<string, string> = {
  active: "Active", completed: "Completed", on_hold: "On Hold", cancelled: "Cancelled",
};

function statusCls(s: string | null) {
  if (s === "active") return "text-green-600 bg-green-50 border-green-100";
  if (s === "completed") return "text-blue-600 bg-blue-50 border-blue-100";
  if (s === "on_hold") return "text-amber-600 bg-amber-50 border-amber-100";
  return "text-gray-500 bg-gray-50 border-gray-200";
}

type Props = {
  onClose: () => void;
  onCreated: (projects: ProjectSummary[]) => void;
};

export default function TimesheetProjectImportModal({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<"upload" | "review" | "creating" | "assign" | "importing" | "done">("upload");
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [columnUsed, setColumnUsed] = useState("");
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [parsedEntries, setParsedEntries] = useState<ParsedRow[]>([]);
  const [createProgress, setCreateProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [createdProjects, setCreatedProjects] = useState<ProjectSummary[]>([]);
  const [assignData, setAssignData] = useState<AssignItem[]>([]);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  async function processFile(file: File) {
    setLoading(true);
    setError("");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/projects/extract-timesheet-projects", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to analyse file"); setLoading(false); return; }
      setColumnUsed(data.columnUsed ?? "");
      setParsedEntries((data.entries ?? []) as ParsedRow[]);
      setRows(
        (data.projects as DetectedProject[]).map(p => ({
          ...p,
          billingType: "milestone" as BillingType,
          selected: !p.exists && !p.fuzzyMatch,
          useExisting: true, // fuzzy rows default to "use existing"
        })),
      );
      setStep("review");
    } catch {
      setError("Network error — please try again");
    }
    setLoading(false);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) processFile(f);
    e.target.value = "";
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  }, []);

  function setBillingType(name: string, bt: BillingType) {
    setRows(r => r.map(row => row.name === name ? { ...row, billingType: bt } : row));
  }

  function toggleSelect(name: string) {
    setRows(r => r.map(row => row.name === name ? { ...row, selected: !row.selected } : row));
  }

  function toggleUseExisting(name: string) {
    setRows(r => r.map(row => row.name === name ? { ...row, useExisting: !row.useExisting } : row));
  }

  const exactExisting = rows.filter(r => r.exists);
  const fuzzyRows = rows.filter(r => !r.exists && r.fuzzyMatch);
  const newRows = rows.filter(r => !r.exists && !r.fuzzyMatch);
  const toCreate = [
    ...newRows.filter(r => r.selected),
    ...fuzzyRows.filter(r => !r.useExisting),
  ];

  async function createProjects() {
    setStep("creating");
    setCreateProgress({ done: 0, total: toCreate.length });
    const created: ProjectSummary[] = [];
    let colorIdx = 0;
    for (const row of toCreate) {
      const color = PROJECT_COLORS[colorIdx % PROJECT_COLORS.length].bar;
      colorIdx++;
      try {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: row.name,
            billingType: row.billingType,
            status: "active",
            currency: "AED",
            color,
          }),
        });
        if (res.ok) {
          const p = await res.json();
          created.push({ ...p, milestones: [], invoices: [], expenses: [], timesheets: [], documentLinks: [] });
        }
      } catch {
        // continue with remaining
      }
      setCreateProgress(prev => ({ ...prev, done: prev.done + 1 }));
    }
    setCreatedProjects(created);
    onCreated(created);

    // Build project name → id map for all projects (new + existing)
    const nameToId = new Map<string, string>();
    for (const p of created) {
      const match = toCreate.find(r => r.name === p.name || (r.existingProjectName && r.existingProjectName === p.name));
      if (match) nameToId.set(match.name, p.id);
    }
    for (const r of exactExisting) {
      if (r.existingProjectId) nameToId.set(r.name, r.existingProjectId);
    }
    for (const r of fuzzyRows.filter(r => r.useExisting)) {
      if (r.existingProjectId) nameToId.set(r.name, r.existingProjectId);
    }

    buildAssignStep(nameToId);
  }

  function buildAssignStep(nameToId: Map<string, string>) {
    // Group parsed entries by projectColValue
    const byProject = new Map<string, ParsedRow[]>();
    for (const e of parsedEntries) {
      const key = e.projectColValue ?? "";
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(e);
    }

    const items: AssignItem[] = [];
    for (const [projName, entries] of byProject) {
      const projectId = nameToId.get(projName);
      if (!projectId || entries.length === 0) continue;
      const row = rows.find(r => r.name === projName);
      const billingType = row?.billingType ?? "tm";
      const months = groupByMonth(entries);
      items.push({
        projectName: projName,
        projectId,
        billingType,
        milestoneName: billingType === "milestone" ? "Phase 1" : "",
        months,
        totalEntries: entries.length,
        totalHours: Math.round(entries.reduce((s, e) => s + e.hoursLogged, 0) * 10) / 10,
        expanded: false,
      });
    }

    if (items.length > 0) {
      setAssignData(items);
      setStep("assign");
    } else {
      setStep("done");
    }
  }

  // Called when all projects already exist — skip creation and go straight to assign
  function skipToAssign() {
    const nameToId = new Map<string, string>();
    for (const r of exactExisting) {
      if (r.existingProjectId) nameToId.set(r.name, r.existingProjectId);
    }
    for (const r of fuzzyRows.filter(r => r.useExisting)) {
      if (r.existingProjectId) nameToId.set(r.name, r.existingProjectId);
    }
    buildAssignStep(nameToId);
  }

  async function importEntries() {
    setStep("importing");
    setImportProgress({ done: 0, total: assignData.length });
    try {
      await fetch("/api/projects/bulk-import-timesheet-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projects: assignData.map(item => ({
            projectId: item.projectId,
            milestoneName: item.milestoneName || null,
            months: item.months.map(mg => ({
              ym: mg.ym,
              entries: mg.entries.map(e => ({
                employeeName: e.employeeName,
                role: e.role ?? null,
                taskName: e.taskName ?? null,
                hoursLogged: e.hoursLogged,
                hourlyRate: e.hourlyRate ?? null,
                currency: e.currency || "AED",
                notes: e.notes ?? null,
                date: e.date ?? null,
              })),
            })),
          })),
        }),
      });
    } catch {
      // best-effort; still proceed to done
    }
    setStep("done");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Import projects from timesheet</p>
            {step === "review" && columnUsed && (
              <p className="text-[11px] text-gray-400 mt-0.5">Projects detected from column: <span className="font-medium text-gray-600">{columnUsed}</span></p>
            )}
            {step === "assign" && (
              <p className="text-[11px] text-gray-400 mt-0.5">Step 2 of 2 — assign timesheet entries to projects</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Step: upload */}
        {step === "upload" && (
          <div className="px-6 py-8">
            {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{error}</p>}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
                dragging ? "border-indigo-400 bg-indigo-50" : "border-gray-200 hover:border-indigo-300 hover:bg-gray-50"
              }`}
            >
              <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 13V4m0 0L7 7m3-3l3 3" stroke="#6366f1" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3 14v1a2 2 0 002 2h10a2 2 0 002-2v-1" stroke="#6366f1" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700">{loading ? "Analysing…" : "Drop your timesheet here"}</p>
                <p className="text-xs text-gray-400 mt-0.5">or click to browse · XLSX or CSV</p>
              </div>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChange} />
            <p className="text-[11px] text-gray-400 text-center mt-4">
              The file will be scanned for a Project or Client column. No data is stored at this step.
            </p>
          </div>
        )}

        {/* Step: review */}
        {step === "review" && (
          <>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-3">
              {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

              {/* Already existing (exact match) */}
              {exactExisting.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Already in OpsMind ({exactExisting.length})</p>
                  {exactExisting.map(row => (
                    <div key={row.name} className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-500 truncate">{row.name}</p>
                        {row.existingProjectName && row.existingProjectName !== row.name && (
                          <p className="text-[10px] text-gray-400">Matched: {row.existingProjectName}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {row.existingProjectStatus && (
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusCls(row.existingProjectStatus)}`}>
                            {STATUS_LABELS[row.existingProjectStatus] ?? row.existingProjectStatus}
                          </span>
                        )}
                        {row.existingProjectId && (
                          <Link href={`/projects/${row.existingProjectId}`} target="_blank" className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">
                            View →
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Fuzzy / possible duplicates */}
              {fuzzyRows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide">Possible duplicates ({fuzzyRows.length})</p>
                  {fuzzyRows.map(row => (
                    <div key={row.name} className="border border-amber-200 bg-amber-50/40 rounded-xl px-4 py-3 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{row.name}</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">
                            Similar to: <span className="font-semibold text-gray-700">{row.existingProjectName}</span>
                            {row.existingProjectStatus && (
                              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full border text-[9px] font-semibold ${statusCls(row.existingProjectStatus)}`}>
                                {STATUS_LABELS[row.existingProjectStatus] ?? row.existingProjectStatus}
                              </span>
                            )}
                          </p>
                        </div>
                        {row.existingProjectId && (
                          <Link href={`/projects/${row.existingProjectId}`} target="_blank" className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 shrink-0">
                            View →
                          </Link>
                        )}
                      </div>
                      {/* Toggle: use existing vs create new */}
                      <div className="flex rounded-lg border border-amber-200 overflow-hidden text-[10px] font-semibold">
                        <button
                          type="button"
                          onClick={() => row.useExisting || toggleUseExisting(row.name)}
                          className={`flex-1 py-1.5 transition-colors ${row.useExisting ? "bg-amber-500 text-white" : "text-amber-700 hover:bg-amber-50"}`}
                        >
                          Use existing
                        </button>
                        <button
                          type="button"
                          onClick={() => !row.useExisting || toggleUseExisting(row.name)}
                          className={`flex-1 py-1.5 transition-colors ${!row.useExisting ? "bg-indigo-600 text-white" : "text-indigo-600 hover:bg-indigo-50"}`}
                        >
                          Create new
                        </button>
                      </div>
                      {/* Billing type selector when creating new */}
                      {!row.useExisting && (
                        <div className="flex gap-2">
                          {BILLING_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setBillingType(row.name, opt.value)}
                              className={`flex-1 text-center px-2 py-1.5 rounded-lg border text-[10px] font-semibold transition-colors ${
                                row.billingType === opt.value
                                  ? "border-indigo-500 bg-indigo-600 text-white"
                                  : "border-gray-200 text-gray-600 hover:border-gray-300 bg-white"
                              }`}
                              title={opt.desc}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* New projects */}
              {newRows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                    New projects to create ({newRows.filter(r => r.selected).length} selected)
                  </p>
                  {newRows.map(row => (
                    <div key={row.name} className={`border rounded-xl px-4 py-3 space-y-2.5 transition-colors ${row.selected ? "border-indigo-200 bg-indigo-50/30" : "border-gray-100 bg-gray-50 opacity-60"}`}>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`sel-${row.name}`}
                          checked={row.selected}
                          onChange={() => toggleSelect(row.name)}
                          className="w-3.5 h-3.5 rounded accent-indigo-600 shrink-0"
                        />
                        <label htmlFor={`sel-${row.name}`} className="text-sm font-medium text-gray-900 truncate cursor-pointer flex-1">
                          {row.name}
                        </label>
                        <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full shrink-0">
                          New
                        </span>
                      </div>
                      {row.selected && (
                        <div className="flex gap-2 pl-5">
                          {BILLING_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setBillingType(row.name, opt.value)}
                              className={`flex-1 text-center px-2 py-2 rounded-lg border text-[10px] font-semibold transition-colors ${
                                row.billingType === opt.value
                                  ? "border-indigo-500 bg-indigo-600 text-white"
                                  : "border-gray-200 text-gray-600 hover:border-gray-300 bg-white"
                              }`}
                              title={opt.desc}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {rows.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">No projects found in file.</p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
              <button
                type="button"
                onClick={() => { setStep("upload"); setRows([]); setError(""); }}
                className="text-sm font-medium text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg"
              >
                ← Back
              </button>
              {toCreate.length > 0 ? (
                <button
                  type="button"
                  onClick={createProjects}
                  className="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-5 py-2 rounded-lg transition-colors"
                >
                  Create {toCreate.length} project{toCreate.length !== 1 ? "s" : ""} →
                </button>
              ) : parsedEntries.length > 0 ? (
                <button
                  type="button"
                  onClick={skipToAssign}
                  className="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-5 py-2 rounded-lg transition-colors"
                >
                  Import entries →
                </button>
              ) : (
                <button type="button" disabled className="text-sm font-semibold text-white bg-gray-300 cursor-not-allowed px-5 py-2 rounded-lg">
                  Nothing to do
                </button>
              )}
            </div>
          </>
        )}

        {/* Step: creating */}
        {step === "creating" && (
          <div className="px-6 py-12 flex flex-col items-center gap-4">
            <div className="w-10 h-10 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
            <p className="text-sm font-medium text-gray-700">
              Creating projects… {createProgress.done} / {createProgress.total}
            </p>
          </div>
        )}

        {/* Step: assign entries to projects */}
        {step === "assign" && (
          <>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-3">
              <p className="text-[11px] text-gray-500">
                Review the timesheet entries that will be imported into each project. For milestone-type projects, set a default milestone name — all entries will be assigned to it initially.
              </p>
              {assignData.map((item, idx) => (
                <div key={item.projectId} className="border border-surface-border rounded-xl overflow-hidden">
                  {/* Project header */}
                  <div className="px-4 py-3 bg-gray-50 border-b border-surface-border flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900 truncate">{item.projectName}</p>
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${
                          item.billingType === "milestone" ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                          : item.billingType === "tm" ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-purple-50 text-purple-700 border-purple-200"
                        }`}>{item.billingType}</span>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5">{item.totalEntries} entries · {item.months.length} month{item.months.length !== 1 ? "s" : ""} · {item.totalHours}h total</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAssignData(prev => prev.map((a, i) => i === idx ? { ...a, expanded: !a.expanded } : a))}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium shrink-0 mt-0.5"
                    >
                      {item.expanded ? "Hide" : "Preview"}
                    </button>
                  </div>

                  {/* Controls */}
                  <div className="px-4 py-3 space-y-2.5">
                    {/* Month badges — auto-detected from entry dates */}
                    <div>
                      <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Months detected</label>
                      <div className="flex flex-wrap gap-1.5">
                        {item.months.map(mg => (
                          <span key={mg.ym} className="inline-flex items-center gap-1.5 text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100 px-2.5 py-1 rounded-full">
                            {formatYM(mg.ym)}
                            <span className="text-indigo-400 font-normal">{mg.entries.length} entries · {mg.totalHours}h</span>
                          </span>
                        ))}
                      </div>
                    </div>

                    {item.billingType === "milestone" && (
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Default milestone</label>
                        <input
                          type="text"
                          placeholder="e.g. Phase 1"
                          value={item.milestoneName}
                          onChange={e => setAssignData(prev => prev.map((a, i) => i === idx ? { ...a, milestoneName: e.target.value } : a))}
                          className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                        <p className="text-[9px] text-gray-400 mt-1">All entries assigned to this milestone. Reassign later from project detail.</p>
                      </div>
                    )}

                    {/* Entry preview grouped by month */}
                    {item.expanded && (
                      <div className="rounded-lg border border-gray-100 overflow-hidden">
                        {item.months.map(mg => (
                          <div key={mg.ym}>
                            <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-100 flex items-center justify-between">
                              <span className="text-[10px] font-semibold text-gray-500">{formatYM(mg.ym)}</span>
                              <span className="text-[10px] text-gray-400">{mg.entries.length} entries · {mg.totalHours}h</span>
                            </div>
                            <table className="w-full text-[10px]">
                              <tbody className="divide-y divide-gray-50">
                                {mg.entries.slice(0, 10).map((e, ei) => (
                                  <tr key={ei} className="hover:bg-gray-50">
                                    <td className="px-3 py-1.5 text-gray-700 font-medium">{e.employeeName}</td>
                                    <td className="px-3 py-1.5 text-gray-500 truncate max-w-[140px]">{e.taskName ?? "—"}</td>
                                    <td className="px-3 py-1.5 text-right text-gray-700">{e.hoursLogged}h</td>
                                  </tr>
                                ))}
                                {mg.entries.length > 10 && (
                                  <tr>
                                    <td colSpan={3} className="px-3 py-1.5 text-center text-gray-400">
                                      +{mg.entries.length - 10} more
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
              <p className="text-[11px] text-gray-400">
                {assignData.reduce((s, a) => s + a.totalEntries, 0)} entries · {assignData.reduce((s, a) => s + a.months.length, 0)} month{assignData.reduce((s, a) => s + a.months.length, 0) !== 1 ? "s" : ""} · {assignData.length} project{assignData.length !== 1 ? "s" : ""}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep("done")}
                  className="text-sm font-medium text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={importEntries}
                  className="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-5 py-2 rounded-lg transition-colors"
                >
                  Import entries
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step: importing */}
        {step === "importing" && (
          <div className="px-6 py-12 flex flex-col items-center gap-4">
            <div className="w-10 h-10 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
            <p className="text-sm font-medium text-gray-700">Importing timesheet entries…</p>
            <p className="text-[11px] text-gray-400">Creating records and milestones</p>
          </div>
        )}

        {/* Step: done */}
        {step === "done" && (
          <div className="px-6 py-8 flex flex-col items-center gap-4 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M4 11l5 5L18 6" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {createdProjects.length} project{createdProjects.length !== 1 ? "s" : ""} created
              </p>
              {(exactExisting.length + fuzzyRows.filter(r => r.useExisting).length) > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  {exactExisting.length + fuzzyRows.filter(r => r.useExisting).length} matched existing project{exactExisting.length + fuzzyRows.filter(r => r.useExisting).length !== 1 ? "s" : ""} and were skipped.
                </p>
              )}
            </div>
            {createdProjects.length > 0 && (
              <div className="w-full text-left space-y-1.5">
                {createdProjects.map(p => (
                  <div key={p.id} className="flex items-center justify-between gap-2 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                    <span className="text-xs font-medium text-gray-800 truncate">{p.name}</span>
                    <Link href={`/projects/${p.id}`} className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 shrink-0">
                      Open →
                    </Link>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-6 py-2 rounded-lg"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
