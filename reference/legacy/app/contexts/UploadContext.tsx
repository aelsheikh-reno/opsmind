"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DOC_TYPE_LABELS, DOC_TYPE_COLORS } from "@/lib/doc-types";

// ─── Shared extraction types (exported for UploadZone) ───────────────────────

export type PreviewExtraction = {
  docType: string | null;
  confidence: number;
  parties: string[];
  summary: string | null;
  referenceNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  amount: number | null;
  currency: string | null;
  notes: string | null;
  isPaid: boolean | null;
  paymentSchedule: Array<{ dueDate: string; amount: number; currency: string; description: string }>;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type PotentialMatch = {
  newPersonId: string;
  newName: string;
  existingPersonId: string;
  existingName: string;
  newSource?: "contract" | "payroll";
  existingSource?: "contract" | "payroll";
  newJobTitle?: string | null;
  existingJobTitle?: string | null;
  newSalary?: number | null;
  newSalaryCurrency?: string | null;
  existingSalary?: number | null;
  existingSalaryCurrency?: string | null;
};

export type ExtractionResult = {
  id: string;
  filename: string;
  docType: string | null;
  confidence: number | null;
  parties: string[];
  summary: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  renewalDeadline: string | null;
  amount: number | null;
  currency: string | null;
  referenceNumber: string | null;
  notes: string | null;
};

// ─── Queue types ──────────────────────────────────────────────────────────────

export type QueueItemState =
  | { status: "pending" }
  | { status: "processing" }
  | { status: "done"; result: ExtractionResult; alertsCreated: number; potentialMatches: PotentialMatch[]; invoicesCreated: number; invoicesSkipped: { label: string; existingId: string }[]; payrollEntriesCreated: number; contractPersonId: string | null }
  | { status: "awaiting_decision"; message: string; existingDocId: string }
  | { status: "awaiting_new_or_skip"; message: string; existingDocId: string }
  | { status: "error"; message: string }
  | { status: "preview"; tempId: string; tempFilePath: string; fileHash: string; mimeType: string; extraction: PreviewExtraction; chat: ChatMessage[]; refining: boolean; asking: boolean; approving: boolean };

export type QueueItem = { id: string; file: File; state: QueueItemState; replaceId?: string; forceNew?: boolean };
export type QueuePhase = "idle" | "queue" | "running" | "complete";

export const MAX_QUEUE_FILES = 10;

// ─── Toast job type ───────────────────────────────────────────────────────────

export type UploadJob = {
  id: string;
  filename: string;
  status: "analyzing" | "done" | "failed" | "awaiting_decision" | "awaiting_new_or_skip";
  docType?: string | null;
  documentId?: string;
  parties?: string[];
  alertsCreated?: number;
  invoicesCreated?: number;
  invoicesSkipped?: { label: string; existingId: string }[];
  payrollEntriesCreated?: number;
  summary?: string | null;
  error?: string;
  // awaiting_decision fields
  queueItemId?: string;
  existingDocId?: string;
  duplicateMessage?: string;
};

// ─── Context shape ────────────────────────────────────────────────────────────

type ContextValue = {
  // toast helpers (used by UploadZone internally)
  startJob: (id: string, filename: string) => void;
  completeJob: (id: string, data: Partial<Omit<UploadJob, "id" | "filename" | "status">>) => void;
  failJob: (id: string, error: string) => void;
  // queue state
  queue: QueueItem[];
  queuePhase: QueuePhase;
  limitWarning: boolean;
  // queue actions
  addToQueue: (files: FileList | File[]) => void;
  removeFromQueue: (id: string) => void;
  startProcessing: () => void;
  resetQueue: () => void;
  resolveDecision: (queueItemId: string, decision: "replace" | "skip" | "decline_update" | "create_new") => void;
  // preview actions
  approvePreview: (queueItemId: string) => Promise<void>;
  rejectPreview: (queueItemId: string) => void;
  refinePreview: (queueItemId: string, prompt: string) => Promise<void>;
  askPreview: (queueItemId: string, question: string) => Promise<void>;
};

const UploadContext = createContext<ContextValue | null>(null);

export function useUploadContext() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUploadContext must be used inside UploadProvider");
  return ctx;
}

// ─── Toast card ───────────────────────────────────────────────────────────────

