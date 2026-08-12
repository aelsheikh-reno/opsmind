"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { DOC_TYPE_LABELS } from "@/lib/doc-types";
import type { QueueItem, QueueItemState, ChatMessage, PreviewExtraction } from "@/app/contexts/UploadContext";

// ─── helpers ──────────────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 80 ? "bg-green-100 text-green-700" :
    pct >= 50 ? "bg-amber-100 text-amber-700" :
    "bg-red-100 text-red-700";
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${color}`}>
      {pct}% confidence
    </span>
  );
}

function DocTypeBadge({ docType }: { docType: string | null }) {
  if (!docType) return null;
  const colors: Record<string, string> = {
    visa: "bg-blue-50 text-blue-700",
    emirates_id: "bg-purple-50 text-purple-700",
    labor_card: "bg-indigo-50 text-indigo-700",
    trade_license: "bg-amber-50 text-amber-700",
    employee_contract: "bg-green-50 text-green-700",
    client_contract: "bg-teal-50 text-teal-700",
    lease_contract: "bg-cyan-50 text-cyan-700",
    invoice: "bg-orange-50 text-orange-700",
    invoice_report: "bg-orange-50 text-orange-700",
    payroll: "bg-pink-50 text-pink-700",
    insurance: "bg-cyan-50 text-cyan-700",
    government_permit: "bg-red-50 text-red-700",
    other: "bg-gray-100 text-gray-700",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${colors[docType] ?? colors.other}`}>
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
    <div className="w-7 h-9 rounded border flex items-center justify-center shrink-0 bg-white shadow-sm" style={{ borderColor: color + "40" }}>
      <span className="text-[7px] font-bold uppercase" style={{ color }}>{ext || "?"}</span>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
      <span className="text-xs text-gray-800 break-words">{value}</span>
    </div>
  );
}

// ─── confirmation dialog ───────────────────────────────────────────────────────

