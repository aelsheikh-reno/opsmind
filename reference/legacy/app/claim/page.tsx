"use client";

import { useClaimLogic, EXPENSE_TYPES } from "./useClaimLogic";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";
import ClaimDesktop from "./ClaimDesktop";

export default function ClaimPage() {
  const activeCurrencies = useActiveCurrencies();
  const logic = useClaimLogic();
  const {
    step, setStep, people, loadingPeople, personId, setPersonId,
    claimCount, setClaimCount, currentIndex, setCurrentIndex,
    isPettyCash, setIsPettyCash, floatId, setFloatId,
    claims, cameraInputRef, fileInputRef,
    maskedEmail, otpInputs, otpRefs, submitting, error, setError, selectedPerson,
    setClaimField, handleFile, startWizard, nextClaim, prevClaim,
    sendOtp, submit, handleOtpKey, handleOtpChange,
    bulkFile, bulkAnalyzing, bulkFailed, extractedItems, docSummary,
    bulkFileInputRef, startAnalyze, handleBulkUpload, setExtractedItemField, applyBulkClaims,
  } = logic;

  // ── Desktop: hidden on mobile ─────────────────────────────────────────────
  const Desktop = (
    <div className="hidden md:block">
      <ClaimDesktop {...logic} />
    </div>
  );

  // ── Success ──────────────────────────────────────────────────────────────────
  if (step === "success") {
    return (
      <>
        {Desktop}
        <div className="md:hidden min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center">
            <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              {claims.length === 1 ? "Claim submitted!" : `${claims.length} claims submitted!`}
            </h1>
            <p className="text-sm text-gray-500 leading-relaxed">
              Your expense {claims.length === 1 ? "claim has" : "claims have"} been received and will be reviewed by your manager.
            </p>
          </div>
        </div>
      </>
    );
  }

  // ── OTP ──────────────────────────────────────────────────────────────────────
  if (step === "otp") {
    return (
      <>
        {Desktop}
        <div className="md:hidden min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 max-w-sm w-full">
            <button onClick={() => { setStep("review"); setError(""); }}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back
            </button>
            <div className="mb-6">
              <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center mb-4">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="#4f46e5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h1 className="text-lg font-semibold text-gray-900 mb-1">Check your email</h1>
              <p className="text-sm text-gray-500 leading-relaxed">
                We sent a 6-digit code to <span className="font-medium text-gray-700">{maskedEmail}</span>. Expires in 10 minutes.
              </p>
            </div>
            <div className="flex gap-2 justify-between mb-6">
              {otpInputs.map((v, i) => (
                <input key={i} ref={(el) => { otpRefs.current[i] = el; }}
                  type="tel" inputMode="numeric" maxLength={1} value={v}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKey(i, e)}
                  onFocus={(e) => e.target.select()}
                  className="w-12 h-14 text-center text-2xl font-bold border-2 border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition"
                />
              ))}
            </div>
            {error && <p className="text-sm text-red-500 mb-4 text-center">{error}</p>}
            <button onClick={submit} disabled={submitting || otpInputs.join("").length !== 6}
              className="w-full h-12 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {submitting ? "Submitting…" : `Confirm ${claims.length === 1 ? "claim" : `${claims.length} claims`}`}
            </button>
            <button onClick={sendOtp} disabled={submitting}
              className="w-full mt-3 py-2.5 text-sm text-gray-400 hover:text-indigo-600 transition-colors">
              Resend code
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── Review ───────────────────────────────────────────────────────────────────
  if (step === "review") {
    return (
      <>
        {Desktop}
        <div className="md:hidden min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 w-full max-w-lg">
            <button onClick={() => { setStep("claims"); setCurrentIndex(claims.length - 1); setError(""); }}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 mb-5 transition-colors">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back
            </button>
            <h1 className="text-lg font-semibold text-gray-900 mb-0.5">Review your claims</h1>
            <p className="text-sm text-gray-400 mb-5">{selectedPerson?.name} · {claims.length} claim{claims.length > 1 ? "s" : ""}</p>
            <div className="space-y-3 mb-6">
              {claims.map((c, i) => (
                <div key={i} className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-indigo-600">{i + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {c.amount
                        ? <span className="text-sm font-semibold text-gray-900">{c.currency} {parseFloat(c.amount).toLocaleString("en-US")}</span>
                        : <span className="text-sm text-gray-400">No amount</span>}
                      {c.expenseType && <span className="text-[10px] font-medium bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{c.expenseType}</span>}
                    </div>
                    {c.date && <p className="text-xs text-gray-400 mt-0.5">{new Date(c.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>}
                    {c.notes && <p className="text-xs text-gray-500 mt-0.5 truncate">{c.notes}</p>}
                    {c.file && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{c.file.name}</p>}
                  </div>
                  <button onClick={() => { setCurrentIndex(i); setStep("claims"); }}
                    className="text-xs font-medium text-indigo-500 hover:text-indigo-700 shrink-0 py-1 px-2">Edit</button>
                </div>
              ))}
            </div>
            {error && <p className="text-sm text-red-500 mb-4">{error}</p>}
            <button onClick={sendOtp} disabled={submitting}
              className="w-full h-12 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {submitting ? "Sending code…" : "Send verification code →"}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── Claim wizard ─────────────────────────────────────────────────────────────
  if (step === "claims") {
    const claim = claims[currentIndex];
    const isLast = currentIndex === claims.length - 1;
    return (
      <>
        {Desktop}
        <div className="md:hidden min-h-screen bg-gray-50 flex flex-col">
          {/* Top bar */}
          <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
            <button onClick={prevClaim}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors py-1 pr-2">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back
            </button>
            <div className="flex items-center gap-1.5">
              {claims.map((_, i) => (
                <div key={i} className={`h-2 rounded-full transition-all ${i === currentIndex ? "w-6 bg-indigo-500" : i < currentIndex ? "w-2 bg-indigo-300" : "w-2 bg-gray-200"}`} />
              ))}
            </div>
            <span className="text-sm font-medium text-gray-400 min-w-[36px] text-right">
              {currentIndex + 1}/{claims.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-lg mx-auto p-4 pb-28">
              <div className="mb-5">
                <h1 className="text-lg font-semibold text-gray-900">Claim {currentIndex + 1}</h1>
                <p className="text-sm text-gray-400 mt-0.5">Upload your receipt — we&apos;ll fill in the details automatically.</p>
              </div>

              {claim.analyzing && (
                <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 mb-4">
                  <svg className="animate-spin shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="#c7d2fe" strokeWidth="3"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  <p className="text-sm font-medium text-indigo-700">Analyzing receipt…</p>
                </div>
              )}
              {claim.analyzeFailed && !claim.analyzing && (
                <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0">
                    <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#d97706" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <p className="text-sm font-medium text-amber-700">Analysis failed — please fill in the fields manually.</p>
                </div>
              )}

              <div className="space-y-4">
                {/* Receipt */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Receipt</label>
                  {claim.file ? (
                    <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                      <div className="w-9 h-9 bg-white rounded-lg border border-gray-200 flex items-center justify-center shrink-0 overflow-hidden">
                        {claim.file.type.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={URL.createObjectURL(claim.file)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V6L9 1z" stroke="#9ca3af" strokeWidth="1.3" fill="none"/>
                          </svg>
                        )}
                      </div>
                      <span className="flex-1 text-sm text-gray-700 truncate">{claim.file.name}</span>
                      <button onClick={() => setClaimField(currentIndex, "file", null)}
                        className="text-gray-300 hover:text-red-400 transition-colors p-1">
                        <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button onClick={() => cameraInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl h-14 text-sm font-semibold transition-colors">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke="white" strokeWidth="1.8" fill="none" strokeLinejoin="round"/>
                          <circle cx="12" cy="13" r="4" stroke="white" strokeWidth="1.8" fill="none"/>
                        </svg>
                        Take a photo
                      </button>
                      <button onClick={() => fileInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 rounded-xl h-12 text-sm font-medium transition-colors">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Upload from files
                      </button>
                    </div>
                  )}
                  <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={(e) => handleFile(currentIndex, e.target.files)} />
                  <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden"
                    onChange={(e) => handleFile(currentIndex, e.target.files)} />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Date</label>
                  <input type="date" value={claim.date} max={new Date().toISOString().split("T")[0]}
                    onChange={(e) => setClaimField(currentIndex, "date", e.target.value)}
                    className="w-full h-12 border border-gray-200 rounded-xl px-4 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 bg-white"/>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Amount <span className="text-gray-400 font-normal">(optional)</span></label>
                  <div className="flex gap-2">
                    <select value={claim.currency} onChange={(e) => setClaimField(currentIndex, "currency", e.target.value)}
                      className="h-12 border border-gray-200 rounded-xl px-3 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 bg-white">
                      {activeCurrencies.map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <input type="text" inputMode="decimal" placeholder="0.00" value={claim.amount}
                      onChange={(e) => setClaimField(currentIndex, "amount", e.target.value)}
                      className="flex-1 h-12 border border-gray-200 rounded-xl px-4 text-sm focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50"/>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Expense type <span className="text-gray-400 font-normal">(optional)</span></label>
                  <select value={claim.expenseType} onChange={(e) => setClaimField(currentIndex, "expenseType", e.target.value)}
                    className="w-full h-12 border border-gray-200 rounded-xl px-4 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 bg-white">
                    <option value="">Select type</option>
                    {EXPENSE_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Description <span className="text-gray-400 font-normal">(optional)</span></label>
                  <textarea rows={3} placeholder="What is this expense for?" value={claim.notes}
                    onChange={(e) => setClaimField(currentIndex, "notes", e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 resize-none"/>
                </div>
              </div>
              {error && <p className="text-sm text-red-500 mt-4">{error}</p>}
            </div>
          </div>

          {/* Sticky bottom button */}
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4">
            <button onClick={nextClaim} disabled={claim.analyzing}
              className="w-full py-3.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {claim.analyzing ? "Analyzing receipt…" : isLast ? "Review claims →" : "Next claim →"}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── Analyze ──────────────────────────────────────────────────────────────────
  if (step === "analyze") {
    const activeCount = extractedItems.filter(c => !c.excluded).length;
    return (
      <>
        {Desktop}
        <div className="md:hidden min-h-screen bg-gray-50 flex flex-col">
          <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
            <button onClick={() => { setStep("setup"); setError(""); }}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors py-1 pr-2">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back
            </button>
            <h1 className="text-sm font-semibold text-gray-900">Analyze a document</h1>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-lg mx-auto p-4 pb-28">
              {!bulkFile ? (
                <>
                  <p className="text-sm text-gray-400 mb-4">Upload a receipt or statement — we&apos;ll extract the expenses automatically.</p>
                  <button onClick={() => bulkFileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl h-14 text-sm font-semibold transition-colors mb-3">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Upload document
                  </button>
                  <p className="text-xs text-gray-400 text-center">JPG, PNG, PDF — receipts, invoices, statements</p>
                </>
              ) : bulkAnalyzing ? (
                <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-4">
                  <svg className="animate-spin shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="#c7d2fe" strokeWidth="3"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-indigo-700">Analyzing document…</p>
                    <p className="text-xs text-indigo-400 mt-0.5 truncate">{bulkFile.name}</p>
                  </div>
                </div>
              ) : bulkFailed ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-4">
                  <p className="text-sm font-medium text-amber-700 mb-1">Could not extract claims from this document.</p>
                  <p className="text-xs text-amber-500 mb-3">Try a clearer image or a different file.</p>
                  <button onClick={() => bulkFileInputRef.current?.click()}
                    className="text-sm font-medium text-amber-700 underline underline-offset-2">Try another file</button>
                </div>
              ) : extractedItems.length > 0 ? (
                <>
                  {docSummary && <div className="bg-gray-50 rounded-xl px-3 py-2.5 mb-4"><p className="text-xs text-gray-500">{docSummary}</p></div>}
                  <p className="text-xs font-medium text-gray-600 mb-3">{extractedItems.length} claim{extractedItems.length !== 1 ? "s" : ""} found — review before importing</p>
                  <div className="space-y-3">
                    {extractedItems.map((item, i) => (
                      <div key={i} className={`border rounded-xl p-4 transition-opacity ${item.excluded ? "border-gray-100 bg-gray-50 opacity-50" : "border-gray-200 bg-white"}`}>
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex gap-2 flex-1 min-w-0">
                            <select value={item.currency}
                              onChange={(e) => setExtractedItemField(i, "currency", e.target.value)}
                              disabled={item.excluded}
                              className="border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-700 bg-white focus:outline-none disabled:opacity-60 shrink-0">
                              {activeCurrencies.map((c) => <option key={c}>{c}</option>)}
                            </select>
                            <input type="text" inputMode="decimal" placeholder="Amount"
                              value={item.amount}
                              onChange={(e) => setExtractedItemField(i, "amount", e.target.value)}
                              disabled={item.excluded}
                              className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none disabled:opacity-60"/>
                          </div>
                          <button onClick={() => setExtractedItemField(i, "excluded", !item.excluded)}
                            className={`shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${item.excluded ? "bg-gray-100 text-gray-500" : "bg-red-50 text-red-400"}`}>
                            {item.excluded ? "Include" : "Remove"}
                          </button>
                        </div>
                        <input type="date" value={item.date}
                          max={new Date().toISOString().split("T")[0]}
                          onChange={(e) => setExtractedItemField(i, "date", e.target.value)}
                          disabled={item.excluded}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none disabled:opacity-60 mb-2"/>
                        <select value={item.expenseType}
                          onChange={(e) => setExtractedItemField(i, "expenseType", e.target.value)}
                          disabled={item.excluded}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none disabled:opacity-60 mb-2">
                          <option value="">Type (optional)</option>
                          {EXPENSE_TYPES.map((t) => <option key={t}>{t}</option>)}
                        </select>
                        <input type="text" placeholder="Description (optional)"
                          value={item.notes}
                          onChange={(e) => setExtractedItemField(i, "notes", e.target.value)}
                          disabled={item.excluded}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none disabled:opacity-60"/>
                      </div>
                    ))}
                  </div>
                  {error && <p className="text-sm text-red-500 mt-4">{error}</p>}
                </>
              ) : null}
            </div>
          </div>

          {(extractedItems.length > 0 && !bulkAnalyzing) && (
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4 space-y-2">
              <button onClick={applyBulkClaims} disabled={activeCount === 0}
                className="w-full py-3.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                Use {activeCount} claim{activeCount !== 1 ? "s" : ""} →
              </button>
              <button onClick={() => bulkFileInputRef.current?.click()}
                className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                Analyze a different file
              </button>
            </div>
          )}

          <input ref={bulkFileInputRef} type="file" accept="image/*,.pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBulkUpload(f); }} />
        </div>
      </>
    );
  }

  // ── Setup ────────────────────────────────────────────────────────────────────
  return (
    <>
      {Desktop}
      <div className="md:hidden min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 w-full max-w-sm">
          <div className="mb-6 text-center">
            <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M4 3h16v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5V3z" stroke="white" strokeWidth="1.8" strokeLinejoin="round"/>
                <path d="M8 8h8M8 12h8M8 16h4" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </div>
            <h1 className="text-lg font-bold text-gray-900">Expense claim</h1>
            <p className="text-sm text-gray-400 mt-0.5">Submit your receipts for reimbursement</p>
          </div>
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Your name</label>
              <select value={personId} onChange={(e) => setPersonId(e.target.value)} disabled={loadingPeople}
                className="w-full h-12 border border-gray-200 rounded-xl px-4 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 bg-white disabled:text-gray-400">
                <option value="">{loadingPeople ? "Loading people…" : people.length === 0 ? "No people found" : "Select your name"}</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {selectedPerson && !selectedPerson.email && (
                <p className="text-xs text-amber-500 mt-1.5">No email on file — contact your admin.</p>
              )}
            </div>

            {/* Petty cash float toggle — only shown when person has open floats */}
            {selectedPerson && selectedPerson.pettyCashFloats.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <button
                  type="button"
                  onClick={() => { setIsPettyCash(!isPettyCash); setFloatId(""); }}
                  className="flex items-center gap-2.5 w-full text-left"
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${isPettyCash ? "bg-amber-500 border-amber-500" : "border-amber-400 bg-white"}`}>
                    {isPettyCash && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Submitting against a petty cash float</p>
                    <p className="text-xs text-amber-600 mt-0.5">These receipts were paid using company cash already handed to you</p>
                  </div>
                </button>
                {isPettyCash && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-amber-700 mb-1.5">Select float</label>
                    <select
                      value={floatId}
                      onChange={e => setFloatId(e.target.value)}
                      className="w-full h-10 border border-amber-300 rounded-lg px-3 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-300"
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
              <label className="block text-sm font-medium text-gray-700 mb-2">Number of receipts</label>
              <div className="flex items-center gap-4">
                <button onClick={() => setClaimCount((n) => Math.max(1, n - 1))}
                  className="w-12 h-12 rounded-xl border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 text-xl font-medium transition-colors active:bg-gray-100">−</button>
                <span className="flex-1 text-center text-3xl font-bold text-gray-900 tabular-nums">{claimCount}</span>
                <button onClick={() => setClaimCount((n) => Math.min(10, n + 1))}
                  className="w-12 h-12 rounded-xl border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 text-xl font-medium transition-colors active:bg-gray-100">+</button>
              </div>
              <p className="text-xs text-gray-400 text-center mt-2">
                {claimCount === 1 ? "1 receipt to upload" : `${claimCount} receipts, one per step`}
              </p>
            </div>
          </div>
          {error && <p className="text-sm text-red-500 mt-4">{error}</p>}
          <button onClick={startWizard} disabled={!personId || loadingPeople}
            className="w-full mt-6 h-12 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            Start →
          </button>
          <div className="relative flex items-center my-4">
            <div className="flex-1 border-t border-gray-100"/>
            <span className="mx-3 text-[10px] text-gray-400 uppercase tracking-wider">or</span>
            <div className="flex-1 border-t border-gray-100"/>
          </div>
          <button onClick={startAnalyze} disabled={!personId || loadingPeople}
            className="w-full h-12 border border-gray-200 text-sm font-medium text-gray-600 rounded-xl hover:bg-gray-50 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
              <path d="M14 2v6h6M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            Analyze a document
          </button>
        </div>
      </div>
    </>
  );
}
