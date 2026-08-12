"use client";

import { useState, useRef, useEffect } from "react";

export type PettyCashFloat = {
  id: string;
  amount: number;
  currency: string;
  handedAt: string;
  note: string | null;
};

export type Person = {
  id: string;
  name: string;
  email: string | null;
  pettyCashFloats: PettyCashFloat[];
};

export type ClaimDraft = {
  file: File | null;
  date: string;
  amount: string;
  currency: string;
  expenseType: string;
  notes: string;
  analyzing: boolean;
  analyzeFailed: boolean;
};

export type Step = "setup" | "analyze" | "claims" | "review" | "otp" | "success";

export type ExtractedItem = {
  description: string;
  amount: string;
  currency: string;
  date: string;
  expenseType: string;
  notes: string;
  excluded: boolean;
};

const CURRENCIES = ["AED", "USD", "EUR", "GBP", "SAR", "EGP"];
export const EXPENSE_TYPES = [
  "Supplies", "Travel", "Accommodation", "Food & Beverage",
  "Software & Subscriptions", "Marketing & Advertising", "Entertainment",
  "Training & Education", "Equipment", "Utilities", "Professional Services",
  "Medical", "Miscellaneous",
];

export function emptyDraft(): ClaimDraft {
  return {
    file: null,
    date: new Date().toISOString().split("T")[0],
    amount: "",
    currency: "AED",
    expenseType: "",
    notes: "",
    analyzing: false,
    analyzeFailed: false,
  };
}