function UploadToast({
  job,
  onDismiss,
  onResolve,
}: {
  job: UploadJob;
  onDismiss: () => void;
  onResolve?: (decision: "replace" | "skip" | "decline_update" | "create_new") => void;
}) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; });

  useEffect(() => {
    // Don't auto-dismiss while waiting for user decision
    if (job.status === "analyzing" || job.status === "awaiting_decision" || job.status === "awaiting_new_or_skip") return;
    const t = setTimeout(() => dismissRef.current(), 10000);
    return () => clearTimeout(t);
  }, [job.status]);

  const analyzing       = job.status === "analyzing";
  const done            = job.status === "done";
  const failed          = job.status === "failed";
  const waiting         = job.status === "awaiting_decision";
  const waitingNewOrSkip = job.status === "awaiting_new_or_skip";
  const isWaiting       = waiting || waitingNewOrSkip;

  const headerBg    = done ? "bg-green-50"    : failed ? "bg-red-50"    : isWaiting ? "bg-amber-50"    : "bg-surface-inset";
  const borderColor = done ? "border-green-200" : failed ? "border-red-200" : isWaiting ? "border-amber-200" : "border-gray-200";
  const titleColor  = done ? "text-green-800"   : failed ? "text-red-800"   : isWaiting ? "text-amber-800"   : "text-gray-800";
  const titleText   = done ? "Extracted successfully" : failed ? "Analysis failed" : waiting ? "Already in records" : waitingNewOrSkip ? "Create new or skip?" : "Analyzing document…";

  return (
    <div className={`w-72 rounded-xl shadow-lg border overflow-hidden bg-white ${borderColor}`}>
      <div className={`flex items-center gap-2.5 px-3.5 py-2.5 ${headerBg}`}>
        {analyzing ? (
          <svg className="shrink-0 animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="#6366f1" strokeWidth="1.8" strokeDasharray="9 5" strokeLinecap="round" />
          </svg>
        ) : done ? (
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="shrink-0"><circle cx="7.5" cy="7.5" r="7" fill="#16a34a" /><path d="M4 7.5l2.5 2.5 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        ) : failed ? (
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="shrink-0"><circle cx="7.5" cy="7.5" r="7" fill="#dc2626" /><path d="M5 5l5 5M10 5l-5 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" /></svg>
        ) : isWaiting ? (
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="shrink-0"><circle cx="7.5" cy="7.5" r="7" fill="#d97706" /><path d="M7.5 4.5v3.5M7.5 10v.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" /></svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="shrink-0"><circle cx="7.5" cy="7.5" r="7" fill="#d97706" /><path d="M7.5 4.5v3.5M7.5 10v.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" /></svg>
        )}
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-semibold leading-tight ${titleColor}`}>{titleText}</p>
          <p className="text-[10px] text-gray-400 truncate mt-0.5">{job.filename}</p>
        </div>
        {!analyzing && (
          <button onClick={onDismiss} className="shrink-0 ml-1 p-0.5 text-gray-400 hover:text-gray-600 transition-colors">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
        )}
      </div>
      <div className="px-3.5 py-2.5">
        {analyzing && (
          <>
            <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">Claude is reading the document and extracting dates, parties, and key data.</p>
            <div className="h-1 bg-gray-100 rounded-full overflow-hidden"><div className="h-full w-[65%] bg-indigo-400 rounded-full animate-pulse" /></div>
          </>
        )}
        {done && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1">
              {job.docType && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${DOC_TYPE_COLORS[job.docType] ?? "bg-gray-100 text-gray-700"}`}>{DOC_TYPE_LABELS[job.docType] ?? job.docType}</span>}
              {(job.alertsCreated ?? 0) > 0 && <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">{job.alertsCreated} alert{job.alertsCreated !== 1 ? "s" : ""}</span>}
              {(job.invoicesCreated ?? 0) > 0 && <span className="text-[10px] font-medium text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded-full">{job.invoicesCreated} invoice{job.invoicesCreated !== 1 ? "s" : ""}</span>}
              {(job.invoicesSkipped?.length ?? 0) > 0 && <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">{job.invoicesSkipped!.length} already existed</span>}
              {(job.payrollEntriesCreated ?? 0) > 0 && <span className="text-[10px] font-medium text-pink-700 bg-pink-50 px-1.5 py-0.5 rounded-full">{job.payrollEntriesCreated} payroll {job.payrollEntriesCreated === 1 ? "entry" : "entries"}</span>}
            </div>
            {(job.parties?.length ?? 0) > 0 && <p className="text-[11px] text-gray-500 truncate">{job.parties!.slice(0, 3).join(" · ")}</p>}
            {(job.invoicesSkipped?.length ?? 0) > 0 && (
              <div className="border-t border-amber-100 pt-1.5">
                <p className="text-[10px] font-semibold text-amber-700 mb-1">Skipped — already in records:</p>
                <div className="space-y-0.5 max-h-20 overflow-y-auto">
                  {job.invoicesSkipped!.map((s, i) => (
                    <Link
                      key={i}
                      href={`/records/${s.existingId}`}
                      onClick={onDismiss}
                      className="flex items-center gap-1 text-[10px] text-amber-600 hover:text-amber-800 transition-colors"
                    >
                      <svg width="7" height="7" viewBox="0 0 7 7" fill="none" className="shrink-0"><path d="M3.5 1v2.5H6M3.5 6.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></svg>
                      <span className="truncate">{s.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {job.documentId && (
              <Link href={`/records/${job.documentId}`} onClick={onDismiss} className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">
                View document <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4h5M4.5 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </Link>
            )}
          </div>
        )}
        {failed && <p className="text-[11px] text-red-600 leading-relaxed">{job.error}</p>}
        {waiting && (
          <div className="space-y-2">
            <p className="text-[11px] text-amber-700 leading-relaxed">{job.duplicateMessage ?? "This file already exists in your records."}</p>
            <p className="text-[11px] text-gray-500">Update the existing record with this version, or keep it separate?</p>
            {job.existingDocId && (
              <Link href={`/records/${job.existingDocId}`} onClick={onDismiss} className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-indigo-600 transition-colors">
                View existing <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4h5M4.5 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </Link>
            )}
            <div className="flex gap-2 pt-0.5">
              <button
                onClick={() => { onResolve?.("replace"); onDismiss(); }}
                className="flex-1 text-[11px] font-semibold bg-indigo-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Update existing
              </button>
              <button
                onClick={() => onResolve?.("decline_update")}
                className="flex-1 text-[11px] font-semibold bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-lg hover:bg-gray-200 transition-colors"
              >
                No, keep separate
              </button>
            </div>
          </div>
        )}
        {waitingNewOrSkip && (
          <div className="space-y-2">
            <p className="text-[11px] text-amber-700 leading-relaxed">Add this as a new separate record, or skip the upload entirely?</p>
            {job.existingDocId && (
              <Link href={`/records/${job.existingDocId}`} onClick={onDismiss} className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-indigo-600 transition-colors">
                View existing <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4h5M4.5 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </Link>
            )}
            <div className="flex gap-2 pt-0.5">
              <button
                onClick={() => { onResolve?.("create_new"); onDismiss(); }}
                className="flex-1 text-[11px] font-semibold bg-indigo-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Create new record
              </button>
              <button
                onClick={() => { onResolve?.("skip"); onDismiss(); }}
                className="flex-1 text-[11px] font-semibold bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Skip
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Refine diff helper ───────────────────────────────────────────────────────

function buildRefineSummary(prev: PreviewExtraction, next: PreviewExtraction): string {
  const lines: string[] = [];

  if (prev.docType !== next.docType && next.docType)
    lines.push(`**Document type** updated to ${DOC_TYPE_LABELS[next.docType] ?? next.docType}`);

  if (prev.issueDate !== next.issueDate)
    lines.push(`**Issue date** → ${next.issueDate ?? "—"}`);

  if (prev.expiryDate !== next.expiryDate)
    lines.push(`**Expiry date** → ${next.expiryDate ?? "—"}`);

  if (prev.amount !== next.amount || prev.currency !== next.currency) {
    const val = next.amount != null
      ? `${next.currency ?? ""} ${next.amount.toLocaleString()}`.trim()
      : "—";
    lines.push(`**Amount** → ${val}`);
  }

  if (prev.referenceNumber !== next.referenceNumber)
    lines.push(`**Reference** → ${next.referenceNumber ?? "—"}`);

  if (prev.parties.join("|") !== next.parties.join("|"))
    lines.push(`**Parties** → ${next.parties.length > 0 ? next.parties.join(", ") : "—"}`);

  if (JSON.stringify(prev.paymentSchedule) !== JSON.stringify(next.paymentSchedule))
    lines.push(`**Payment schedule** → ${next.paymentSchedule.length} payment${next.paymentSchedule.length !== 1 ? "s" : ""}`);

  if (prev.notes !== next.notes)
    lines.push(`**Notes** → ${next.notes ?? "—"}`);

  if (prev.summary !== next.summary)
    lines.push(`**Summary** updated`);

  if (prev.isPaid !== next.isPaid)
    lines.push(`**Payment status** → ${next.isPaid === true ? "Paid" : next.isPaid === false ? "Unpaid" : "—"}`);

  if (lines.length === 0) {
    if (JSON.stringify(prev) !== JSON.stringify(next))
      return "Extraction refined — the fields have been updated.";
    return "The extraction already looks accurate — no changes were needed.";
  }

  return `Fields updated:\n${lines.map(l => `- ${l}`).join("\n")}`;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export default function UploadProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  // ── Toast jobs ──
  const [jobs, setJobs] = useState<UploadJob[]>([]);

  const startJob = useCallback((id: string, filename: string) => {
    setJobs(prev => [...prev, { id, filename, status: "analyzing" }]);
  }, []);
  const completeJob = useCallback((id: string, data: Partial<Omit<UploadJob, "id" | "filename" | "status">>) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status: "done" as const, ...data } : j));
  }, []);
  const failJob = useCallback((id: string, error: string) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status: "failed" as const, error } : j));
  }, []);
  const awaitDecisionJob = useCallback((jobId: string, queueItemId: string, existingDocId: string, message: string) => {
    setJobs(prev => prev.map(j => j.id === jobId
      ? { ...j, status: "awaiting_decision" as const, queueItemId, existingDocId, duplicateMessage: message }
      : j
    ));
  }, []);

  const transitionJobToNewOrSkip = useCallback((queueItemId: string) => {
    setJobs(prev => prev.map(j =>
      j.queueItemId === queueItemId ? { ...j, status: "awaiting_new_or_skip" as const } : j
    ));
  }, []);
  const dismissJob = useCallback((id: string) => {
    setJobs(prev => prev.filter(j => j.id !== id));
  }, []);

  // ── Queue state ──
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queuePhase, setQueuePhase] = useState<QueuePhase>("idle");
  const [limitWarning, setLimitWarning] = useState(false);
  // Incremented each time we want to (re)start the processing loop.
  // Using a counter instead of relying on setQueuePhase("running") because React
  // bails out of re-renders when state doesn't change — so if the phase is already
  // "running" (e.g. during a preview), calling setQueuePhase("running") again is a
  // no-op and the effect that restarts the loop never fires.
  const [processingTick, setProcessingTick] = useState(0);

  // Ref always holds the latest queue so the async loop can read it without stale closures
  const queueRef = useRef<QueueItem[]>([]);
  const isProcessingRef = useRef(false);

  const updateQueue = useCallback((updater: (prev: QueueItem[]) => QueueItem[]) => {
    // Update the ref synchronously so the async processing loop always reads
    // the latest state immediately — React's setState functional updater runs
    // during the render cycle (not synchronously), so doing this inside the
    // updater leaves queueRef stale after updateQueue returns in async code.
    const next = updater(queueRef.current);
    queueRef.current = next;
    setQueue(next);
  }, []);

  const addToQueue = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;
    updateQueue(prev => {
      const remaining = MAX_QUEUE_FILES - prev.length;
      if (incoming.length > remaining) setLimitWarning(true);
      return [
        ...prev,
        ...incoming.slice(0, remaining).map(file => ({
          id: crypto.randomUUID(),
          file,
          state: { status: "pending" } as QueueItemState,
        })),
      ];
    });
    // Also reset from "complete" → "queue" so new files added after a completed
    // session show the Analyze button instead of being silently stuck.
    setQueuePhase(p => (p === "idle" || p === "complete") ? "queue" : p);
  }, [updateQueue]);

  const removeFromQueue = useCallback((id: string) => {
    updateQueue(prev => {
      const next = prev.filter(i => i.id !== id);
      if (next.length === 0) setQueuePhase("idle");
      return next;
    });
    setLimitWarning(false);
  }, [updateQueue]);

  const resetQueue = useCallback(() => {
    updateQueue(() => []);
    setQueuePhase("idle");
    setLimitWarning(false);
    isProcessingRef.current = false;
  }, [updateQueue]);

  const resolveDecision = useCallback((queueItemId: string, decision: "replace" | "skip" | "decline_update" | "create_new") => {
    if (decision === "replace") {
      const item = queueRef.current.find(i => i.id === queueItemId);
      if (!item || item.state.status !== "awaiting_decision") return;
      const existingDocId = item.state.existingDocId;
      updateQueue(prev => prev.map(i =>
        i.id === queueItemId
          ? { ...i, state: { status: "pending" }, replaceId: existingDocId }
          : i
      ));
      setJobs(prev => prev.filter(j => j.queueItemId !== queueItemId));
      isProcessingRef.current = false;
      setProcessingTick(t => t + 1);
    } else if (decision === "decline_update") {
      const item = queueRef.current.find(i => i.id === queueItemId);
      if (!item || item.state.status !== "awaiting_decision") return;
      const { message, existingDocId } = item.state;
      updateQueue(prev => prev.map(i =>
        i.id === queueItemId
          ? { ...i, state: { status: "awaiting_new_or_skip", message, existingDocId } }
          : i
      ));
      transitionJobToNewOrSkip(queueItemId);
    } else if (decision === "create_new") {
      const item = queueRef.current.find(i => i.id === queueItemId);
      if (!item || item.state.status !== "awaiting_new_or_skip") return;
      updateQueue(prev => prev.map(i =>
        i.id === queueItemId
          ? { ...i, state: { status: "pending" }, forceNew: true }
          : i
      ));
      setJobs(prev => prev.filter(j => j.queueItemId !== queueItemId));
      isProcessingRef.current = false;
      setProcessingTick(t => t + 1);
    } else {
      // skip
      updateQueue(prev => {
        const next = prev.filter(i => i.id !== queueItemId);
        if (next.length === 0) setQueuePhase("idle");
        return next;
      });
      setJobs(prev => prev.filter(j => j.queueItemId !== queueItemId));
    }
  }, [updateQueue, transitionJobToNewOrSkip]);

  // ── Processing loop — runs in the provider so it survives navigation ──
  const runProcessing = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    setQueuePhase("running");

    // Track whether we broke out of the loop to show a preview.
    // We use a flag instead of checking queueRef.current after the break because
    // updateQueue uses React's setState functional updater — the updater (which
    // syncs queueRef.current) runs during React's render flush, NOT synchronously
    // when updateQueue is called. So queueRef.current is stale immediately after
    // updateQueue returns inside an async function, and checking it would always
    // miss the freshly-set "preview" state, causing setQueuePhase("complete") to
    // fire prematurely and discard the preview before the user ever sees it.
    let pausedForPreview = false;

    // Track items we've already attempted this run. After a 409 or error we call
    // continue, but queueRef.current may still show the item as "processing" (the
    // "awaiting_decision" / "error" state update hasn't flushed yet). Without this
    // set we'd re-find the same stale "processing" item as "pending" and loop
    // forever (or worse, immediately break and fire setQueuePhase("complete")).
    const processedIds = new Set<string>();

    while (true) {
      // Always read from ref for latest state; skip items already attempted
      const pending = queueRef.current.find(i => i.state.status === "pending" && !processedIds.has(i.id));
      if (!pending) break;

      processedIds.add(pending.id);

      // Mark item as processing
      updateQueue(prev => prev.map(i =>
        i.id === pending.id ? { ...i, state: { status: "processing" } } : i
      ));

      const jobId = crypto.randomUUID();
      startJob(jobId, pending.file.name);
      const formData = new FormData();
      formData.append("file", pending.file);
      // Tell the preview route to skip duplicate checks — user already made their decision.
      if (pending.replaceId) formData.append("replaceId", pending.replaceId);
      if (pending.forceNew)  formData.append("forceNew", "true");

      try {
        const res = await fetch("/api/capture/preview", { method: "POST", body: formData });
        const data = await res.json();

        if (res.status === 409 && data.duplicate) {
          awaitDecisionJob(jobId, pending.id, data.existingDocumentId, data.message);
          updateQueue(prev => prev.map(i =>
            i.id === pending.id
              ? { ...i, state: { status: "awaiting_decision", message: data.message, existingDocId: data.existingDocumentId } }
              : i
          ));
          continue;
        }

        if (!res.ok) {
          failJob(jobId, data.error ?? "Upload failed");
          updateQueue(prev => prev.map(i =>
            i.id === pending.id
              ? { ...i, state: { status: "error", message: data.error ?? "Upload failed" } }
              : i
          ));
          continue;
        }

        // Show preview panel — approvePreview already carries replaceId/forceNew from the queue item.
        pausedForPreview = true;
        dismissJob(jobId);
        updateQueue(prev => prev.map(i =>
          i.id === pending.id
            ? {
                ...i,
                state: {
                  status: "preview",
                  tempId: data.tempId,
                  tempFilePath: data.tempFilePath,
                  fileHash: data.fileHash,
                  mimeType: data.mimeType,
                  extraction: data.extraction,
                  chat: [],
                  refining: false,
                  asking: false,
                  approving: false,
                },
              }
            : i
        ));
        break;
      } catch {
        failJob(jobId, "Network error");
        updateQueue(prev => prev.map(i =>
          i.id === pending.id
            ? { ...i, state: { status: "error", message: "Network error — please try again" } }
            : i
        ));
      }
    }

    isProcessingRef.current = false;
    if (!pausedForPreview) {
      setQueuePhase("complete");
      router.refresh();
    }
  }, [startJob, failJob, awaitDecisionJob, dismissJob, updateQueue, router]);

  // ── Preview actions ──

  const approvePreview = useCallback(async (queueItemId: string) => {
    const item = queueRef.current.find(i => i.id === queueItemId);
    if (!item || item.state.status !== "preview") return;
    const { tempFilePath, fileHash, mimeType, extraction } = item.state;

    // Show saving loader in the panel immediately
    updateQueue(prev => prev.map(i =>
      i.id === queueItemId && i.state.status === "preview"
        ? { ...i, state: { ...i.state, approving: true } }
        : i
    ));

    try {
      const res = await fetch("/api/capture/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tempFilePath,
          filename: item.file.name,
          fileHash,
          mimeType,
          extraction,
          replaceId: item.replaceId ?? null,
          forceNew: item.forceNew ?? false,
        }),
      });
      const data = await res.json();

      if (res.status === 409 && data.duplicate) {
        updateQueue(prev => prev.map(i =>
          i.id === queueItemId
            ? { ...i, state: { status: "awaiting_decision", message: data.message, existingDocId: data.existingDocumentId } }
            : i
        ));
        return;
      }

      if (!res.ok) {
        updateQueue(prev => prev.map(i =>
          i.id === queueItemId
            ? { ...i, state: { status: "error", message: data.error ?? "Save failed" } }
            : i
        ));
        return;
      }

      updateQueue(prev => prev.map(i =>
        i.id === queueItemId
          ? {
              ...i,
              state: {
                status: "done",
                result: { ...data.document, parties: data.document.parties ?? [] },
                alertsCreated: data.alertsCreated ?? 0,
                potentialMatches: data.potentialMatches ?? [],
                invoicesCreated: data.invoicesCreated ?? 0,
                invoicesSkipped: data.invoicesSkipped ?? [],
                payrollEntriesCreated: data.payrollEntriesCreated ?? 0,
                contractPersonId: data.contractPersonId ?? null,
              },
            }
          : i
      ));
      isProcessingRef.current = false;
      // Bump processingTick instead of setQueuePhase("running") — the phase may
      // already be "running" (it is during preview), and React bails out of
      // re-renders when state doesn't change, so the effect would never fire.
      setProcessingTick(t => t + 1);
    } catch {
      updateQueue(prev => prev.map(i =>
        i.id === queueItemId
          ? { ...i, state: { status: "error", message: "Network error — please try again" } }
          : i
      ));
      isProcessingRef.current = false;
      setProcessingTick(t => t + 1);
    }
  }, [updateQueue]);

  const rejectPreview = useCallback((queueItemId: string) => {
    let willBeEmpty = false;
    updateQueue(prev => {
      const next = prev.filter(i => i.id !== queueItemId);
      willBeEmpty = next.length === 0;
      return next;
    });
    isProcessingRef.current = false;
    if (willBeEmpty) {
      setQueuePhase("idle");
    } else {
      setProcessingTick(t => t + 1);
    }
  }, [updateQueue]);

  const refinePreview = useCallback(async (queueItemId: string, prompt: string) => {
    const item = queueRef.current.find(i => i.id === queueItemId);
    if (!item || item.state.status !== "preview") return;
    const { tempFilePath, mimeType, extraction } = item.state;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: prompt };

    // Add user message immediately so it's visible while refining
    updateQueue(prev => prev.map(i =>
      i.id === queueItemId && i.state.status === "preview"
        ? { ...i, state: { ...i.state, chat: [...i.state.chat, userMsg], refining: true } }
        : i
    ));

    const addError = (msg: string) => {
      const errMsg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: msg };
      updateQueue(prev => prev.map(i =>
        i.id === queueItemId && i.state.status === "preview"
          ? { ...i, state: { ...i.state, chat: [...i.state.chat, errMsg], refining: false } }
          : i
      ));
    };

    try {
      const res = await fetch("/api/capture/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tempFilePath, mimeType, filename: item.file.name, currentExtraction: extraction, prompt }),
      });
      const data = await res.json();

      if (!res.ok || !data.extraction) {
        addError(data.error ? `Refinement failed: ${data.error}` : "Refinement failed — please try again.");
        return;
      }

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: buildRefineSummary(extraction, data.extraction),
      };

      updateQueue(prev => prev.map(i =>
        i.id === queueItemId && i.state.status === "preview"
          ? {
              ...i,
              state: {
                ...i.state,
                extraction: data.extraction,
                chat: [...i.state.chat, assistantMsg],
                refining: false,
              },
            }
          : i
      ));
    } catch (err) {
      addError(`Refinement failed: ${err instanceof Error ? err.message : "Network error"}`);
    }
  }, [updateQueue]);

  const askPreview = useCallback(async (queueItemId: string, question: string) => {
    const item = queueRef.current.find(i => i.id === queueItemId);
    if (!item || item.state.status !== "preview") return;
    const { tempFilePath, mimeType, extraction, chat } = item.state;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: question };

    // Add user message immediately so it's visible while AI is thinking
    updateQueue(prev => prev.map(i =>
      i.id === queueItemId && i.state.status === "preview"
        ? { ...i, state: { ...i.state, chat: [...i.state.chat, userMsg], asking: true } }
        : i
    ));

    try {
      const res = await fetch("/api/capture/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tempFilePath,
          mimeType,
          filename: item.file.name,
          extraction,
          question,
          chatHistory: chat.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: res.ok && data.answer ? data.answer : (data.error ?? "I was unable to answer that question."),
      };

      updateQueue(prev => prev.map(i =>
        i.id === queueItemId && i.state.status === "preview"
          ? {
              ...i,
              state: {
                ...i.state,
                chat: [...i.state.chat, assistantMsg],
                asking: false,
              },
            }
          : i
      ));
    } catch {
      updateQueue(prev => prev.map(i =>
        i.id === queueItemId && i.state.status === "preview"
          ? { ...i, state: { ...i.state, asking: false } }
          : i
      ));
    }
  }, [updateQueue]);

  const startProcessing = useCallback(() => {
    runProcessing();
  }, [runProcessing]);

  // Restart processing whenever processingTick is bumped (approve, reject, resolve decision).
  // We use a tick counter rather than depending on queuePhase because the phase may already
  // be "running" and React would bail out of the re-render, preventing the effect from firing.
  useEffect(() => {
    if (processingTick > 0 && !isProcessingRef.current && !queueRef.current.some(i => i.state.status === "preview")) {
      runProcessing();
    }
  }, [processingTick, runProcessing]);

  return (
    <UploadContext.Provider value={{
      startJob, completeJob, failJob,
      queue, queuePhase, limitWarning,
      addToQueue, removeFromQueue, startProcessing, resetQueue, resolveDecision,
      approvePreview, rejectPreview, refinePreview, askPreview,
    }}>
      {children}

      {jobs.length > 0 && (
        <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 items-end pointer-events-none">
          {jobs.map(job => (
            <div key={job.id} className="pointer-events-auto">
              <UploadToast
                job={job}
                onDismiss={() => dismissJob(job.id)}
                onResolve={job.queueItemId
                  ? (d) => resolveDecision(job.queueItemId!, d)
                  : undefined
                }
              />
            </div>
          ))}
        </div>
      )}
    </UploadContext.Provider>
  );
}
