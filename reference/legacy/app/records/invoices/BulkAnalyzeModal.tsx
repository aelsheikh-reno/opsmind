"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

type InvoiceRow = {
  id: string;
  // source file context (all rows from same file share these)
  filename: string;
  filePath: string;
  fileHash: string;
  mimeType: string;
  confidence: number;
  issuingCountry: string;
  // per-row fields
  referenceNumber: string;
  parties: string[];
  issueDate: string;
  expiryDate: string;
  amount: number;
  currency: string;
  summary: string;
  notes: string;
  isPaid: boolean;
  paidDate: string;
  decision: "publish" | "skip";
};

type SourceFile = {
  id: string;
  file: File;
  phase: "pending" | "analyzing" | "done" | "failed";
  reason?: string;
  rowCount?: number;
};

function uid() { return Math.random().toString(36).slice(2, 10); }

function fmtAmt(amount: number, currency: string) {
  if (!amount) return null;
  return `${currency} ${amount.toLocaleString("en-US")}`.trim();
}

const ACCEPTED = ".pdf,image/jpeg,image/png,image/webp,.xlsx,.xls";
const XLSX_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

export default function BulkAnalyzeModal() {
  const router = useRouter();
  const [open, setOpen]             = useState(false);
  const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([]);
  const [rows, setRows]             = useState<InvoiceRow[]>([]);
  const [phase, setPhase]           = useState<"idle" | "analyzing" | "review" | "saving" | "done">("idle");
  const [saveError, setSaveError]   = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging]     = useState(false);

  function close() {
    setOpen(false);
    setSourceFiles([]);
    setRows([]);
    setPhase("idle");
    setSaveError(null);
    setSavedCount(0);
  }

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter(
      f => f.type === "application/pdf" || f.type.startsWith("image/") || XLSX_TYPES.includes(f.type)
    );
    setSourceFiles(prev => [
      ...prev,
      ...arr.map(f => ({ id: uid(), file: f, phase: "pending" as const })),
    ]);
  }

  function removeFile(id: string) {
    setSourceFiles(prev => prev.filter(f => f.id !== id));
  }

  function decide(id: string, decision: "publish" | "skip") {
    setRows(prev => prev.map(r => r.id === id ? { ...r, decision } : r));
  }

  function decideAll(decision: "publish" | "skip") {
    setRows(prev => prev.map(r => ({ ...r, decision })));
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, []);

  async function runAnalysis() {
    if (sourceFiles.length === 0) return;
    setPhase("analyzing");
    const allRows: InvoiceRow[] = [];

    for (const sf of sourceFiles) {
      setSourceFiles(prev => prev.map(f => f.id === sf.id ? { ...f, phase: "analyzing" } : f));

      const fd = new FormData();
      fd.append("file", sf.file);

      try {
        const res  = await fetch("/api/invoices/analyze", { method: "POST", body: fd });
        const data = await res.json();

        if (!res.ok || !data.valid) {
          setSourceFiles(prev => prev.map(f =>
            f.id === sf.id ? { ...f, phase: "failed", reason: data.reason ?? "Failed" } : f
          ));
          continue;
        }

        const extraction    = data.extraction;
        const docType       = extraction?.docType as string;
        const confidence    = extraction?.confidence ?? 0.8;
        const issuingCountry = extraction?.issuingCountry ?? "";
        const filePath      = data.filePath as string;
        const fileHash      = data.fileHash as string;
        const mimeType      = data.mimeType as string;

        let fileRows: InvoiceRow[] = [];

        if (docType === "invoice_report" && Array.isArray(extraction?.invoices) && extraction.invoices.length > 0) {
          // expand every row in the report
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          fileRows = extraction.invoices.map((inv: any) => ({
            id: uid(),
            filename: sf.file.name,
            filePath,
            fileHash,
            mimeType,
            confidence,
            issuingCountry,
            referenceNumber: inv.referenceNumber ?? "",
            parties:         inv.parties ?? [],
            issueDate:       inv.issueDate ?? "",
            expiryDate:      inv.expiryDate ?? "",
            amount:          inv.amount ?? 0,
            currency:        inv.currency ?? "",
            summary:         inv.summary ?? "",
            notes:           inv.notes ?? "",
            isPaid:          inv.isPaid ?? false,
            paidDate:        inv.paidDate ?? "",
            decision:        "publish" as const,
          }));
        } else if (docType === "invoice") {
          // single invoice — one row
          fileRows = [{
            id: uid(),
            filename:        sf.file.name,
            filePath,
            fileHash,
            mimeType,
            confidence,
            issuingCountry,
            referenceNumber: extraction.referenceNumber ?? "",
            parties:         extraction.parties ?? [],
            issueDate:       extraction.issueDate ?? "",
            expiryDate:      extraction.expiryDate ?? "",
            amount:          extraction.amount ?? 0,
            currency:        extraction.currency ?? "",
            summary:         extraction.summary ?? "",
            notes:           extraction.notes ?? "",
            isPaid:          extraction.isPaid ?? false,
            paidDate:        extraction.paidDate ?? "",
            decision:        "publish" as const,
          }];
        } else {
          setSourceFiles(prev => prev.map(f =>
            f.id === sf.id
              ? { ...f, phase: "failed", reason: `Not an invoice (${docType?.replace(/_/g, " ") ?? "unknown"})` }
              : f
          ));
          continue;
        }

        allRows.push(...fileRows);
        setSourceFiles(prev => prev.map(f =>
          f.id === sf.id ? { ...f, phase: "done", rowCount: fileRows.length } : f
        ));
      } catch {
        setSourceFiles(prev => prev.map(f =>
          f.id === sf.id ? { ...f, phase: "failed", reason: "Network error" } : f
        ));
      }
    }

    setRows(allRows);
    setPhase("review");
  }

  async function publishSelected() {
    setSaveError(null);
    const toSave = rows.filter(r => r.decision === "publish");
    if (toSave.length === 0) return;

    setPhase("saving");
    try {
      const res = await fetch("/api/invoices/bulk-save", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: toSave.map(r => ({
            filename:   r.filename,
            filePath:   r.filePath,
            fileHash:   r.fileHash,
            mimeType:   r.mimeType,
            extraction: {
              docType:         "invoice",
              confidence:      r.confidence,
              parties:         r.parties,
              summary:         r.summary,
              referenceNumber: r.referenceNumber || null,
              issueDate:       r.issueDate       || null,
              expiryDate:      r.expiryDate      || null,
              amount:          r.amount          || null,
              currency:        r.currency        || null,
              vatAmount:       null,
              issuingCountry:  r.issuingCountry  || null,
              notes:           r.notes           || null,
              isPaid:          r.isPaid,
              paidDate:        r.paidDate        || null,
            },
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ?? "Save failed");
        setPhase("review");
        return;
      }
      setSavedCount(data.created ?? toSave.length);
      setPhase("done");
      router.refresh();
    } catch {
      setSaveError("Network error — please try again");
      setPhase("review");
    }
  }

  const publishCount = rows.filter(r => r.decision === "publish").length;
  const allPublish   = rows.length > 0 && rows.every(r => r.decision === "publish");

  return (
    <>
      {/* Trigger */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-white border border-gray-200 hover:bg-surface-hover text-gray-700 text-xs font-medium px-3.5 py-2 rounded-lg transition-colors"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M6 1v7M3 4l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M1 10h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M3.5 7.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Bulk upload
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border shrink-0">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Bulk invoice upload</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {phase === "idle"      && "Upload an invoice report — AI extracts each row for you to review"}
                  {phase === "analyzing" && `Analyzing ${sourceFiles.length} file${sourceFiles.length !== 1 ? "s" : ""}…`}
                  {phase === "review"    && `${rows.length} invoice${rows.length !== 1 ? "s" : ""} extracted · select which to publish`}
                  {phase === "saving"    && "Publishing selected invoices…"}
                  {phase === "done"      && `${savedCount} invoice${savedCount !== 1 ? "s" : ""} published to records`}
                </p>
              </div>
              <button onClick={close} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">

              {/* ── idle ── */}
              {phase === "idle" && (
                <div className="px-5 py-4 space-y-3">
                  <div
                    onDragOver={e => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-2 cursor-pointer transition-colors ${
                      dragging ? "border-gray-400 bg-gray-50" : "border-gray-200 hover:border-gray-300 hover:bg-surface-inset"
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                        <path d="M10 3v10M6 7l4-4 4 4" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M3 16h14" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-gray-700">Drop an invoice report</p>
                    <p className="text-xs text-gray-400">Excel or PDF · AI extracts every invoice row</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={ACCEPTED}
                      className="hidden"
                      onChange={e => { if (e.target.files) { addFiles(e.target.files); e.target.value = ""; } }}
                    />
                  </div>

                  {sourceFiles.length > 0 && (
                    <div className="space-y-1.5">
                      {sourceFiles.map(sf => (
                        <div key={sf.id} className="flex items-center gap-2 bg-surface-inset rounded-lg px-3 py-2">
                          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="shrink-0 text-gray-400">
                            <path d="M3 1h5.5L11 3.5V13H3V1z" stroke="currentColor" strokeWidth="1.2" fill="none" />
                            <path d="M8 1v3h3" stroke="currentColor" strokeWidth="1.2" />
                          </svg>
                          <span className="flex-1 text-xs text-gray-700 truncate">{sf.file.name}</span>
                          <span className="text-[10px] text-gray-400">{(sf.file.size / 1024).toFixed(0)} KB</span>
                          <button onClick={() => removeFile(sf.id)} className="text-gray-300 hover:text-gray-500 transition-colors">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── analyzing ── */}
              {phase === "analyzing" && (
                <div className="px-5 py-4 space-y-2">
                  {sourceFiles.map(sf => (
                    <div key={sf.id} className="flex items-center gap-3 bg-surface-inset rounded-lg px-3 py-2.5">
                      {sf.phase === "analyzing" && (
                        <svg width="14" height="14" viewBox="0 0 14 14" className="animate-spin shrink-0 text-gray-400" fill="none">
                          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" strokeDasharray="8 8" />
                        </svg>
                      )}
                      {sf.phase === "pending" && <div className="w-3.5 h-3.5 rounded-full border border-gray-300 shrink-0" />}
                      {sf.phase === "done" && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0 text-green-500">
                          <path d="M2.5 7l3.5 3.5 5.5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      {sf.phase === "failed" && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0 text-red-400">
                          <path d="M3 3l8 8M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      )}
                      <span className="flex-1 text-xs text-gray-700 truncate">{sf.file.name}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">
                        {sf.phase === "analyzing" && "Extracting rows…"}
                        {sf.phase === "pending"   && "Waiting…"}
                        {sf.phase === "done"      && `${sf.rowCount} row${sf.rowCount !== 1 ? "s" : ""} found`}
                        {sf.phase === "failed"    && (sf.reason ?? "Failed")}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── review ── */}
              {phase === "review" && (
                <>
                  {rows.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-14 text-center px-8">
                      <p className="text-sm text-gray-500">No invoices could be extracted from the uploaded file.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-surface-border bg-surface-inset">
                            <th className="w-10 px-4 py-2.5 text-left">
                              <input
                                type="checkbox"
                                checked={allPublish}
                                onChange={e => decideAll(e.target.checked ? "publish" : "skip")}
                                className="rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
                              />
                            </th>
                            <th className="px-2 py-2.5 text-left font-medium text-gray-500">Ref #</th>
                            <th className="px-2 py-2.5 text-left font-medium text-gray-500">Vendor</th>
                            <th className="px-2 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap">Issue date</th>
                            <th className="px-2 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap">Due date</th>
                            <th className="px-2 py-2.5 text-right font-medium text-gray-500 pr-4">Amount</th>
                            <th className="px-2 py-2.5 text-left font-medium text-gray-500">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-border">
                          {rows.map(row => {
                            const checked = row.decision === "publish";
                            return (
                              <tr
                                key={row.id}
                                onClick={() => decide(row.id, checked ? "skip" : "publish")}
                                className={`cursor-pointer transition-colors hover:bg-surface-inset/60 ${!checked ? "opacity-40" : ""}`}
                              >
                                <td className="px-4 py-2.5">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={e => decide(row.id, e.target.checked ? "publish" : "skip")}
                                    onClick={e => e.stopPropagation()}
                                    className="rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
                                  />
                                </td>
                                <td className="px-2 py-2.5">
                                  <span className="font-mono text-gray-600">{row.referenceNumber || "—"}</span>
                                </td>
                                <td className="px-2 py-2.5 max-w-[150px]">
                                  <p className="text-gray-800 truncate">{row.parties[0] ?? "—"}</p>
                                </td>
                                <td className="px-2 py-2.5 text-gray-500 whitespace-nowrap">
                                  {row.issueDate || "—"}
                                </td>
                                <td className="px-2 py-2.5 text-gray-500 whitespace-nowrap">
                                  {row.expiryDate || "—"}
                                </td>
                                <td className="px-2 py-2.5 pr-4 text-right tabular-nums">
                                  {row.amount ? (
                                    <span className="font-semibold text-gray-900">{fmtAmt(row.amount, row.currency)}</span>
                                  ) : (
                                    <span className="text-gray-400">—</span>
                                  )}
                                </td>
                                <td className="px-2 py-2.5">
                                  {row.isPaid ? (
                                    <span className="inline-flex items-center text-[10px] font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full">
                                      Paid
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">
                                      Unpaid
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {saveError && (
                    <div className="px-5 py-3 border-t border-surface-border">
                      <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>
                    </div>
                  )}
                </>
              )}

              {/* ── saving ── */}
              {phase === "saving" && (
                <div className="flex flex-col items-center gap-3 py-14 text-center">
                  <svg width="28" height="28" viewBox="0 0 28 28" className="animate-spin text-gray-400" fill="none">
                    <circle cx="14" cy="14" r="11" stroke="currentColor" strokeWidth="2" strokeDasharray="16 16" />
                  </svg>
                  <p className="text-sm text-gray-600">Publishing {publishCount} invoice{publishCount !== 1 ? "s" : ""}…</p>
                </div>
              )}

              {/* ── done ── */}
              {phase === "done" && (
                <div className="flex flex-col items-center gap-3 py-14 text-center px-8">
                  <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M4 10l4.5 4.5 8-8" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-gray-900">{savedCount} invoice{savedCount !== 1 ? "s" : ""} published</p>
                  <p className="text-xs text-gray-400">Now visible in the invoices table</p>
                </div>
              )}

            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-surface-border shrink-0">
              {phase === "done" ? (
                <>
                  <span />
                  <button
                    onClick={close}
                    className="text-xs font-semibold bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg transition-colors"
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <button onClick={close} className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
                    Cancel
                  </button>

                  {phase === "idle" && (
                    <button
                      onClick={runAnalysis}
                      disabled={sourceFiles.length === 0}
                      className="flex items-center gap-1.5 text-xs font-semibold bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg transition-colors"
                    >
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                        <circle cx="6" cy="6" r="5" stroke="white" strokeWidth="1.3" />
                        <path d="M4.5 4.5L7.5 6 4.5 7.5Z" fill="white" />
                      </svg>
                      Analyze {sourceFiles.length > 0 ? `${sourceFiles.length} ` : ""}file{sourceFiles.length !== 1 ? "s" : ""}
                    </button>
                  )}

                  {phase === "review" && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{publishCount} of {rows.length} selected</span>
                      <button
                        onClick={publishSelected}
                        disabled={publishCount === 0}
                        className="flex items-center gap-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg transition-colors"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Publish {publishCount > 0 ? `${publishCount} ` : ""}invoice{publishCount !== 1 ? "s" : ""}
                      </button>
                    </div>
                  )}

                  {(phase === "analyzing" || phase === "saving") && (
                    <span className="text-xs text-gray-400">
                      {phase === "analyzing" ? "Processing…" : "Publishing…"}
                    </span>
                  )}
                </>
              )}
            </div>

          </div>
        </div>
      )}
    </>
  );
}