export function useClaimLogic() {
  const [step, setStep] = useState<Step>("setup");
  const [people, setPeople] = useState<Person[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(true);

  const [personId, setPersonId] = useState("");
  const [claimCount, setClaimCount] = useState(1);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [claims, setClaims] = useState<ClaimDraft[]>([emptyDraft()]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [tokenId, setTokenId] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [otpInputs, setOtpInputs] = useState(["", "", "", "", "", ""]);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const [isPettyCash, setIsPettyCash] = useState(false);
  const [floatId, setFloatId]         = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkAnalyzing, setBulkAnalyzing] = useState(false);
  const [bulkFailed, setBulkFailed] = useState(false);
  const [extractedItems, setExtractedItems] = useState<ExtractedItem[]>([]);
  const [docSummary, setDocSummary] = useState("");
  const bulkFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let retries = 3;
    function load() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      fetch("/api/claim/people", { signal: controller.signal })
        .then((r) => { clearTimeout(timeout); if (!r.ok) throw new Error("not ok"); return r.json(); })
        .then((data) => { if (Array.isArray(data)) { setPeople(data); setLoadingPeople(false); } else throw new Error("bad data"); })
        .catch(() => { clearTimeout(timeout); if (--retries > 0) setTimeout(load, 1000); else setLoadingPeople(false); });
    }
    load();
  }, []);

  function setClaimField<K extends keyof ClaimDraft>(index: number, field: K, value: ClaimDraft[K]) {
    setClaims((prev) => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
  }

  async function analyzeFile(index: number, file: File) {
    setClaims(prev => prev.map((c, i) => i === index ? { ...c, analyzing: true, analyzeFailed: false } : c));
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/claim/analyze", { method: "POST", body: fd });
      if (!res.ok) {
        setClaims(prev => prev.map((c, i) => i === index ? { ...c, analyzing: false, analyzeFailed: true } : c));
        return;
      }
      const data = await res.json();
      if (data.error) {
        setClaims(prev => prev.map((c, i) => i === index ? { ...c, analyzing: false, analyzeFailed: true } : c));
        return;
      }
      const extracted = Array.isArray(data.claims) && data.claims.length > 0 ? data.claims[0] : data;
      setClaims((prev) => prev.map((c, i) => {
        if (i !== index) return c;
        return {
          ...c,
          amount:       c.amount      || (extracted.amount ? String(extracted.amount) : c.amount),
          currency:     (extracted.currency && CURRENCIES.includes(extracted.currency) && c.currency === "AED") ? extracted.currency : c.currency,
          date:         (extracted.date && c.date === new Date().toISOString().split("T")[0]) ? extracted.date : c.date,
          notes:        c.notes       || extracted.name  || extracted.notes || extracted.description || c.notes,
          expenseType:  c.expenseType || extracted.expenseType || c.expenseType,
          analyzing:    false,
          analyzeFailed: false,
        };
      }));
    } catch {
      setClaims(prev => prev.map((c, i) => i === index ? { ...c, analyzing: false, analyzeFailed: true } : c));
    }
  }

  function handleFile(index: number, incoming: FileList | null) {
    const file = incoming?.[0] ?? null;
    if (!file) return;
    setClaims(prev => prev.map((c, i) => i === index ? { ...c, file, analyzeFailed: false } : c));
    analyzeFile(index, file);
  }

  function startAnalyze() {
    setError("");
    if (!personId) { setError("Please select your name."); return; }
    if (isPettyCash && !floatId) { setError("Please select a petty cash float."); return; }
    setBulkFile(null);
    setBulkAnalyzing(false);
    setBulkFailed(false);
    setExtractedItems([]);
    setDocSummary("");
    setStep("analyze");
  }

  async function handleBulkUpload(file: File) {
    setBulkFile(file);
    setBulkAnalyzing(true);
    setBulkFailed(false);
    setExtractedItems([]);
    setDocSummary("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/claim/analyze", { method: "POST", body: fd });
      if (!res.ok) { setBulkFailed(true); return; }
      const data = await res.json();
      if (!Array.isArray(data.claims) || data.claims.length === 0) { setBulkFailed(true); return; }
      setDocSummary(data.docSummary ?? "");
      setExtractedItems(data.claims.map((c: Record<string, unknown>) => ({
        description: String(c.name ?? c.description ?? c.notes ?? ""),
        amount: c.amount ? String(c.amount) : "",
        currency: (c.currency && CURRENCIES.includes(String(c.currency))) ? String(c.currency) : "AED",
        date: String(c.date ?? new Date().toISOString().split("T")[0]),
        expenseType: String(c.expenseType ?? ""),
        notes: String(c.name ?? c.notes ?? c.description ?? ""),
        excluded: false,
      })));
    } catch {
      setBulkFailed(true);
    } finally {
      setBulkAnalyzing(false);
    }
  }

  function setExtractedItemField(index: number, field: keyof ExtractedItem, value: string | boolean) {
    setExtractedItems(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
  }

  function applyBulkClaims() {
    const active = extractedItems.filter(c => !c.excluded);
    if (!active.length) { setError("Include at least one claim."); return; }
    setClaims(active.map(c => ({
      file: bulkFile,
      date: c.date,
      amount: c.amount,
      currency: c.currency,
      expenseType: c.expenseType,
      notes: c.notes || c.description,
      analyzing: false,
      analyzeFailed: false,
    })));
    setCurrentIndex(0);
    setError("");
    setStep("review");
  }

  function startWizard() {
    setError("");
    if (!personId) { setError("Please select your name."); return; }
    if (isPettyCash && !floatId) { setError("Please select a petty cash float."); return; }
    const drafts = Array.from({ length: claimCount }, emptyDraft);
    setClaims(drafts);
    setCurrentIndex(0);
    setStep("claims");
  }

  function nextClaim() {
    const claim = claims[currentIndex];
    if (!claim.file) { setError("Please attach a receipt for this claim."); return; }
    setError("");
    if (currentIndex < claims.length - 1) setCurrentIndex(currentIndex + 1);
    else setStep("review");
  }

  function prevClaim() {
    setError("");
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
    else setStep("setup");
  }

  async function sendOtp() {
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/claim/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setTokenId(data.tokenId);
      setMaskedEmail(data.maskedEmail);
      setOtpInputs(["", "", "", "", "", ""]);
      setStep("otp");
    } finally {
      setSubmitting(false);
    }
  }

  async function submit() {
    const otp = otpInputs.join("");
    if (otp.length !== 6) { setError("Enter the 6-digit code."); return; }
    setError("");
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("tokenId", tokenId);
      fd.append("otp", otp);
      claims.forEach((c, i) => {
        fd.append(`file_${i}`, c.file!);
        fd.append(`meta_${i}`, JSON.stringify({
          date: c.date, amount: c.amount, currency: c.currency,
          expenseType: c.expenseType, notes: c.notes,
          pettyCashFloatId: isPettyCash && floatId ? floatId : null,
        }));
      });
      fd.append("claimCount", String(claims.length));
      const res = await fetch("/api/claim/submit", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setStep("success");
    } finally {
      setSubmitting(false);
    }
  }

  type OtpRefs = { current: (HTMLInputElement | null)[] };

  function handleOtpKey(i: number, e: React.KeyboardEvent<HTMLInputElement>, r: OtpRefs = otpRefs) {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...otpInputs];
      if (next[i]) {
        next[i] = "";
        setOtpInputs(next);
      } else if (i > 0) {
        next[i - 1] = "";
        setOtpInputs(next);
        r.current[i - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      r.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < 5) {
      e.preventDefault();
      r.current[i + 1]?.focus();
    }
  }

  function handleOtpChange(i: number, val: string, r: OtpRefs = otpRefs) {
    const digits = val.replace(/\D/g, "");
    if (!digits) return;
    if (digits.length > 1) {
      // paste: always fill from box 0
      const next = ["", "", "", "", "", ""];
      for (let j = 0; j < digits.length && j < 6; j++) next[j] = digits[j];
      setOtpInputs(next);
      r.current[Math.min(digits.length, 5)]?.focus();
      return;
    }
    const next = [...otpInputs];
    next[i] = digits[0];
    setOtpInputs(next);
    if (i < 5) r.current[i + 1]?.focus();
  }

  const selectedPerson = people.find((p) => p.id === personId);

  return {
    step, setStep,
    people, loadingPeople,
    personId, setPersonId,
    claimCount, setClaimCount,
    isPettyCash, setIsPettyCash,
    floatId, setFloatId,
    currentIndex, setCurrentIndex,
    claims, setClaims,
    fileInputRef, cameraInputRef,
    tokenId, maskedEmail,
    otpInputs, otpRefs,
    submitting, error, setError,
    selectedPerson,
    setClaimField,
    handleFile,
    startWizard, nextClaim, prevClaim,
    sendOtp, submit,
    handleOtpKey, handleOtpChange,
    bulkFile, bulkAnalyzing, bulkFailed, extractedItems, docSummary,
    bulkFileInputRef,
    startAnalyze, handleBulkUpload, setExtractedItemField, applyBulkClaims,
  };
}
