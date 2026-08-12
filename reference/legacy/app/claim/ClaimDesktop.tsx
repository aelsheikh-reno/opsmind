"use client";

import { useRef } from "react";
import { EXPENSE_TYPES, type ClaimDraft } from "./useClaimLogic";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";
import type { useClaimLogic } from "./useClaimLogic";

type Logic = ReturnType<typeof useClaimLogic>;

export default function ClaimDesktop(p: Logic) {
  const activeCurrencies = useActiveCurrencies();
  const desktopOtpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const { step, setStep, people, loadingPeople, personId, setPersonId, claimCount, setClaimCount,
    isPettyCash, setIsPettyCash, floatId, setFloatId,
    currentIndex, setCurrentIndex, claims, fileInputRef, tokenId: _t, maskedEmail,
    otpInputs, otpRefs, submitting, error, selectedPerson,
    setClaimField, handleFile, startWizard, nextClaim, prevClaim, sendOtp, submit,
    handleOtpKey, handleOtpChange,
    bulkFile, bulkAnalyzing, bulkFailed, extractedItems, docSummary,
    bulkFileInputRef, startAnalyze, handleBulkUpload, setExtractedItemField, applyBulkClaims } = p;

  // ── Success ──────────────────────────────────────────────────────────────────
  if (step === "success") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 max-w-md w-full text-center">
          <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            {claims.length === 1 ? "Claim submitted" : `${claims.length} claims submitted`}
          </h1>
          <p className="text-sm text-gray-500">Your expense {claims.length === 1 ? "claim has" : "claims have"} been received and will be reviewed shortly.</p>
        </div>
      </div>
    );
  }

  // ── OTP ──────────────────────────────────────────────────────────────────────
  if (step === "otp") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full">
          <button onClick={() => { setStep("review"); p.setError(""); }}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back
          </button>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Check your email</h1>
          <p className="text-sm text-gray-500 mb-7">
            Code sent to <span className="font-medium text-gray-700">{maskedEmail}</span>. Expires in 10 minutes.
          </p>
          <div className="flex gap-2 justify-center mb-6">
            {otpInputs.map((v, i) => (
              <input key={i} ref={(el) => { desktopOtpRefs.current[i] = el; }}
                type="tel" inputMode="numeric" maxLength={1} value={v}
                onChange={(e) => handleOtpChange(i, e.target.value, desktopOtpRefs)}
                onKeyDown={(e) => handleOtpKey(i, e, desktopOtpRefs)}
                onFocus={(e) => e.target.select()}
                className="w-11 h-12 text-center text-xl font-semibold border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition"
              />
            ))}
          </div>
          {error && <p className="text-xs text-red-500 mb-4 text-center">{error}</p>}
          <button onClick={submit} disabled={submitting || otpInputs.join("").length !== 6}
            className="w-full py-3 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {submitting ? "Submitting…" : `Confirm ${claims.length === 1 ? "claim" : `${claims.length} claims`}`}
          </button>
          <button onClick={sendOtp} disabled={submitting}
            className="w-full mt-3 py-2.5 text-xs text-gray-400 hover:text-indigo-600 transition-colors">
            Resend code
          </button>
        </div>
      </div>
    );
  }

  // ── Review ───────────────────────────────────────────────────────────────────
  if (step === "review") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-lg w-full">
          <button onClick={() => { setStep("claims"); setCurrentIndex(claims.length - 1); p.setError(""); }}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back
          </button>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Review your claims</h1>
          <p className="text-sm text-gray-400 mb-6">{selectedPerson?.name} · {claims.length} claim{claims.length > 1 ? "s" : ""}</p>
          <div className="space-y-3 mb-6">
            {claims.map((c, i) => (
              <div key={i} className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
                <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-indigo-600">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.amount && <span className="text-sm font-semibold text-gray-900">{c.currency} {parseFloat(c.amount).toLocaleString("en-US")}</span>}
                    {c.expenseType && <span className="text-[10px] font-medium bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{c.expenseType}</span>}
                    {c.date && <span className="text-[10px] text-gray-400">{new Date(c.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
                  </div>
                  {c.notes && <p className="text-xs text-gray-500 mt-0.5 truncate">{c.notes}</p>}
                  {c.file && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{c.file.name}</p>}
                </div>
                <button onClick={() => { setCurrentIndex(i); setStep("claims"); }}
                  className="text-xs text-indigo-500 hover:text-indigo-700 shrink-0">Edit</button>
              </div>
            ))}
          </div>
          {error && <p className="text-xs text-red-500 mb-4">{error}</p>}
          <button onClick={sendOtp} disabled={submitting}
            className="w-full py-3 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {submitting ? "Sending code…" : "Send verification code"}
          </button>
        </div>
      </div>
    );
  }

  // ── Claim wizard ─────────────────────────────────────────────────────────────
  if (step === "claims") {
    const claim = claims[currentIndex];
    const isLast = currentIndex === claims.length - 1;
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-lg w-full">
          <div className="flex items-center justify-between mb-6">
            <button onClick={prevClaim}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back
            </button>
            <div className="flex items-center gap-1.5">
              {claims.map((_, i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all ${i === currentIndex ? "w-6 bg-indigo-500" : i < currentIndex ? "w-3 bg-indigo-200" : "w-3 bg-gray-200"}`} />
              ))}
            </div>
            <span className="text-xs font-medium text-gray-400">{currentIndex + 1} / {claims.length}</span>
          </div>

          <h1 className="text-base font-semibold text-gray-900 mb-1">Claim {currentIndex + 1}</h1>
          <p className="text-xs text-gray-400 mb-5">Upload your receipt — we&apos;ll fill in the details automatically.</p>

          {claim.analyzing && (
            <div className="flex items-center gap-2.5 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 mb-4">
              <svg className="animate-spin shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#c7d2fe" strokeWidth="3"/>
                <path d="M12 2a10 10 0 0 1 10 10" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round"/>
              </svg>
              <p className="text-xs font-medium text-indigo-700">Analyzing receipt — filling in fields…</p>
            </div>
          )}
          {claim.analyzeFailed && !claim.analyzing && (
            <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="shrink-0">
                <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#d97706" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <p className="text-xs font-medium text-amber-700">Analysis failed — please fill in the fields manually.</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Receipt {!claim.file && <span className="ml-1 text-indigo-500 font-normal">· attach to auto-fill fields</span>}
              </label>
              {claim.file ? (
                <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-gray-400">
                    <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V6L9 1z" stroke="currentColor" strokeWidth="1.3" fill="none"/>
                    <path d="M9 1v5h5" stroke="currentColor" strokeWidth="1.3"/>
                  </svg>
                  <span className="flex-1 text-xs text-gray-700 truncate">{claim.file.name}</span>
                  <button onClick={() => setClaimField(currentIndex, "file", null)}
                    className="text-gray-300 hover:text-red-400 transition-colors shrink-0">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              ) : (
                <div onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); handleFile(currentIndex, e.dataTransfer.files); }}
                  className="border-2 border-dashed border-gray-200 hover:border-indigo-300 rounded-xl p-6 text-center cursor-pointer transition-colors">
                  <svg className="mx-auto mb-2 text-gray-300" width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M12 16V8m0 0l-3 3m3-3l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M20 16.5A4.5 4.5 0 0015.5 12H15a6 6 0 10-11.8 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  <p className="text-xs text-gray-400">Click or drag receipt here</p>
                  <p className="text-[10px] text-gray-300 mt-1">JPG, PNG, PDF supported</p>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden"
                onChange={(e) => handleFile(currentIndex, e.target.files)} />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Claim date</label>
              <input type="date" value={claim.date} max={new Date().toISOString().split("T")[0]}
                onChange={(e) => setClaimField(currentIndex, "date", e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50"/>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Amount <span className="text-gray-400">(optional)</span></label>
              <div className="flex gap-2">
                <select value={claim.currency} onChange={(e) => setClaimField(currentIndex, "currency", e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 bg-white">
                  {activeCurrencies.map((c) => <option key={c}>{c}</option>)}
                </select>
                <input type="text" inputMode="decimal" placeholder="0.00" value={claim.amount}
                  onChange={(e) => setClaimField(currentIndex, "amount", e.target.value)}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50"/>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Expense type <span className="text-gray-400">(optional)</span></label>
              <select value={claim.expenseType} onChange={(e) => setClaimField(currentIndex, "expenseType", e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 bg-white">
                <option value="">Select type</option>
                {EXPENSE_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Description <span className="text-gray-400">(optional)</span></label>
              <textarea rows={2} placeholder="What is this expense for?" value={claim.notes}
                onChange={(e) => setClaimField(currentIndex, "notes", e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 resize-none"/>
            </div>
          </div>

          {error && <p className="text-xs text-red-500 mt-4">{error}</p>}
          <button onClick={nextClaim} disabled={claim.analyzing}
            className="w-full mt-6 py-3 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {isLast ? "Review claims" : "Next claim →"}
          </button>
        </div>
      </div>
    );
  }

  // ── Analyze ──────────────────────────────────────────────────────────────────
  if (step === "analyze") {
    const activeCount = extractedItems.filter(c => !c.excluded).length;
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-2xl w-full">
          <button onClick={() => { setStep("setup"); p.setError(""); }}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back
          </button>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Analyze a document</h1>
          <p className="text-sm text-gray-400 mb-6">Upload a receipt or statement — we&apos;ll extract the expenses automatically.</p>

          {!bulkFile ? (
            <div onClick={() => bulkFileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleBulkUpload(f); }}
              className="border-2 border-dashed border-gray-200 hover:border-indigo-300 rounded-xl p-10 text-center cursor-pointer transition-colors mb-6">
              <svg className="mx-auto mb-3 text-gray-300" width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path d="M12 16V8m0 0l-3 3m3-3l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M20 16.5A4.5 4.5 0 0015.5 12H15a6 6 0 10-11.8 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              <p className="text-sm font-medium text-gray-500">Click or drag a file here</p>
              <p className="text-xs text-gray-400 mt-1">JPG, PNG, PDF — receipts, invoices, statements</p>
            </div>
          ) : bulkAnalyzing ? (
            <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-5 py-4 mb-6">
              <svg className="animate-spin shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#c7d2fe" strokeWidth="3"/>
                <path d="M12 2a10 10 0 0 1 10 10" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round"/>
              </svg>
              <div>
                <p className="text-sm font-medium text-indigo-700">Analyzing document…</p>
                <p className="text-xs text-indigo-400 mt-0.5">{bulkFile.name}</p>
              </div>
            </div>
          ) : bulkFailed ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-6">
              <p className="text-sm font-medium text-amber-700 mb-1">Could not extract claims from this document.</p>
              <p className="text-xs text-amber-500 mb-3">Try a clearer image or a different file.</p>
              <button onClick={() => { p.setError(""); bulkFileInputRef.current?.click(); }}
                className="text-xs font-medium text-amber-700 underline underline-offset-2">Try another file</button>
            </div>
          ) : extractedItems.length > 0 ? (
            <div>
              {docSummary && <p className="text-xs text-gray-400 mb-4 bg-gray-50 rounded-lg px-3 py-2">{docSummary}</p>}
              <p className="text-xs font-medium text-gray-600 mb-3">{extractedItems.length} claim{extractedItems.length !== 1 ? "s" : ""} found — review and edit before importing</p>
              <div className="space-y-3 mb-6 max-h-[50vh] overflow-y-auto pr-1">
                {extractedItems.map((item, i) => (
                  <div key={i} className={`border rounded-xl p-4 transition-opacity ${item.excluded ? "border-gray-100 bg-gray-50 opacity-50" : "border-gray-200 bg-white"}`}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="flex gap-1.5">
                          <select value={item.currency}
                            onChange={(e) => setExtractedItemField(i, "currency", e.target.value)}
                            disabled={item.excluded}
                            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 bg-white focus:outline-none focus:border-indigo-400 disabled:opacity-60">
                            {activeCurrencies.map((c) => <option key={c}>{c}</option>)}
                          </select>
                          <input type="text" inputMode="decimal" placeholder="Amount"
                            value={item.amount}
                            onChange={(e) => setExtractedItemField(i, "amount", e.target.value)}
                            disabled={item.excluded}
                            className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-indigo-400 disabled:opacity-60"/>
                        </div>
                        <input type="date" value={item.date}
                          max={new Date().toISOString().split("T")[0]}
                          onChange={(e) => setExtractedItemField(i, "date", e.target.value)}
                          disabled={item.excluded}
                          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 bg-white focus:outline-none focus:border-indigo-400 disabled:opacity-60"/>
                      </div>
                      <button onClick={() => setExtractedItemField(i, "excluded", !item.excluded)}
                        className={`shrink-0 text-[10px] font-medium px-2 py-1 rounded-lg transition-colors ${item.excluded ? "bg-gray-100 text-gray-400 hover:bg-gray-200" : "bg-red-50 text-red-400 hover:bg-red-100"}`}>
                        {item.excluded ? "Include" : "Remove"}
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <select value={item.expenseType}
                        onChange={(e) => setExtractedItemField(i, "expenseType", e.target.value)}
                        disabled={item.excluded}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 bg-white focus:outline-none focus:border-indigo-400 disabled:opacity-60 flex-1">
                        <option value="">Type (optional)</option>
                        {EXPENSE_TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                      <input type="text" placeholder="Description (optional)"
                        value={item.notes}
                        onChange={(e) => setExtractedItemField(i, "notes", e.target.value)}
                        disabled={item.excluded}
                        className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-indigo-400 disabled:opacity-60"/>
                    </div>
                  </div>
                ))}
              </div>
              {error && <p className="text-xs text-red-500 mb-4">{error}</p>}
              <button onClick={applyBulkClaims} disabled={activeCount === 0}
                className="w-full py-3 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                Use {activeCount} claim{activeCount !== 1 ? "s" : ""} →
              </button>
              <button onClick={() => bulkFileInputRef.current?.click()}
                className="w-full mt-2.5 py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                Analyze a different file
              </button>
            </div>
          ) : null}

          <input ref={bulkFileInputRef} type="file" accept="image/*,.pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBulkUpload(f); }} />
        </div>
      </div>
    );
  }

  // ── Setup ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full">
        <div className="mb-7">
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Submit expense claims</h1>
          <p className="text-sm text-gray-400">Select your name and tell us how many receipts you want to submit.</p>
        </div>
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Your name</label>
            <select value={personId} onChange={(e) => setPersonId(e.target.value)} disabled={loadingPeople}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 bg-white disabled:text-gray-400">
              <option value="">{loadingPeople ? "Loading people…" : people.length === 0 ? "No people found" : "Select your name"}</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {selectedPerson && !selectedPerson.email && (
              <p className="text-xs text-amber-500 mt-1">No email registered — contact your admin.</p>
            )}
          </div>

          {/* Petty cash float toggle */}
          {selectedPerson && selectedPerson.pettyCashFloats.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <button
                type="button"
                onClick={() => { setIsPettyCash(!isPettyCash); setFloatId(""); }}
                className="flex items-center gap-2.5 w-full text-left"
              >
                <div className={`w-4.5 h-4.5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${isPettyCash ? "bg-amber-500 border-amber-500" : "border-amber-400 bg-white"}`}>
                  {isPettyCash && (
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-amber-800">Submitting against a petty cash float</p>
                  <p className="text-xs text-amber-600 mt-0.5">Receipts paid from company cash already handed to you</p>
                </div>
              </button>
              {isPettyCash && (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-amber-700 mb-1.5">Select float</label>
                  <select
                    value={floatId}
                    onChange={e => setFloatId(e.target.value)}
                    className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-300"
                  >
                    <option value="">— Select a float —</option>
                    {selectedPerson.pettyCashFloats.map(f => {
                      const d = new Date(f.handedAt);
                      const label = `${f.currency} ${f.amount.toLocaleString("en-US")} — ${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]} ${d.getFullYear()}${f.note ? ` · ${f.note}` : ""}`;
                      return <option key={f.id} value={f.id}>{label}</option>;
                    })}
                  </select>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Number of claims</label>
            <div className="flex items-center gap-3">
              <button onClick={() => setClaimCount((n) => Math.max(1, n - 1))}
                className="w-10 h-10 rounded-xl border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 text-lg font-medium transition-colors">−</button>
              <span className="flex-1 text-center text-2xl font-bold text-gray-900 tabular-nums">{claimCount}</span>
              <button onClick={() => setClaimCount((n) => Math.min(10, n + 1))}
                className="w-10 h-10 rounded-xl border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 text-lg font-medium transition-colors">+</button>
            </div>
            <p className="text-xs text-gray-400 text-center mt-2">{claimCount === 1 ? "1 receipt to upload" : `${claimCount} receipts to upload, one per step`}</p>
          </div>
        </div>
        {error && <p className="text-xs text-red-500 mt-4">{error}</p>}
        <button onClick={startWizard} disabled={!personId || loadingPeople}
          className="w-full mt-6 py-3 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          Start →
        </button>
        <div className="relative flex items-center my-4">
          <div className="flex-1 border-t border-gray-100"/>
          <span className="mx-3 text-[10px] text-gray-400 uppercase tracking-wider">or</span>
          <div className="flex-1 border-t border-gray-100"/>
        </div>
        <button onClick={startAnalyze} disabled={!personId || loadingPeople}
          className="w-full py-3 border border-gray-200 text-sm font-medium text-gray-600 rounded-xl hover:bg-gray-50 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
            <path d="M14 2v6h6M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          Analyze a document
        </button>
      </div>
    </div>
  );
}