function ConfirmDialog({
  title, message, confirmLabel, confirmClass, onConfirm, onCancel,
}: {
  title: string; message: string; confirmLabel: string; confirmClass: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-xl border border-surface-border w-72 p-5 flex flex-col gap-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{message}</p>
        </div>
        <div className="flex items-center gap-2 justify-end">
          <button onClick={onCancel} className="text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} className={`text-xs font-semibold text-white px-3 py-1.5 rounded-lg transition-colors ${confirmClass}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── thinking bubble ──────────────────────────────────────────────────────────

function ThinkingBubble() {
  return (
    <div className="flex justify-start">
      <div className="rounded-xl rounded-bl-sm px-3 py-2.5 bg-surface-inset border border-surface-border flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </div>
    </div>
  );
}

// ─── chat bubble ─────────────────────────────────────────────────────────────

const ASSISTANT_BUBBLE_CLASS =
  "max-w-[92%] rounded-xl rounded-bl-sm px-3 py-2.5 bg-surface-inset border border-surface-border text-xs text-gray-700 leading-relaxed " +
  "[&_h1]:text-[11px] [&_h1]:font-bold [&_h1]:text-gray-900 [&_h1]:mb-1.5 [&_h1]:mt-2.5 first:[&_h1]:mt-0 " +
  "[&_h2]:text-[11px] [&_h2]:font-bold [&_h2]:text-gray-900 [&_h2]:mb-1 [&_h2]:mt-2 first:[&_h2]:mt-0 " +
  "[&_h3]:text-[11px] [&_h3]:font-semibold [&_h3]:text-gray-800 [&_h3]:mb-0.5 [&_h3]:mt-1.5 " +
  "[&_strong]:font-semibold [&_strong]:text-gray-900 [&_p]:mb-1.5 last:[&_p]:mb-0 " +
  "[&_ul]:pl-3.5 [&_ul]:mb-1.5 [&_ul]:space-y-0.5 [&_ol]:pl-3.5 [&_ol]:mb-1.5 [&_ol]:space-y-0.5 " +
  "[&_li]:text-gray-700 [&_li]:marker:text-gray-400 [&_hr]:my-2 [&_hr]:border-surface-border " +
  "[&_code]:bg-gray-100 [&_code]:text-gray-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[10px] [&_code]:font-mono";

function ChatBubble({ message, animate = false, onProgress }: {
  message: ChatMessage; animate?: boolean; onProgress?: () => void;
}) {
  const isUser = message.role === "user";
  const [displayed, setDisplayed] = useState(animate ? "" : message.content);
  const [isDone, setIsDone] = useState(!animate);

  useEffect(() => {
    if (!animate) return;
    setDisplayed("");
    setIsDone(false);
    let pos = 0;
    const full = message.content;
    const iv = setInterval(() => {
      pos = Math.min(pos + 4, full.length);
      setDisplayed(full.slice(0, pos));
      onProgress?.();
      if (pos >= full.length) { setIsDone(true); clearInterval(iv); }
    }, 12);
    return () => clearInterval(iv);
  }, [animate, message.content, onProgress]);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      {isUser ? (
        <div className="max-w-[85%] rounded-xl rounded-br-sm px-3 py-2 text-xs leading-relaxed bg-indigo-600 text-white">
          {message.content}
        </div>
      ) : (
        <div className={ASSISTANT_BUBBLE_CLASS}>
          {isDone ? <ReactMarkdown>{message.content}</ReactMarkdown> : (
            <span className="whitespace-pre-wrap">
              {displayed}
              <span className="inline-block w-0.5 h-[0.75em] bg-gray-500 ml-0.5 animate-pulse align-middle" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── types ────────────────────────────────────────────────────────────────────

type PreviewState = Extract<QueueItemState, { status: "preview" }>;
type PreviewItem = QueueItem & { state: PreviewState };

// ─── document details panel (right side — fields + doc preview) ───────────────

export function DocumentDetailsPanel({ item }: { item: PreviewItem }) {
  const { extraction } = item.state;

  const ext = item.file.name.split(".").pop()?.toLowerCase() ?? "";
  const isImage = ["jpg", "jpeg", "png", "webp"].includes(ext);
  const isPdf = ext === "pdf";
  const isDocx = ext === "docx" || ext === "doc";

  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [docxLoading, setDocxLoading] = useState(false);
  const [fieldsFlash, setFieldsFlash] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const prevExtractionRef = useRef(extraction);

  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullscreen]);

  useEffect(() => {
    if (!isImage && !isPdf) return;
    const url = URL.createObjectURL(item.file);
    setDocUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [item.file, isImage, isPdf]);

  useEffect(() => {
    if (!isDocx) return;
    setDocxLoading(true);
    const fd = new FormData();
    fd.append("file", item.file);
    fetch("/api/docx-preview", { method: "POST", body: fd })
      .then(async res => {
        if (!res.ok) { setDocxLoading(false); return; }
        const html = await res.text();
        setDocxHtml(html);
        setDocxLoading(false);
      })
      .catch(() => setDocxLoading(false));
  }, [item.file, isDocx]);

  useEffect(() => {
    if (prevExtractionRef.current !== extraction) {
      prevExtractionRef.current = extraction;
      setFieldsFlash(true);
      const t = setTimeout(() => setFieldsFlash(false), 1200);
      return () => clearTimeout(t);
    }
  }, [extraction]);

  const amountDisplay =
    extraction.amount != null && extraction.currency
      ? `${extraction.currency} ${extraction.amount.toLocaleString("en-US")}`
      : extraction.amount != null ? extraction.amount.toLocaleString("en-US") : null;

  const canFullscreen = (docUrl !== null) || (isDocx && docxHtml !== null);
  const fullscreenModal = fullscreen && canFullscreen ? createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col bg-gray-950">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <p className="text-sm font-medium text-white truncate">{item.file.name}</p>
        <button
          onClick={() => setFullscreen(false)}
          className="ml-4 shrink-0 flex items-center gap-2 text-sm font-semibold text-white bg-gray-700 hover:bg-gray-600 active:bg-gray-500 px-4 py-2 rounded-lg transition-colors border border-gray-600"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          Close fullscreen
        </button>
      </div>
      {isImage && docUrl ? (
        <img src={docUrl} alt={item.file.name} className="flex-1 object-contain min-h-0" />
      ) : isDocx && docxHtml ? (
        <iframe srcDoc={docxHtml} title={item.file.name} className="flex-1 w-full border-0 min-h-0 bg-white" />
      ) : (
        <iframe src={docUrl!} title={item.file.name} className="flex-1 w-full border-0 min-h-0" />
      )}
    </div>,
    document.body
  ) : null;

  return (
    <>
    {fullscreenModal}
    <div className="rounded-xl border border-surface-border overflow-hidden shadow-sm bg-white flex flex-col">
      {/* Extracted fields */}
      <div className={`px-4 py-3 border-b border-surface-border transition-colors duration-700 ${fieldsFlash ? "bg-green-50" : ""}`}>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Extracted fields</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {extraction.parties.length > 0 && (
            <div className="col-span-2 flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Parties</span>
              <span className="text-xs text-gray-800">{extraction.parties.join(" · ")}</span>
            </div>
          )}
          <FieldRow label="Issue date" value={extraction.issueDate} />
          <FieldRow label="Expiry date" value={extraction.expiryDate} />
          <FieldRow label="Amount" value={amountDisplay} />
          <FieldRow label="Reference" value={extraction.referenceNumber} />
          {extraction.notes && (
            <div className="col-span-2 flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Notes</span>
              <span className="text-xs text-gray-600 leading-relaxed">{extraction.notes}</span>
            </div>
          )}
          {extraction.summary && (
            <div className="col-span-2 flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Summary</span>
              <span className="text-xs text-gray-600 leading-relaxed line-clamp-3">{extraction.summary}</span>
            </div>
          )}
        </div>
      </div>

      {/* Payment schedule */}
      {extraction.paymentSchedule.length > 0 && (
        <div className="px-4 py-3 border-b border-surface-border">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Payment schedule ({extraction.paymentSchedule.length} payment{extraction.paymentSchedule.length !== 1 ? "s" : ""})
          </p>
          <div className="overflow-x-auto overflow-y-auto max-h-36 rounded-lg border border-surface-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-surface-inset border-b border-surface-border">
                  <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold text-gray-500">Due date</th>
                  <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold text-gray-500">Description</th>
                  <th className="px-2.5 py-1.5 text-right text-[10px] font-semibold text-gray-500">Amount</th>
                  <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold text-gray-500">Currency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {extraction.paymentSchedule.map((p, i) => (
                  <tr key={i} className="hover:bg-surface-hover transition-colors">
                    <td className="px-2.5 py-1.5 text-gray-700 whitespace-nowrap">{p.dueDate}</td>
                    <td className="px-2.5 py-1.5 text-gray-600 max-w-[160px] truncate">{p.description}</td>
                    <td className="px-2.5 py-1.5 text-gray-800 font-medium text-right whitespace-nowrap">{p.amount.toLocaleString("en-US")}</td>
                    <td className="px-2.5 py-1.5 text-gray-500">{p.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Document preview */}
      {(docUrl || (isDocx && (docxHtml || docxLoading))) ? (
        <>
          {/* Preview header bar with expand button */}
          <div className="px-4 py-2 border-b border-surface-border bg-surface-inset flex items-center justify-between shrink-0">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Document preview</p>
            {!docxLoading && (
              <button
                onClick={() => setFullscreen(true)}
                className="flex items-center gap-1 text-[10px] font-semibold text-gray-500 hover:text-gray-800 hover:bg-gray-100 px-2 py-1 rounded-md transition-colors"
                title="View fullscreen"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M1 4V1h3M7 1h3v3M10 7v3H7M4 10H1V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Expand
              </button>
            )}
          </div>

          {/* Preview content */}
          {docxLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-gray-400 text-xs">
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8 6" />
              </svg>
              Rendering document…
            </div>
          ) : isImage ? (
            <img src={docUrl!} alt={item.file.name} className="w-full object-contain bg-gray-50" style={{ height: 420 }} />
          ) : isDocx && docxHtml ? (
            <iframe srcDoc={docxHtml} title={item.file.name} className="w-full border-0 bg-white" style={{ height: 420 }} />
          ) : (
            <iframe src={docUrl!} title={item.file.name} className="w-full border-0" style={{ height: 420 }} />
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 py-12 px-8 text-center">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect x="6" y="3" width="20" height="26" rx="2" stroke="#d1d5db" strokeWidth="1.5" fill="none" />
            <path d="M11 10h10M11 14h10M11 18h6" stroke="#d1d5db" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <p className="text-xs text-gray-400 leading-relaxed">
            Preview not available for<br /><span className="font-semibold text-gray-500">.{ext}</span> files
          </p>
        </div>
      )}
    </div>
    </>
  );
}

// ─── extraction preview panel (left side — conversation + actions) ─────────────

export default function ExtractionPreviewPanel({
  item, onApprove, onReject, onRefine, onAsk,
}: {
  item: PreviewItem;
  onApprove: () => void;
  onReject: () => void;
  onRefine: (prompt: string) => void;
  onAsk: (question: string) => void;
}) {
  const { state } = item;
  const { extraction, chat, refining, asking, approving } = state;
  const busy = refining || asking || approving;

  const [inputText, setInputText] = useState("");
  const [confirm, setConfirm] = useState<"approve" | "skip" | null>(null);
  const [animatingMessageId, setAnimatingMessageId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollChatToEnd = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.length]);

  useEffect(() => {
    if (chat.length === 0) return;
    const last = chat[chat.length - 1];
    if (last.role === "assistant") setAnimatingMessageId(last.id);
  }, [chat]);

  function handleAsk() {
    const q = inputText.trim();
    if (!q || busy) return;
    setInputText("");
    onAsk(q);
  }

  function handleRefine() {
    const p = inputText.trim();
    if (!p || busy) return;
    setInputText("");
    onRefine(p);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleAsk(); }
  }

  return (
    <>
      {confirm === "approve" && (
        <ConfirmDialog
          title="Approve & Save?"
          message="This will save the extracted data to your records. Make sure the fields on the right look correct before confirming."
          confirmLabel="Yes, save it"
          confirmClass="bg-green-600 hover:bg-green-700"
          onConfirm={() => { setConfirm(null); onApprove(); }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "skip" && (
        <ConfirmDialog
          title="Skip this document?"
          message="The document will be removed from the queue without saving any record. You can upload it again later."
          confirmLabel="Skip"
          confirmClass="bg-gray-700 hover:bg-gray-800"
          onConfirm={() => { setConfirm(null); onReject(); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      <div className="flex flex-col" style={{ minHeight: 540 }}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-surface-border bg-surface-inset shrink-0">
          <div className="flex items-center gap-2.5">
            <FileIcon name={item.file.name} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{item.file.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <DocTypeBadge docType={extraction.docType} />
                <ConfidenceBadge confidence={extraction.confidence} />
              </div>
            </div>
          </div>
        </div>

        {/* Chat thread */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {chat.length === 0 && !asking ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-10 px-6 text-center">
              <div className="w-10 h-10 rounded-full bg-surface-inset border border-surface-border flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <circle cx="9" cy="8" r="5.5" stroke="#9ca3af" strokeWidth="1.4" />
                  <path d="M9 13v3" stroke="#9ca3af" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600">Ask about this document</p>
                <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                  Use <span className="font-medium text-blue-500">Ask AI</span> to get answers, or{" "}
                  <span className="font-medium text-indigo-500">Refine extraction</span> to correct fields on the right.
                </p>
              </div>
            </div>
          ) : (
            <div className="px-4 py-3 space-y-2">
              {chat.map((msg) => (
                <ChatBubble
                  key={msg.id}
                  message={msg}
                  animate={msg.id === animatingMessageId}
                  onProgress={scrollChatToEnd}
                />
              ))}
              {asking && <ThinkingBubble />}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Refining banner */}
        {refining && (
          <div className="px-4 py-2.5 border-t border-indigo-100 bg-indigo-50 flex items-center gap-2 shrink-0">
            <svg className="animate-spin w-4 h-4 text-indigo-500 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-xs font-medium text-indigo-600">Refining extraction — please wait…</span>
          </div>
        )}

        {/* Input area */}
        <div className="px-4 py-3 border-t border-surface-border bg-surface-inset shrink-0">
          <textarea
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={busy}
            placeholder="Type a question or describe a correction to the fields…"
            rows={2}
            className="w-full text-xs text-gray-700 placeholder-gray-400 bg-white border border-surface-border rounded-lg px-3 py-2 resize-none outline-none focus:ring-1 focus:ring-indigo-200 disabled:opacity-50 disabled:bg-surface-inset"
          />
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button
              onClick={handleAsk}
              disabled={busy || !inputText.trim()}
              className="flex flex-col items-start gap-0.5 text-left bg-white hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed border border-surface-border hover:border-blue-200 px-3 py-2 rounded-lg transition-colors group"
            >
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 group-disabled:text-blue-300">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.3" /><path d="M5 7v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                Ask AI
              </span>
              <span className="text-[10px] text-gray-400 leading-snug">Get an answer — fields stay unchanged</span>
            </button>
            <button
              onClick={handleRefine}
              disabled={busy || !inputText.trim()}
              className="flex flex-col items-start gap-0.5 text-left bg-white hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed border border-surface-border hover:border-indigo-200 px-3 py-2 rounded-lg transition-colors group"
            >
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 group-disabled:text-indigo-300">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 8l1.5-1.5L7 3l-1-1-3.5 3.5L1 7l1 1zm5.5-6.5a.7.7 0 0 0-1 0L8 3l1-1-1.5-1.5z" fill="currentColor" /></svg>
                Refine extraction
              </span>
              <span className="text-[10px] text-gray-400 leading-snug">Update the extracted fields</span>
            </button>
          </div>
        </div>

        {/* Action bar */}
        {approving ? (
          <div className="px-4 py-3 bg-green-50 border-t border-green-200 flex items-center justify-center gap-2.5 shrink-0">
            <svg className="animate-spin w-4 h-4 text-green-600 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-xs font-semibold text-green-700">Saving to records…</span>
          </div>
        ) : (
          <div className="px-4 py-3 bg-white border-t border-surface-border flex items-center justify-between shrink-0">
            <button
              onClick={() => setConfirm("skip")}
              disabled={busy}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5h4M8 5l-2-2M8 5l-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Skip
            </button>
            <button
              onClick={() => setConfirm("approve")}
              disabled={busy}
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 disabled:bg-green-300 px-4 py-1.5 rounded-lg transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Approve &amp; Save
            </button>
          </div>
        )}
      </div>
    </>
  );
}
