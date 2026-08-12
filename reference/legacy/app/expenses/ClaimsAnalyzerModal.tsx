"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";

const EXPENSE_TYPES = [
  "Supplies", "Travel", "Accommodation", "Food & Beverage",
  "Software & Subscriptions", "Marketing & Advertising", "Entertainment",
  "Training & Education", "Equipment", "Utilities", "Professional Services",
  "Medical", "Miscellaneous",
];

type ExtractedClaim = {
  name: string;
  amount: number | null;
  currency: string | null;
  date: string | null;
  expenseType: string | null;
  notes: string | null;
};

type EditableClaim = ExtractedClaim & {
  _id: string;
  selected: boolean;
};

type Step = "upload" | "analyzing" | "review" | "importing" | "done";

export default function ClaimsAnalyzerModal() {
  const activeCurrencies = useActiveCurrencies();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [docSummary, setDocSummary] = useState("");
  const [claims, setClaims] = useState<EditableClaim[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function close() {
    setOpen(false);
    setStep("upload");
    setFile(null);
    setDocSummary("");
    setClaims([]);
    setImportedCount(0);
    setError(null);
    setDragging(false);
  }

  function pickFile(f: File) {
    setFile(f);
    setError(null);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
  }

  async function analyze() {
    if (!file) return;
    setStep("analyzing");
    setError(null);

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch("/api/claim/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.claims)) {
        setError(data.error ?? "Analysis failed — try a different file");
        setStep("upload");
        return;
      }
      const editable: EditableClaim[] = (data.claims as ExtractedClaim[]).map((c, i) => ({
        ...c,
        currency: c.currency ?? "AED",
        _id: String(i),
        selected: true,
      }));
      setClaims(editable);
      setDocSummary(data.docSummary ?? "");
      setStep("review");
    } catch {
      setError("Network error — please try again");
      setStep("upload");
    }
  }

  function updateClaim(id: string, field: keyof ExtractedClaim, value: string | number | null) {
    setClaims(prev => prev.map(c => c._id === id ? { ...c, [field]: value } : c));
  }

  function toggleClaim(id: string) {
    setClaims(prev => prev.map(c => c._id === id ? { ...c, selected: !c.selected } : c));
  }

  async function importClaims() {
    const toImport = claims.filter(c => c.selected);
    if (toImport.length === 0) return;
    setStep("importing");
    setError(null);

    try {
      const res = await fetch("/api/expenses/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expenses: toImport.map(c => ({
            name: c.name,
            amount: c.amount,
            currency: c.currency ?? "AED",
            dueOn: c.date ?? null,
            expenseType: c.expenseType ?? null,
            notes: c.notes ?? null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Import failed");
        setStep("review");
        return;
      }
      setImportedCount(data.count ?? toImport.length);
      setStep("done");
      router.refresh();
    } catch {
      setError("Network error — import failed");
      setStep("review");
    }
  }

  const selectedCount = claims.filter(c => c.selected).length;
  const isWide = step === "review";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-3.5 py-2 rounded-lg transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <path d="M7 1.5v7M4.5 5.5l2.5-3 2.5 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="1.5" y="9.5" width="11" height="3" rx="1" stroke="white" strokeWidth="1.3" />
        </svg>
        Analyze file
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={step !== "analyzing" && step !== "importing" ? close : undefined}
          />
          <div className={`relative bg-white rounded-2xl shadow-xl w-full overflow-hidden transition-all duration-200 ${isWide ? "max-w-3xl" : "max-w-lg"}`}>

            {/* Header */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-surface-border">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  {step === "upload"    && "Analyze expense file"}
                  {step === "analyzing" && "Analyzing document…"}
                  {step === "review"    && `Review extracted claims`}
                  {step === "importing" && "Importing claims…"}
                  {step === "done"      && "Import complete"}
                </h2>
                {step === "review" && docSummary && (
                  <p className="text-[11px] text-gray-400 mt-0.5 max-w-xl leading-relaxed">{docSummary}</p>
                )}
              </div>
              {step !== "analyzing" && step !== "importing" && (
                <button onClick={close} className="text-gray-400 hover:text-gray-600 transition-colors mt-0.5 shrink-0 ml-4">
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                    <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>

            {/* ── Upload ── */}
            {step === "upload" && (
              <div className="px-6 py-5">
                <div
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={() => inputRef.current?.click()}
                  className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-10 px-6 cursor-pointer transition-colors ${
                    dragging
                      ? "border-indigo-400 bg-indigo-50"
                      : file
                        ? "border-emerald-300 bg-emerald-50"
                        : "border-gray-200 hover:border-indigo-300 hover:bg-gray-50/60"
                  }`}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx,.doc,.csv,.txt"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }}
                  />
                  {file ? (
                    <>
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                          <path d="M4 10l4 4 8-8" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium text-gray-900">{file.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{(file.size / 1024).toFixed(0)} KB · Click to change</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                          <path d="M10 4v9M6.5 8l3.5-3.5L13.5 8" stroke="#6366f1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M3 14.5v1A1.5 1.5 0 0 0 4.5 17h11a1.5 1.5 0 0 0 1.5-1.5v-1" stroke="#6366f1" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium text-gray-700">Drop a file or click to browse</p>
                        <p className="text-xs text-gray-400 mt-1">PDF · Image · Excel · Word · CSV</p>
                      </div>
                    </>
                  )}
                </div>

                {error && (
                  <p className="mt-3 text-xs font-medium text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{error}</p>
                )}

                <div className="flex items-center justify-end gap-3 mt-4">
                  <button
                    type="button"
                    onClick={close}
                    className="px-4 py-2 text-sm font-medium text-gray-600 bg-surface-inset border border-surface-border rounded-lg hover:bg-surface-hover transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={analyze}
                    disabled={!file}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-200 disabled:cursor-not-allowed rounded-lg transition-colors"
                  >
                    Analyze
                  </button>
                </div>
              </div>
            )}

            {/* ── Analyzing ── */}
            {step === "analyzing" && (
              <div className="px-6 py-14 flex flex-col items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="animate-spin">
                    <circle cx="12" cy="12" r="9" stroke="#e0e7ff" strokeWidth="2.5" />
                    <path d="M12 3a9 9 0 0 1 9 9" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-gray-900">Analyzing with AI</p>
                  <p className="text-xs text-gray-400 mt-1">Extracting expense claims from {file?.name}</p>
                </div>
              </div>
            )}

            {/* ── Review ── */}
            {step === "review" && (
              <div className="flex flex-col" style={{ maxHeight: "75vh" }}>
                {claims.length === 0 ? (
                  <div className="px-6 py-12 text-center">
                    <p className="text-sm text-gray-500">No expense claims were found in this document.</p>
                    <button
                      onClick={() => { setStep("upload"); setFile(null); setClaims([]); }}
                      className="mt-4 text-xs text-indigo-600 hover:underline"
                    >
                      Try a different file
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="overflow-y-auto flex-1 px-5 pt-4 pb-3 space-y-2">
                      {claims.map(c => (
                        <div
                          key={c._id}
                          className={`rounded-xl border transition-colors ${
                            c.selected ? "border-indigo-100 bg-white shadow-sm" : "border-surface-border bg-gray-50/60 opacity-55"
                          }`}
                        >
                          <div className="flex items-start gap-3 px-4 py-3">
                            <input
                              type="checkbox"
                              checked={c.selected}
                              onChange={() => toggleClaim(c._id)}
                              className="mt-1 h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0 accent-indigo-600"
                            />
                            <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2">
                              {/* Description — full width */}
                              <div className="col-span-2 sm:col-span-4">
                                <label className="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Description</label>
                                <input
                                  type="text"
                                  value={c.name}
                                  onChange={e => updateClaim(c._id, "name", e.target.value)}
                                  disabled={!c.selected}
                                  className="w-full h-7 px-2.5 text-xs text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100 disabled:bg-gray-100 disabled:text-gray-400 transition-colors"
                                />
                              </div>

                              {/* Currency */}
                              <div>
                                <label className="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Currency</label>
                                <select
                                  value={c.currency ?? "AED"}
                                  onChange={e => updateClaim(c._id, "currency", e.target.value)}
                                  disabled={!c.selected}
                                  className="w-full h-7 px-2 text-xs text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100 disabled:bg-gray-100 disabled:text-gray-400"
                                >
                                  {activeCurrencies.map(cur => <option key={cur} value={cur}>{cur}</option>)}
                                </select>
                              </div>

                              {/* Amount */}
                              <div>
                                <label className="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Amount</label>
                                <input
                                  type="number"
                                  value={c.amount ?? ""}
                                  onChange={e => updateClaim(c._id, "amount", e.target.value ? parseFloat(e.target.value) : null)}
                                  disabled={!c.selected}
                                  placeholder="0.00"
                                  min="0"
                                  step="0.01"
                                  className="w-full h-7 px-2.5 text-xs text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100 disabled:bg-gray-100 disabled:text-gray-400 tabular-nums"
                                />
                              </div>

                              {/* Date */}
                              <div>
                                <label className="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Date</label>
                                <input
                                  type="date"
                                  value={c.date ?? ""}
                                  onChange={e => updateClaim(c._id, "date", e.target.value || null)}
                                  disabled={!c.selected}
                                  className="w-full h-7 px-2 text-xs text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100 disabled:bg-gray-100 disabled:text-gray-400"
                                />
                              </div>

                              {/* Type */}
                              <div>
                                <label className="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Type</label>
                                <select
                                  value={c.expenseType ?? ""}
                                  onChange={e => updateClaim(c._id, "expenseType", e.target.value || null)}
                                  disabled={!c.selected}
                                  className="w-full h-7 px-2 text-xs text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100 disabled:bg-gray-100 disabled:text-gray-400"
                                >
                                  <option value="">— No type —</option>
                                  {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </div>

                              {/* Notes — full width */}
                              <div className="col-span-2 sm:col-span-4">
                                <label className="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Notes</label>
                                <input
                                  type="text"
                                  value={c.notes ?? ""}
                                  onChange={e => updateClaim(c._id, "notes", e.target.value || null)}
                                  disabled={!c.selected}
                                  placeholder="Vendor, reference number, etc."
                                  className="w-full h-7 px-2.5 text-xs text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100 disabled:bg-gray-100 disabled:text-gray-400 transition-colors"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {error && (
                      <p className="mx-5 text-xs font-medium text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{error}</p>
                    )}

                    <div className="px-5 py-3.5 border-t border-surface-border flex items-center justify-between gap-3 bg-gray-50/50">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setClaims(p => p.map(c => ({ ...c, selected: true })))}
                          className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          Select all
                        </button>
                        <button
                          onClick={() => setClaims(p => p.map(c => ({ ...c, selected: false })))}
                          className="text-[11px] text-gray-400 hover:text-gray-600"
                        >
                          Clear
                        </button>
                        <span className="text-[11px] text-gray-400">{selectedCount} of {claims.length} selected</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <button
                          onClick={() => { setStep("upload"); setFile(null); setClaims([]); setError(null); }}
                          className="px-3.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-surface-border rounded-lg hover:bg-surface-hover transition-colors"
                        >
                          Back
                        </button>
                        <button
                          onClick={importClaims}
                          disabled={selectedCount === 0}
                          className="px-3.5 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-200 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                          Import {selectedCount} claim{selectedCount !== 1 ? "s" : ""}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Importing ── */}
            {step === "importing" && (
              <div className="px-6 py-14 flex flex-col items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="animate-spin">
                    <circle cx="12" cy="12" r="9" stroke="#e0e7ff" strokeWidth="2.5" />
                    <path d="M12 3a9 9 0 0 1 9 9" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-gray-900">Creating expenses…</p>
              </div>
            )}

            {/* ── Done ── */}
            {step === "done" && (
              <div className="px-6 py-12 flex flex-col items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12l5 5L19 7" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-gray-900">
                    {importedCount} expense{importedCount !== 1 ? "s" : ""} imported
                  </p>
                  <p className="text-xs text-gray-400 mt-1">They are now listed under company expenses</p>
                </div>
                <button
                  onClick={close}
                  className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors mt-1"
                >
                  Done
                </button>
              </div>
            )}

          </div>
        </div>
      )}
    </>
  );
}
