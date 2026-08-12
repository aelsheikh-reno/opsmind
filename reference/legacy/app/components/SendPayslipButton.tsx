"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

export default function SendPayslipButton({
  entryId,
  personEmail,
  currency,
  defaultContractCurrency = false,
  hidden,
  initialSentCount = 0,
}: {
  entryId: string;
  personEmail: string | null | undefined;
  currency?: string;
  defaultContractCurrency?: boolean;
  hidden?: boolean;
  initialSentCount?: number;
}) {
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState(initialSentCount);
  const [sendError, setSendError] = useState<string | null>(null);
  const [inContractCurrency, setInContractCurrency] = useState(defaultContractCurrency);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  if (hidden) return null;

  const showToggle = currency && currency !== "USD";

  async function send() {
    setSending(true);
    setSendError(null);
    const toastId = toast.loading("Sending payslip…");
    try {
      const res = await fetch("/api/payroll/send-payslip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, contractCurrency: inContractCurrency }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error ?? "Failed to send";
        toast.error(msg, { id: toastId });
        setSendError(msg);
      } else {
        toast.success(`Payslip sent to ${personEmail}`, { id: toastId });
        setSentCount(data.payslipSentCount ?? sentCount + 1);
      }
    } catch {
      const msg = "Network error — check your connection";
      toast.error(msg, { id: toastId });
      setSendError(msg);
    } finally {
      setSending(false);
    }
  }

  async function openPreview() {
    setPreviewLoading(true);
    try {
      const params = new URLSearchParams({ entryId, contractCurrency: String(inContractCurrency) });
      const res = await fetch(`/api/payroll/payslip-preview?${params}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not load preview");
      } else {
        setPreviewHtml(data.html);
      }
    } catch {
      toast.error("Network error loading preview");
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <>
      <div className="mt-0.5">
        <div className="flex items-center gap-1.5">
          {/* Preview button */}
          <button
            onClick={openPreview}
            disabled={previewLoading}
            title="Preview payslip"
            className="flex items-center gap-1 text-[10px] font-medium text-gray-400 hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-1.5 py-1 rounded hover:bg-indigo-50"
          >
            {previewLoading ? (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="animate-spin">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="24" strokeDashoffset="8" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <ellipse cx="8" cy="8" rx="7" ry="4.5" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            )}
            Preview
          </button>

          {/* Send button */}
          <button
            onClick={send}
            disabled={sending || !personEmail}
            title={personEmail ? `Send payslip to ${personEmail}` : "No email address on file — add one in People"}
            className="flex items-center gap-1 text-[10px] font-medium text-gray-400 hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-1.5 py-1 rounded hover:bg-indigo-50"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12v8.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4Z" stroke="currentColor" strokeWidth="1.3" fill="none"/>
              <path d="M2 4l6 5 6-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {sending ? "Sending…" : "Send payslip"}
          </button>

          {showToggle && (
            <button
              onClick={() => setInContractCurrency(v => !v)}
              title={inContractCurrency ? `Payslip will show amounts in ${currency}` : "Payslip will show total in USD (default) — click to switch to contract currency"}
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded transition-colors ${
                inContractCurrency
                  ? "bg-indigo-100 text-indigo-700"
                  : "bg-gray-100 text-gray-400 hover:bg-gray-200"
              }`}
            >
              {inContractCurrency ? currency : "USD"}
            </button>
          )}

          {sentCount > 0 && (
            <span
              title={`Payslip sent ${sentCount} time${sentCount !== 1 ? "s" : ""}`}
              className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full"
            >
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                <path d="M5 1.5A3.5 3.5 0 1 1 1.5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <path d="M1.5 2.5V5H4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {sentCount}×
            </span>
          )}
        </div>
        {sendError && (
          <p className="text-[10px] text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1 mt-1 leading-snug">
            Email failed: {sendError}
          </p>
        )}
      </div>

      {/* Preview modal — rendered via portal to escape any parent stacking context */}
      {previewHtml && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setPreviewHtml(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden" style={{ maxHeight: "90vh" }}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
              <p className="text-sm font-semibold text-gray-900">Payslip preview</p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400">This is exactly what the employee will receive.</span>
                <button
                  onClick={() => setPreviewHtml(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors ml-2"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-5 bg-gray-50">
              <iframe
                srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif}</style></head><body>${previewHtml}</body></html>`}
                className="w-full rounded-lg border border-gray-200"
                style={{ minHeight: "600px", height: "auto" }}
                onLoad={(e) => {
                  const iframe = e.currentTarget;
                  if (iframe.contentWindow) {
                    iframe.style.height = iframe.contentWindow.document.body.scrollHeight + "px";
                  }
                }}
              />
            </div>
            <div className="px-5 py-3.5 border-t border-gray-100 flex justify-end gap-2 shrink-0 bg-white">
              <button
                onClick={() => setPreviewHtml(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => { setPreviewHtml(null); send(); }}
                disabled={!personEmail || sending}
                title={personEmail ? undefined : "No email address on file"}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                Send payslip
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
