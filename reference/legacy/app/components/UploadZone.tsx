"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import { DOC_TYPE_LABELS } from "@/lib/doc-types";
import {
  useUploadContext,
  QueueItem,
  QueueItemState,
  ExtractionResult,
  PotentialMatch,
  MAX_QUEUE_FILES,
} from "@/app/contexts/UploadContext";
import { smartSimilarity } from "@/lib/name-match";
import ExtractionPreviewPanel from "@/app/components/ExtractionPreviewPanel";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocTypeBadge({ docType }: { docType: string }) {
  const colors: Record<string, string> = {
    visa: "bg-blue-50 text-blue-700",
    emirates_id: "bg-purple-50 text-purple-700",
    labor_card: "bg-indigo-50 text-indigo-700",
    trade_license: "bg-amber-50 text-amber-700",
    employee_contract: "bg-green-50 text-green-700",
    client_contract: "bg-teal-50 text-teal-700",
    invoice: "bg-orange-50 text-orange-700",
    payroll: "bg-pink-50 text-pink-700",
    insurance: "bg-cyan-50 text-cyan-700",
    government_permit: "bg-red-50 text-red-700",
    other: "bg-gray-100 text-gray-700",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${colors[docType] ?? colors.other}`}>
      {DOC_TYPE_LABELS[docType] ?? docType}
    </span>
  );
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const isPdf = ext === "pdf";
  const isImg = ["jpg", "jpeg", "png", "webp"].includes(ext);
  const isXls = ["xlsx", "xls"].includes(ext);
  const color = isPdf ? "#ef4444" : isImg ? "#8b5cf6" : isXls ? "#22c55e" : "#6b7280";
  return (
    <div className="w-8 h-10 rounded border flex items-center justify-center shrink-0 bg-white shadow-sm" style={{ borderColor: color + "40" }}>
      <span className="text-[8px] font-bold uppercase" style={{ color }}>{ext || "?"}</span>
    </div>
  );
}

// ─── contract link section ────────────────────────────────────────────────────

type PersonOption = {
  id: string | null;
  name: string;
  jobTitle: string | null;
  salary: number | null;
  salaryCurrency: string | null;
  payrollOnly?: boolean;
  score?: number;
};

function ContractLinkSection({
  contractPersonId, contractName, contractSalary, contractSalaryCurrency, contractJobTitle, onLinked, onSkip,
}: {
  contractPersonId: string; contractName: string; contractSalary: number | null;
  contractSalaryCurrency: string | null; contractJobTitle: string | null;
  onLinked: () => void; onSkip: () => void;
}) {
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PersonOption | null>(null);
  const [updateSalary, setUpdateSalary] = useState(true);
  const [loading, setLoading] = useState(false);
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    fetch("/api/people")
      .then(r => r.json())
      .then(d => setPeople((d.people ?? []).filter((p: PersonOption) => p.id == null || p.id !== contractPersonId)));
  }, [contractPersonId]);

  const ranked = people.map(p => ({ ...p, score: smartSimilarity(contractName, p.name) })).sort((a, b) => b.score! - a.score!);
  const filtered = search.trim() ? ranked.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || (p.jobTitle ?? "").toLowerCase().includes(search.toLowerCase())) : ranked;

  async function handleLink() {
    if (!selected) return;
    setLoading(true);
    const payload = selected.payrollOnly
      ? { keepId: contractPersonId, payrollOnlyName: selected.name, updatePayrollSalary: contractSalary != null ? updateSalary : false }
      : { keepId: selected.id, discardId: contractPersonId, updatePayrollSalary: contractSalary != null ? updateSalary : false };
    await fetch("/api/people/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setLinked(true);
    onLinked();
  }

  if (linked) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 rounded-xl border border-green-100">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" fill="#dcfce7" /><path d="M4 7l2 2 4-4" stroke="#16a34a" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="text-xs font-semibold text-green-700">Merged into {selected?.name}</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-indigo-100 bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 10c0-2-1.8-3-4-3s-4 1-4 3" stroke="#4f46e5" strokeWidth="1.3" strokeLinecap="round" fill="none" /><path d="M10 4v4M8 6h4" stroke="#4f46e5" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </div>
        <p className="text-xs font-semibold text-indigo-800">Assign to existing employee?</p>
      </div>
      <div className="bg-indigo-50 rounded-lg px-3 py-2 mb-3">
        <p className="text-xs font-semibold text-gray-900">{contractName}</p>
        {contractJobTitle && <p className="text-[10px] text-gray-500 mt-0.5">{contractJobTitle}</p>}
        {contractSalary != null && <p className="text-[10px] font-medium text-indigo-600 mt-0.5">{contractSalaryCurrency} {contractSalary.toLocaleString("en-US")}</p>}
      </div>
      {selected ? (
        <div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-surface-inset rounded-lg p-2.5">
              <p className="text-[10px] text-gray-400 mb-0.5">Contract (new)</p>
              <p className="text-xs font-semibold text-gray-900">{contractName}</p>
              {contractSalary != null && <p className="text-[10px] font-medium text-indigo-600 mt-1">{contractSalaryCurrency} {contractSalary.toLocaleString("en-US")}</p>}
            </div>
            <div className="bg-surface-inset rounded-lg p-2.5">
              <p className="text-[10px] text-gray-400 mb-0.5">Existing</p>
              <p className="text-xs font-semibold text-gray-900">{selected.name}</p>
              {selected.salary != null && <p className="text-[10px] font-medium text-gray-600 mt-1">{selected.salaryCurrency} {selected.salary.toLocaleString("en-US")}</p>}
            </div>
          </div>
          {contractSalary != null && (
            <div className="mb-3">
              <p className="text-[11px] font-semibold text-gray-700 mb-1.5">Update payroll entries with contract salary?</p>
              <div className="flex gap-2">
                <button onClick={() => setUpdateSalary(true)} className={`flex-1 text-[11px] font-medium px-2 py-1.5 rounded-md border transition-colors ${updateSalary ? "bg-white border-indigo-300 text-indigo-700 shadow-sm" : "border-gray-200 text-gray-500 hover:bg-white"}`}>Yes — {contractSalaryCurrency} {contractSalary.toLocaleString("en-US")}</button>
                <button onClick={() => setUpdateSalary(false)} className={`flex-1 text-[11px] font-medium px-2 py-1.5 rounded-md border transition-colors ${!updateSalary ? "bg-white border-indigo-300 text-indigo-700 shadow-sm" : "border-gray-200 text-gray-500 hover:bg-white"}`}>No — keep existing</button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button onClick={handleLink} disabled={loading} className="flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 px-3 py-1.5 rounded-lg transition-colors">{loading ? "Merging…" : "Merge profiles"}</button>
            <button onClick={() => setSelected(null)} disabled={loading} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">← Back</button>
            <button onClick={onSkip} disabled={loading} className="ml-auto text-xs text-gray-400 hover:text-gray-600 transition-colors">Skip</button>
          </div>
        </div>
      ) : (
        <div>
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search existing employees…" className="w-full text-xs text-gray-700 placeholder-gray-300 bg-surface-inset border border-surface-border rounded-lg px-3 py-2 mb-2 outline-none focus:ring-1 focus:ring-indigo-200" />
          <div className="max-h-40 overflow-y-auto divide-y divide-surface-border rounded-lg border border-surface-border">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-xs text-gray-400 text-center">No employees found</p>
            ) : filtered.map(p => (
              <button key={p.id} onClick={() => setSelected(p)} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-indigo-50 transition-colors text-left">
                <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center shrink-0"><span className="text-[9px] font-bold text-indigo-500">{p.name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase()}</span></div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-900 truncate">{p.name}</p>
                  {p.payrollOnly ? <span className="text-[9px] font-semibold text-gray-400 bg-gray-100 px-1 py-0.5 rounded">Payroll only</span> : p.jobTitle && <p className="text-[10px] text-gray-400 truncate">{p.jobTitle}</p>}
                </div>
                {(p.score ?? 0) >= 0.6 && <span className="shrink-0 text-[9px] font-semibold text-indigo-500 bg-indigo-50 px-1 py-0.5 rounded">{Math.round((p.score ?? 0) * 100)}%</span>}
              </button>
            ))}
          </div>
          <button onClick={onSkip} className="mt-2.5 w-full text-xs text-gray-400 hover:text-gray-600 transition-colors text-center">Skip — keep as new employee</button>
        </div>
      )}
    </div>
  );
}

// ─── merge match row ──────────────────────────────────────────────────────────

function MatchConfirmRow({ match, onResolved }: { match: PotentialMatch; onResolved: (id: string) => void }) {
  const [loading, setLoading] = useState<"same" | "diff" | null>(null);
  const [updateSalary, setUpdateSalary] = useState(false);
  const hasSalaryConflict = match.newSalary != null && match.existingSalary != null && match.newSalary !== match.existingSalary;

  async function handleSame() {
    setLoading("same");
    await fetch("/api/people/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keepId: match.existingPersonId, discardId: match.newPersonId, updatePayrollSalary: hasSalaryConflict && updateSalary }) });
    onResolved(match.newPersonId);
  }

  return (
    <div className="rounded-xl border border-amber-100 bg-white p-4 mb-3 last:mb-0">
      <p className="text-xs font-semibold text-amber-800 mb-3">Is this the same person?</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[{ label: "just uploaded", name: match.newName, source: match.newSource, jobTitle: match.newJobTitle, salary: match.newSalary, currency: match.newSalaryCurrency },
          { label: "existing record", name: match.existingName, source: match.existingSource, jobTitle: match.existingJobTitle, salary: match.existingSalary, currency: match.existingSalaryCurrency }].map((side, i) => (
          <div key={i} className="bg-surface-inset rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              {side.source === "contract" && <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">Contract</span>}
              {side.source === "payroll" && <span className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">Payroll</span>}
              <span className="text-[10px] text-gray-400">{side.label}</span>
            </div>
            <p className="text-sm font-semibold text-gray-900 leading-snug">{side.name}</p>
            {side.jobTitle && <p className="text-xs text-gray-400 mt-0.5">{side.jobTitle}</p>}
            {side.salary != null && <p className="text-xs font-medium text-gray-700 mt-1.5">{side.currency} {side.salary.toLocaleString("en-US")}</p>}
          </div>
        ))}
      </div>
      {hasSalaryConflict && (
        <div className="mb-3 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5">
          <p className="text-[11px] font-semibold text-amber-800 mb-2">Salary values differ — which should be kept?</p>
          <div className="flex gap-2">
            <button onClick={() => setUpdateSalary(false)} className={`flex-1 text-[11px] font-medium px-2 py-1.5 rounded-md border transition-colors ${!updateSalary ? "bg-white border-indigo-300 text-indigo-700 shadow-sm" : "border-gray-200 text-gray-500 hover:bg-white"}`}>Keep existing ({match.existingSalaryCurrency} {match.existingSalary?.toLocaleString("en-US")})</button>
            <button onClick={() => setUpdateSalary(true)} className={`flex-1 text-[11px] font-medium px-2 py-1.5 rounded-md border transition-colors ${updateSalary ? "bg-white border-indigo-300 text-indigo-700 shadow-sm" : "border-gray-200 text-gray-500 hover:bg-white"}`}>Use new ({match.newSalaryCurrency} {match.newSalary?.toLocaleString("en-US")})</button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button onClick={handleSame} disabled={loading !== null} className="flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 px-3 py-1.5 rounded-lg transition-colors">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.5 2.5 4.5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {loading === "same" ? "Merging…" : "Yes, same person — merge"}
        </button>
        <button onClick={() => onResolved(match.newPersonId)} disabled={loading !== null} className="text-xs font-medium text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-surface-hover transition-colors disabled:opacity-50">No, keep separate</button>
      </div>
    </div>
  );
}

// ─── post-processing actions for a single done item ───────────────────────────

function ItemActions({ item, onDone }: { item: QueueItem & { state: Extract<QueueItemState, { status: "done" }> }; onDone: () => void }) {
  const [pendingMatches, setPendingMatches] = useState(item.state.potentialMatches);
  const [contractLinked, setContractLinked] = useState(false);

  const showContractLinker = item.state.result.docType === "employee_contract" && item.state.contractPersonId != null && !contractLinked;

  if (!showContractLinker && pendingMatches.length === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t border-surface-border">
      <p className="text-xs font-semibold text-gray-500 mb-3 truncate">{item.file.name}</p>
      {showContractLinker ? (
        <ContractLinkSection
          contractPersonId={item.state.contractPersonId!}
          contractName={item.state.result.parties[0] ?? "Employee"}
          contractSalary={item.state.result.amount}
          contractSalaryCurrency={item.state.result.currency}
          contractJobTitle={null}
          onLinked={() => { setContractLinked(true); setPendingMatches([]); onDone(); }}
          onSkip={() => { setContractLinked(true); onDone(); }}
        />
      ) : pendingMatches.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 2v3.5M5 7.5v.5" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </div>
            <p className="text-xs font-semibold text-amber-800">Possible duplicate {pendingMatches.length > 1 ? "people" : "person"}</p>
          </div>
          {pendingMatches.map(m => (
            <MatchConfirmRow key={m.newPersonId} match={m} onResolved={id => {
              const remaining = pendingMatches.filter(x => x.newPersonId !== id);
              setPendingMatches(remaining);
              if (remaining.length === 0) onDone();
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── per-file row in the list ─────────────────────────────────────────────────

function FileRow({ item, onRemove }: { item: QueueItem; onRemove?: () => void }) {
  const s = item.state;
  const { resolveDecision } = useUploadContext();

  const statusIcon = () => {
    if (s.status === "pending") return <div className="w-5 h-5 rounded-full border-2 border-gray-200 shrink-0" />;
    if (s.status === "processing") return (
      <svg className="animate-spin w-5 h-5 text-indigo-400 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    );
    if (s.status === "done") return (
      <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
    );
    if (s.status === "awaiting_decision" || s.status === "awaiting_new_or_skip") return (
      <div className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center shrink-0">
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M4.5 2v3M4.5 6.5v.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </div>
    );
    return (
      <div className="w-5 h-5 rounded-full bg-red-400 flex items-center justify-center shrink-0">
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M2 2l5 5M7 2l-5 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </div>
    );
  };

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 ${(s.status === "awaiting_decision" || s.status === "awaiting_new_or_skip") ? "bg-amber-50/40" : s.status === "error" ? "bg-red-50/30" : ""}`}>
      {statusIcon()}
      <FileIcon name={item.file.name} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{item.file.name}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {s.status === "pending" && <span className="text-xs text-gray-400">{fmtSize(item.file.size)}</span>}
          {s.status === "processing" && <span className="text-xs text-indigo-500">Analyzing with AI…</span>}
          {s.status === "done" && (
            <>
              {s.result.docType && <DocTypeBadge docType={s.result.docType} />}
              {s.result.parties[0] && <span className="text-xs text-gray-500 truncate max-w-32">{s.result.parties[0]}</span>}
              {s.result.expiryDate && <span className="text-xs text-amber-600">exp {s.result.expiryDate}</span>}
              {s.alertsCreated > 0 && <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">{s.alertsCreated} alert{s.alertsCreated > 1 ? "s" : ""}</span>}
              {s.payrollEntriesCreated > 0 && <span className="text-[10px] font-semibold text-pink-600 bg-pink-50 px-1.5 py-0.5 rounded-full">{s.payrollEntriesCreated} payroll {s.payrollEntriesCreated === 1 ? "entry" : "entries"}</span>}
              {s.invoicesCreated > 0 && <span className="text-[10px] font-semibold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">{s.invoicesCreated} invoices</span>}
            </>
          )}
          {s.status === "awaiting_decision" && <span className="text-xs text-amber-600">Already in records — update or keep separate?</span>}
          {s.status === "awaiting_new_or_skip" && <span className="text-xs text-amber-600">Create new record or skip?</span>}
          {s.status === "error" && <span className="text-xs text-red-500 truncate max-w-60">{s.message}</span>}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {s.status === "done" && (
          <Link href={`/records/${s.result.id}`} className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors whitespace-nowrap">
            View →
          </Link>
        )}
        {s.status === "awaiting_decision" && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => resolveDecision(item.id, "replace")}
              className="text-[11px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-2 py-1 rounded-lg transition-colors whitespace-nowrap"
            >
              Update
            </button>
            <button
              onClick={() => resolveDecision(item.id, "decline_update")}
              className="text-[11px] font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-lg transition-colors whitespace-nowrap"
            >
              Keep separate
            </button>
          </div>
        )}
        {s.status === "awaiting_new_or_skip" && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => resolveDecision(item.id, "create_new")}
              className="text-[11px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-2 py-1 rounded-lg transition-colors whitespace-nowrap"
            >
              Create new
            </button>
            <button
              onClick={() => resolveDecision(item.id, "skip")}
              className="text-[11px] font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-lg transition-colors"
            >
              Skip
            </button>
          </div>
        )}
        {s.status === "pending" && onRemove && (
          <button onClick={onRemove} className="text-gray-300 hover:text-red-400 transition-colors p-0.5">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function UploadZone() {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { queue, queuePhase, limitWarning, addToQueue, removeFromQueue, startProcessing, resetQueue, approvePreview, rejectPreview, refinePreview, askPreview } = useUploadContext();

  function handleReset() {
    resetQueue();
    if (inputRef.current) inputRef.current.value = "";
  }

  // ── idle: big drop zone ──

  if (queuePhase === "idle") {
    return (
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => { e.preventDefault(); setIsDragging(false); addToQueue(e.dataTransfer.files); }}
        className={`rounded-xl border-2 border-dashed transition-colors p-6 flex gap-6 items-center ${isDragging ? "border-indigo-400 bg-indigo-50" : "border-indigo-200 bg-gradient-to-br from-indigo-50/60 via-purple-50/40 to-blue-50/60"}`}
      >
        <div className="relative shrink-0">
          <div className="w-20 h-24 bg-white rounded-lg shadow-sm border border-gray-200 flex items-center justify-center">
            <svg width="28" height="32" viewBox="0 0 28 32" fill="none">
              <rect x="2" y="2" width="18" height="24" rx="2" stroke="#6366f1" strokeWidth="1.5" fill="none" />
              <path d="M8 10h8M8 14h8M8 18h5" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="absolute -top-2 -right-2 w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center shadow">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 2v6M2 5h6" stroke="white" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-gray-900 mb-1">Drop contracts, invoices, IDs, or any operational PDF</h3>
          <p className="text-sm text-gray-500 mb-4">OpsMind auto-detects type, extracts dates, parties, amounts, and creates the right item for you.</p>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v7M4 6l3-4 3 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M2 11h10" stroke="white" strokeWidth="1.5" strokeLinecap="round" /></svg>
              Browse files
            </button>
            <span className="text-xs text-gray-400">PDF, DOCX, XLSX, JPG, PNG · up to {MAX_QUEUE_FILES} files at once</span>
          </div>
        </div>
        <input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.txt,.xlsx,.xls" className="hidden" onChange={e => { if (e.target.files?.length) addToQueue(e.target.files); }} />
      </div>
    );
  }

  // ── queue / running / complete: file list ──

  const previewItem = queue.find(
    (i): i is QueueItem & { state: Extract<QueueItemState, { status: "preview" }> } =>
      i.state.status === "preview",
  );

  const doneCount = queue.filter(i => i.state.status === "done").length;
  const errorCount = queue.filter(i => i.state.status === "error").length;
  const dupCount = queue.filter(i => i.state.status === "awaiting_decision" || i.state.status === "awaiting_new_or_skip").length;
  const processingCount = queue.filter(i => i.state.status === "processing").length;
  const pendingCount = queue.filter(i => i.state.status === "pending").length;

  const actionItems = queuePhase === "complete"
    ? queue.filter((i): i is QueueItem & { state: Extract<QueueItemState, { status: "done" }> } => {
        if (i.state.status !== "done") return false;
        return (i.state.result.docType === "employee_contract" && i.state.contractPersonId != null) || i.state.potentialMatches.length > 0;
      })
    : [];

  return (
    <div className="rounded-xl border border-surface-border bg-white overflow-hidden">
      {/* Header */}
      <div
        onDragOver={e => { e.preventDefault(); if (queuePhase === "queue") setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => {
          e.preventDefault(); setIsDragging(false);
          if (queuePhase === "queue") addToQueue(e.dataTransfer.files);
        }}
        className={`px-5 py-4 border-b border-surface-border flex items-center justify-between transition-colors ${isDragging ? "bg-indigo-50" : "bg-surface-inset"}`}
      >
        <div className="flex items-center gap-3">
          {queuePhase === "running" && processingCount > 0 ? (
            <>
              <svg className="animate-spin w-4 h-4 text-indigo-500 shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span className="text-sm font-semibold text-gray-800">Analyzing {doneCount + dupCount + errorCount + 1} of {queue.length}…</span>
            </>
          ) : queuePhase === "complete" ? (
            <>
              <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <span className="text-sm font-semibold text-gray-800">
                {doneCount} analyzed
                {dupCount > 0 && ` · ${dupCount} need${dupCount === 1 ? "s" : ""} decision`}
                {errorCount > 0 && ` · ${errorCount} failed`}
              </span>
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2h7l4 4v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="#6366f1" strokeWidth="1.3" fill="none" /><path d="M10 2v4h4" stroke="#6366f1" strokeWidth="1.3" fill="none" /></svg>
              <span className="text-sm font-semibold text-gray-800">{queue.length} file{queue.length !== 1 ? "s" : ""} selected</span>
              {queue.length < MAX_QUEUE_FILES && (
                <span className="text-xs text-gray-400">· {MAX_QUEUE_FILES - queue.length} more allowed</span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {queuePhase === "queue" && queue.length < MAX_QUEUE_FILES && (
            <button onClick={() => inputRef.current?.click()} className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors">+ Add more</button>
          )}
          {queuePhase === "complete" && (
            <button onClick={handleReset} className="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors">Upload more</button>
          )}
        </div>
      </div>

      {/* Limit warning */}
      {limitWarning && (
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700 font-medium">
          Only the first {MAX_QUEUE_FILES} files were added. Remove some to add others.
        </div>
      )}

      {/* Preview panel — replaces file list when an item is being previewed */}
      {previewItem ? (
        <ExtractionPreviewPanel
          item={previewItem}
          onApprove={() => approvePreview(previewItem.id)}
          onReject={() => rejectPreview(previewItem.id)}
          onRefine={(prompt) => refinePreview(previewItem.id, prompt)}
          onAsk={(question) => askPreview(previewItem.id, question)}
        />
      ) : (
        <>
          {/* File list */}
          <div className="divide-y divide-surface-border max-h-80 overflow-y-auto">
            {queue.map(item => (
              <FileRow
                key={item.id}
                item={item}
                onRemove={queuePhase === "queue" ? () => removeFromQueue(item.id) : undefined}
              />
            ))}
          </div>

          {/* Actions: start button or post-upload interactive prompts */}
          {queuePhase === "queue" && (
            <div className="px-5 py-4 border-t border-surface-border bg-surface-inset flex items-center justify-between">
              <span className="text-xs text-gray-400">Files will be analyzed one by one</span>
              <button
                onClick={startProcessing}
                className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 2l8 5-8 5V2z" fill="white" /></svg>
                Analyze {queue.length} document{queue.length !== 1 ? "s" : ""}
              </button>
            </div>
          )}

          {queuePhase === "running" && pendingCount > 0 && (
            <div className="px-5 py-3 border-t border-surface-border bg-surface-inset">
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${((doneCount + dupCount + errorCount) / queue.length) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Post-processing actions (contract link / merge prompts) */}
          {actionItems.length > 0 && (
            <div className="px-5 py-5 border-t border-surface-border space-y-6">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions needed</p>
              {actionItems.map(item => (
                <ItemActions key={item.id} item={item} onDone={() => {}} />
              ))}
            </div>
          )}
        </>
      )}

      <input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.txt,.xlsx,.xls" className="hidden" onChange={e => { if (e.target.files?.length) { addToQueue(e.target.files); if (inputRef.current) inputRef.current.value = ""; } }} />
    </div>
  );
}
