"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";

type SalaryComponent = { name: string; amount: number };

type PersonData = {
  id: string;
  name: string;
  existingDocumentId?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  nationality?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
  salary?: number | null;
  salaryCurrency?: string | null;
  salaryComponents?: string | null;
  renewalStartDate?: string | null;
};

type Template = {
  id: string;
  name: string;
  placeholders: string[];
};

type ScheduleRow = {
  dueDate: string;      // YYYY-MM-DD
  amount: number;
  currency: string;
  description: string;
};

type Props = {
  person: PersonData;
  templates: Template[];
};

type FieldType = "date" | "number" | "currency" | "text";

function fieldType(placeholder: string): FieldType {
  const norm = placeholder.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (
    norm.includes("startdate") || norm.includes("joiningdate") || norm.includes("commencement") ||
    norm.includes("effectivedate") || norm === "start" || norm === "joining" || norm === "from" ||
    norm.includes("enddate") || norm.includes("expirydate") || norm.includes("expiry") ||
    norm.includes("termination") || norm === "end" || norm === "until" || norm === "to" ||
    norm === "date" || norm === "today" || norm.includes("issuedate") || norm.includes("signdate") ||
    norm.includes("currentdate") || norm.includes("prepareddate")
  ) return "date";
  if (norm.includes("currency") || norm === "curr") return "currency";
  if (
    norm.includes("salary") || norm.includes("wage") || norm.includes("remuneration") ||
    norm.includes("compensation") || norm.includes("allowance") || norm.includes("amount") ||
    norm === "basic" || norm === "pay"
  ) return "number";
  return "text";
}

function autoFill(placeholder: string, person: PersonData): string {
  const norm = placeholder.toLowerCase().replace(/[^a-z0-9]/g, "");
  const today = new Date().toISOString().split("T")[0];

  if (
    norm.includes("name") &&
    !norm.includes("company") && !norm.includes("employer") && !norm.includes("entity") && !norm.includes("organization")
  ) return person.name;

  if (norm === "employee" || norm === "staff" || norm === "worker") return person.name;

  if (norm.includes("title") || norm.includes("position") || norm.includes("designation") || norm.includes("jobrole") || norm === "role" || norm === "post")
    return person.jobTitle ?? "";

  if (norm.includes("department") || norm.includes("dept") || norm.includes("division") || norm.includes("section"))
    return person.department ?? "";

  if (norm.includes("nationality") || norm.includes("citizenship") || norm.includes("citizen"))
    return person.nationality ?? "";

  if (norm.includes("currency") || norm === "curr")
    return person.salaryCurrency ?? "";

  if (
    norm.includes("salary") || norm.includes("wage") || norm.includes("remuneration") ||
    norm.includes("compensation") || norm.includes("allowance") || norm.includes("amount") ||
    norm === "basic" || norm === "pay"
  ) {
    if (person.salaryComponents) {
      try {
        const components = JSON.parse(person.salaryComponents) as SalaryComponent[];
        const match = components.find(
          (c) => c.name.toLowerCase().replace(/[^a-z0-9]/g, "") === norm
        );
        if (match) return String(match.amount);
      } catch { /* ignore */ }
    }
    return person.salary != null ? String(person.salary) : "";
  }

  if (norm.includes("startdate") || norm.includes("joiningdate") || norm.includes("commencement") || norm.includes("effectivedate") || norm === "start" || norm === "joining" || norm === "from")
    return person.renewalStartDate?.split("T")[0] ?? person.contractStart?.split("T")[0] ?? "";

  if (norm.includes("enddate") || norm.includes("expirydate") || norm.includes("expiry") || norm.includes("termination") || norm === "end" || norm === "until" || norm === "to")
    return person.contractEnd?.split("T")[0] ?? "";

  if (norm === "date" || norm === "today" || norm.includes("issuedate") || norm.includes("signdate") || norm.includes("currentdate") || norm.includes("prepareddate"))
    return today;

  return "";
}

export default function GenerateContractModal({ person, templates }: Props) {
  const router = useRouter();
  const activeCurrencies = useActiveCurrencies();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"pick" | "preview" | "form" | "schedule">("pick");
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [refining, setRefining] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [templatePreviewHtml, setTemplatePreviewHtml] = useState("");
  const [templatePreviewLoading, setTemplatePreviewLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const focusedFieldRef = useRef<string | null>(null);

  const placeholders = selectedTemplate?.placeholders ?? [];
  const templateId = selectedTemplate?.id ?? "";
  const templateName = selectedTemplate?.name ?? "";

  const hasCurrencyPlaceholder = placeholders.some((p) => fieldType(p) === "currency");
  const currencyFieldKey = placeholders.find((p) => fieldType(p) === "currency") ?? "__currency__";

  // When modal opens, reset state
  useEffect(() => {
    if (!open) return;
    setError("");
    setPreviewHtml("");
    setTemplatePreviewHtml("");
    if (templates.length === 1) {
      setSelectedTemplate(templates[0]);
      setStep("preview");
    } else {
      setSelectedTemplate(null);
      setStep("pick");
    }
  }, [open, templates]);

  // Fetch raw template preview (empty fields) when entering preview step
  useEffect(() => {
    if (step !== "preview" || !selectedTemplate) return;
    setTemplatePreviewHtml("");
    setTemplatePreviewLoading(true);
    fetch("/api/contracts/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: selectedTemplate.id, fields: {} }),
    })
      .then((r) => r.json())
      .then((data) => { if (data.html) setTemplatePreviewHtml(data.html); })
      .catch(() => {})
      .finally(() => setTemplatePreviewLoading(false));
  }, [step, selectedTemplate]);

  // Pre-fill fields when entering the form step
  useEffect(() => {
    if (step !== "form" || !selectedTemplate) return;
    const initial: Record<string, string> = {};
    for (const p of selectedTemplate.placeholders) {
      const raw = autoFill(p, person);
      if (fieldType(p) === "number" && raw) {
        const num = parseFloat(raw.replace(/,/g, ""));
        initial[p] = isNaN(num) ? raw : num.toLocaleString("en-US");
      } else {
        initial[p] = raw;
      }
    }
    if (!hasCurrencyPlaceholder) {
      initial["__currency__"] = person.salaryCurrency ?? "";
    }
    setFields(initial);
    setPreviewHtml("");
    setError("");
  }, [step, selectedTemplate, person, hasCurrencyPlaceholder]);

  const fetchPreview = useCallback(
    (currentFields: Record<string, string>) => {
      if (!templateId) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setPreviewLoading(true);
        try {
          const res = await fetch("/api/contracts/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ templateId, fields: currentFields }),
          });
          const data = await res.json();
          if (res.ok) {
            let html: string = data.html ?? "";
            const currency = currentFields[currencyFieldKey];
            if (currency) {
              for (const p of placeholders) {
                if (fieldType(p) === "number") {
                  html = html.replace(
                    new RegExp(`(<mark[^>]*id="pf-${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>[^<]*</mark>)`, "g"),
                    `$1<span class="pf-currency">${currency}</span>`
                  );
                }
              }
            }
            setPreviewHtml(html);
          }
        } catch {}
        setPreviewLoading(false);
      }, 600);
    },
    [templateId, placeholders, currencyFieldKey]
  );

  useEffect(() => {
    if (step !== "form" || Object.keys(fields).length === 0) return;
    fetchPreview(fields);
  }, [fields, step, fetchPreview]);

  useEffect(() => {
    if (!previewHtml || !focusedFieldRef.current) return;
    const key = focusedFieldRef.current;
    requestAnimationFrame(() => scrollToField(key));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewHtml]);

  function setField(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function scrollToField(key: string) {
    const container = previewRef.current;
    if (!container) return;
    container.querySelectorAll(".pf-mark").forEach((el) => el.classList.remove("pf-active"));
    const target = container.querySelector(`[data-field="${key}"]`);
    if (target) {
      target.classList.add("pf-active");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  async function handleRefineSchedule() {
    if (!refinePrompt.trim() || !scheduleRows.length) return;
    setRefining(true);
    setError("");
    try {
      const res = await fetch("/api/contracts/refine-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule: scheduleRows, prompt: refinePrompt }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.schedule)) {
        setScheduleRows(data.schedule);
        setRefinePrompt("");
      } else {
        setError(data.error ?? "Refinement failed");
      }
    } catch {
      setError("Network error during refinement");
    } finally {
      setRefining(false);
    }
  }

  async function previewSchedule() {
    setError("");
    setScheduleLoading(true);
    try {
      const res = await fetch("/api/contracts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, fields, personName: person.name, linkToPersonId: person.id, previewOnly: true }),
      });
      const data = await res.json();
      setScheduleRows(data.schedule ?? []);
      setStep("schedule");
    } catch {
      setError("Failed to compute payment schedule");
    } finally {
      setScheduleLoading(false);
    }
  }

  function updateScheduleRow(index: number, field: keyof ScheduleRow, value: string | number) {
    setScheduleRows((prev) => prev.map((row, i) => i === index ? { ...row, [field]: value } : row));
  }

  function removeScheduleRow(index: number) {
    setScheduleRows((prev) => prev.filter((_, i) => i !== index));
  }

  function addScheduleRow() {
    const last = scheduleRows[scheduleRows.length - 1];
    const nextDate = last
      ? (() => { const d = new Date(last.dueDate); return `${d.getFullYear()}-${String(d.getMonth() + 2).padStart(2, "0")}-01`; })()
      : new Date().toISOString().slice(0, 7) + "-01";
    setScheduleRows((prev) => [...prev, { dueDate: nextDate, amount: last?.amount ?? 0, currency: last?.currency ?? "", description: "Monthly salary" }]);
  }

  async function generate(linkToPersonId: string | null) {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/contracts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          fields,
          personName: person.name,
          linkToPersonId,
          confirmedSchedule: linkToPersonId ? scheduleRows : [],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Generation failed");
        setStep("form");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${person.name} Contract.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
      if (linkToPersonId) router.push(`/people/${person.id}`);
    } finally {
      setLoading(false);
    }
  }

  function handleDownloadClick() {
    previewSchedule();
  }

  function handleClose() {
    setOpen(false);
  }

  const isRenewal = !!person.renewalStartDate;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
          isRenewal
            ? "text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100"
            : "text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100"
        }`}
        title={isRenewal ? "Renew contract" : "Generate contract"}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="1" width="10" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
          <path d="M5 5h6M5 7.5h6M5 10h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M10 1v3.5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          {isRenewal ? (
            <>
              <circle cx="13" cy="13" r="2.5" fill="#059669" />
              <path d="M11.8 13a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 0 0-2.4 0" stroke="white" strokeWidth="0.8" fill="none" />
            </>
          ) : (
            <>
              <circle cx="13" cy="13" r="2.5" fill="#4f46e5" />
              <path d="M13 12v2M12 13h2" stroke="white" strokeWidth="1.1" strokeLinecap="round" />
            </>
          )}
        </svg>
        {isRenewal ? "Renew contract" : "Generate"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <div className={`bg-white rounded-2xl shadow-2xl w-full flex flex-col ${step === "pick" ? "max-w-2xl" : step === "preview" ? "max-w-3xl h-[88vh]" : step === "schedule" ? "max-w-3xl h-[88vh]" : "max-w-5xl h-[88vh]"}`}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border shrink-0">
              <div>
                <h2 className="text-base font-semibold text-gray-900">{isRenewal ? "Renew contract" : "Generate contract"}</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {templates.length === 0
                    ? person.name
                    : step === "pick"
                    ? `${person.name} · Choose a template`
                    : step === "preview"
                    ? `${person.name} · Preview — ${templateName}`
                    : step === "schedule"
                    ? `${person.name} · Set monthly salary`
                    : `${person.name} · ${templateName}`}
                </p>
              </div>
              <button onClick={handleClose} className="text-gray-300 hover:text-gray-600 transition-colors">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* ── No templates ── */}
            {templates.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-4 px-8 py-12 text-center">
                <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="1" width="10" height="13" rx="1.5" stroke="#d97706" strokeWidth="1.4" fill="none" />
                    <path d="M5 5h6M5 7.5h4" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
                    <path d="M10 1v3.5h3.5" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
                    <circle cx="12" cy="12" r="3" fill="#fef3c7" stroke="#d97706" strokeWidth="1.2" />
                    <path d="M12 10.5v1.5M12 13v.5" stroke="#d97706" strokeWidth="1.1" strokeLinecap="round" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-1">No contract templates found</p>
                  <p className="text-xs text-gray-500 max-w-xs">
                    Upload a <span className="font-medium">.docx</span> template with placeholders (e.g. <span className="font-mono bg-gray-100 px-1 rounded">{"{{Employee Name}}"}</span>) to start generating contracts.
                  </p>
                </div>
                <a
                  href="/settings"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
                  onClick={handleClose}
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path d="M6 1v7M3 4l3-3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M1 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  Upload a template in Settings
                </a>
              </div>
            )}

            {/* ── Step 1: Template picker ── */}
            {templates.length > 0 && step === "pick" && (
              <div className="p-6 space-y-3">
                <p className="text-sm text-gray-500">Select a template to preview.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => { setSelectedTemplate(tpl); setStep("preview"); }}
                      className="text-left p-4 rounded-xl border-2 border-surface-border hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-12 rounded-lg bg-indigo-50 group-hover:bg-indigo-100 flex items-center justify-center shrink-0 transition-colors">
                          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                            <rect x="2" y="1" width="10" height="13" rx="1.5" stroke="#4f46e5" strokeWidth="1.3" fill="none" />
                            <path d="M5 5h6M5 7.5h6M5 10h4" stroke="#4f46e5" strokeWidth="1.1" strokeLinecap="round" />
                            <path d="M10 1v3.5h3.5" stroke="#4f46e5" strokeWidth="1.1" strokeLinecap="round" />
                          </svg>
                        </div>
                        <p className="flex-1 text-sm font-semibold text-gray-900 group-hover:text-indigo-700 transition-colors">{tpl.name}</p>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0 text-gray-300 group-hover:text-indigo-400 transition-colors">
                          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Step 2: Template preview ── */}
            {templates.length > 0 && step === "preview" && (
              <>
                <div className="flex-1 overflow-y-auto bg-surface-inset p-6 min-h-0">
                  {templatePreviewLoading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                      <svg className="animate-spin w-6 h-6 text-indigo-400" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
                        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      <p className="text-sm text-gray-400">Loading preview…</p>
                    </div>
                  ) : templatePreviewHtml ? (
                    <div className="bg-white rounded-xl shadow-sm border border-surface-border mx-auto max-w-2xl p-8 contract-preview">
                      <div dangerouslySetInnerHTML={{ __html: templatePreviewHtml }} />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-sm text-gray-400">Preview unavailable</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between px-6 py-4 border-t border-surface-border shrink-0">
                  {templates.length > 1 ? (
                    <button
                      onClick={() => { setStep("pick"); setSelectedTemplate(null); }}
                      className="text-sm text-gray-500 hover:text-gray-700 font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                        <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Back
                    </button>
                  ) : (
                    <button onClick={handleClose} className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">Cancel</button>
                  )}
                  <button
                    onClick={() => setStep("form")}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
                  >
                    Use this template
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <path d="M5 3l4 4-4 4" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </>
            )}

            {/* ── Step 3: Form ── */}
            {templates.length > 0 && step === "form" && (
              <>
                {/* Body — two columns */}
                <div className="flex flex-1 min-h-0">

                  {/* Left — fields */}
                  <div className="w-72 shrink-0 border-r border-surface-border flex flex-col">
                    <div className="px-5 py-3 border-b border-surface-border">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Fields</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">Pre-filled from employee record. Edit before downloading.</p>
                    </div>
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                      {placeholders.length === 0 ? (
                        <p className="text-sm text-gray-400">No placeholders detected in this template.</p>
                      ) : (() => {
                        type Item = { kind: "placeholder"; key: string } | { kind: "currency-synthetic" };
                        const items: Item[] = placeholders.map((key) => ({ kind: "placeholder", key }));
                        if (!hasCurrencyPlaceholder) {
                          const hasNumberFields = items.some(
                            (item) => item.kind === "placeholder" && fieldType(item.key) === "number"
                          );
                          if (!hasNumberFields) {
                            items.push({ kind: "currency-synthetic" });
                          }
                        }

                        return items.map((item) => {
                          if (item.kind === "currency-synthetic") {
                            return (
                              <div key="__currency__">
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                                  Salary currency
                                </label>
                                <select
                                  value={fields["__currency__"] ?? ""}
                                  onChange={(e) => setField("__currency__", e.target.value)}
                                  className="w-full text-sm border border-surface-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                >
                                  <option value="">— select —</option>
                                  {activeCurrencies.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                  ))}
                                </select>
                              </div>
                            );
                          }

                          const p = item.key;
                          const type = fieldType(p);
                          const inputClass = "w-full text-sm border border-surface-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300";
                          const label = p.replace(/[_/]/g, " ").replace(/\s+/g, " ").trim();
                          return (
                            <div key={p}>
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                                {label}
                              </label>
                              {type === "currency" ? (
                                <select
                                  value={fields[p] ?? ""}
                                  onChange={(e) => setField(p, e.target.value)}
                                  onFocus={() => { focusedFieldRef.current = p; scrollToField(p); }}
                                  className={inputClass}
                                >
                                  <option value="">— select —</option>
                                  {activeCurrencies.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                  ))}
                                </select>
                              ) : type === "number" ? (
                                <div className="flex gap-1.5">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={fields[p] ?? ""}
                                    onChange={(e) => setField(p, e.target.value.replace(/,/g, ""))}
                                    onFocus={() => {
                                      focusedFieldRef.current = p;
                                      scrollToField(p);
                                      setField(p, (fields[p] ?? "").replace(/,/g, ""));
                                    }}
                                    onBlur={() => {
                                      const raw = (fields[p] ?? "").replace(/,/g, "");
                                      const num = parseFloat(raw);
                                      if (!isNaN(num)) setField(p, num.toLocaleString("en-US"));
                                    }}
                                    placeholder="0"
                                    className="flex-1 min-w-0 text-sm border border-surface-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                  />
                                  <select
                                    value={fields[currencyFieldKey] ?? ""}
                                    onChange={(e) => setField(currencyFieldKey, e.target.value)}
                                    className="w-[72px] shrink-0 text-sm border border-surface-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                  >
                                    <option value="">—</option>
                                    {activeCurrencies.map((c) => (
                                      <option key={c} value={c}>{c}</option>
                                    ))}
                                  </select>
                                </div>
                              ) : (
                                <input
                                  type={type}
                                  value={fields[p] ?? ""}
                                  onChange={(e) => setField(p, e.target.value)}
                                  onFocus={() => { focusedFieldRef.current = p; scrollToField(p); }}
                                  placeholder={label}
                                  className={inputClass}
                                />
                              )}
                            </div>
                          );
                        })
                      })()}
                    </div>
                    {error && (
                      <div className="px-5 py-3 border-t border-surface-border">
                        <p className="text-xs text-red-500">{error}</p>
                      </div>
                    )}
                  </div>

                  {/* Right — live preview */}
                  <div className="flex-1 flex flex-col min-w-0">
                    <div className="px-5 py-3 border-b border-surface-border flex items-center gap-2 shrink-0">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Live preview</p>
                      {previewLoading && (
                        <svg className="animate-spin w-3 h-3 text-indigo-400" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
                          <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                      )}
                      <span className="ml-auto text-[10px] text-gray-300">Updates as you type</span>
                    </div>
                    <div ref={previewRef} className="flex-1 overflow-y-auto bg-surface-inset p-6">
                      {previewHtml ? (
                        <div className="bg-white rounded-xl shadow-sm border border-surface-border mx-auto max-w-2xl p-8 contract-preview">
                          <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                          {previewLoading ? (
                            <>
                              <div className="w-10 h-10 rounded-full bg-white border border-surface-border flex items-center justify-center">
                                <svg className="animate-spin w-5 h-5 text-indigo-400" viewBox="0 0 24 24" fill="none">
                                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
                                  <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                                </svg>
                              </div>
                              <p className="text-sm text-gray-400">Rendering preview…</p>
                            </>
                          ) : (
                            <>
                              <div className="w-10 h-10 rounded-full bg-white border border-surface-border flex items-center justify-center">
                                <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                                  <rect x="2" y="1" width="10" height="13" rx="1.5" stroke="#d1d5db" strokeWidth="1.3" fill="none" />
                                  <path d="M5 5h6M5 7.5h6M5 10h4" stroke="#d1d5db" strokeWidth="1.1" strokeLinecap="round" />
                                </svg>
                              </div>
                              <p className="text-sm text-gray-400">Preview will appear here</p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-surface-border shrink-0">
                  <button onClick={handleClose} className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={handleDownloadClick}
                    disabled={scheduleLoading}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
                  >
                    {scheduleLoading ? (
                      <>
                        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="white" strokeOpacity=".3" strokeWidth="3" />
                          <path d="M22 12a10 10 0 0 0-10-10" stroke="white" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                        Computing…
                      </>
                    ) : (
                      <>
                        Review schedule
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                          <path d="M5 3l4 4-4 4" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              </>
            )}

            {/* ── Step 4: Payment schedule review ── */}
            {templates.length > 0 && step === "schedule" && (
              <>
                <div className="flex-1 overflow-y-auto min-h-0 p-6 flex flex-col gap-4">

                  {/* Info banner */}
                  <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0">
                      <circle cx="8" cy="8" r="6.5" stroke="#4f46e5" strokeWidth="1.4" fill="none" />
                      <path d="M8 7v4" stroke="#4f46e5" strokeWidth="1.4" strokeLinecap="round" />
                      <circle cx="8" cy="5" r="0.75" fill="#4f46e5" />
                    </svg>
                    <p className="text-xs text-indigo-800">
                      Set the salary amount for each month — different values per month are supported. These amounts will be used to create payroll entries for this employee.
                    </p>
                  </div>

                  {/* Contract context warning */}
                  {person.existingDocumentId && (
                    <div className={`flex items-start gap-3 rounded-xl px-4 py-3 ${isRenewal ? "bg-emerald-50 border border-emerald-200" : "bg-amber-50 border border-amber-200"}`}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0">
                        <path d="M8 2L1 14h14L8 2z" stroke={isRenewal ? "#059669" : "#b45309"} strokeWidth="1.4" fill="none" strokeLinejoin="round" />
                        <path d="M8 6v3.5" stroke={isRenewal ? "#059669" : "#b45309"} strokeWidth="1.4" strokeLinecap="round" />
                        <circle cx="8" cy="11.5" r="0.75" fill={isRenewal ? "#059669" : "#b45309"} />
                      </svg>
                      <p className={`text-xs ${isRenewal ? "text-emerald-800" : "text-amber-800"}`}>
                        {isRenewal ? (
                          <>
                            <span className="font-semibold">Contract renewal.</span>{" "}
                            New contract starts {person.renewalStartDate}. Prior payroll entries are preserved; the overlap month will be updated to include both periods.
                          </>
                        ) : (
                          <>
                            <span className="font-semibold">Existing contract detected.</span>{" "}
                            Confirming will replace it and update the payment schedule.
                          </>
                        )}
                      </p>
                    </div>
                  )}

                  {scheduleRows.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-10 text-center">
                      <div className="w-10 h-10 rounded-full bg-surface-inset border border-surface-border flex items-center justify-center">
                        <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                          <rect x="2" y="1" width="10" height="13" rx="1.5" stroke="#d1d5db" strokeWidth="1.3" fill="none" />
                          <path d="M5 5h6M5 7.5h4" stroke="#d1d5db" strokeWidth="1.1" strokeLinecap="round" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-600">No payment schedule computed</p>
                        <p className="text-xs text-gray-400 mt-1">Salary or contract dates were not found in the filled fields.</p>
                      </div>
                      <button
                        onClick={addScheduleRow}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                        Add payment manually
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Summary */}
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold text-gray-900">{scheduleRows.length} payment{scheduleRows.length !== 1 ? "s" : ""}</span>
                        <span className="text-gray-300">·</span>
                        <span className="text-gray-500">
                          {scheduleRows[0]?.currency} {scheduleRows.reduce((s, r) => s + r.amount, 0).toLocaleString("en-US")} total
                        </span>
                      </div>

                      {/* Table */}
                      <div className="border border-surface-border rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-surface-inset border-b border-surface-border">
                              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Due date</th>
                              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Description</th>
                              <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Amount</th>
                              <th className="w-8" />
                            </tr>
                          </thead>
                          <tbody>
                            {scheduleRows.map((row, i) => (
                              <tr key={i} className="border-b border-surface-border last:border-0 hover:bg-surface-inset/50">
                                <td className="px-4 py-2">
                                  <input
                                    type="date"
                                    value={row.dueDate}
                                    onChange={(e) => updateScheduleRow(i, "dueDate", e.target.value)}
                                    className="text-xs text-gray-700 border border-transparent hover:border-surface-border focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 rounded px-1.5 py-1 focus:outline-none w-[136px]"
                                  />
                                </td>
                                <td className="px-4 py-2">
                                  <input
                                    type="text"
                                    value={row.description}
                                    onChange={(e) => updateScheduleRow(i, "description", e.target.value)}
                                    className="w-full text-xs text-gray-700 border border-transparent hover:border-surface-border focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 rounded px-1.5 py-1 focus:outline-none"
                                  />
                                </td>
                                <td className="px-4 py-2">
                                  <div className="flex items-center gap-1.5 justify-end">
                                    <span className="text-[10px] text-gray-400 shrink-0">{row.currency}</span>
                                    <input
                                      type="number"
                                      value={row.amount}
                                      onChange={(e) => updateScheduleRow(i, "amount", parseFloat(e.target.value) || 0)}
                                      className="w-28 text-xs text-right text-gray-700 border border-transparent hover:border-surface-border focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 rounded px-1.5 py-1 focus:outline-none"
                                    />
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <button
                                    onClick={() => removeScheduleRow(i)}
                                    className="text-gray-300 hover:text-red-500 transition-colors"
                                    title="Remove"
                                  >
                                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                                      <path d="M2 2.5h8M4.5 2.5V1.5h3v1M4 2.5l.5 7M8 2.5l-.5 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <button
                        onClick={addScheduleRow}
                        className="self-start text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                        Add payment
                      </button>
                    </>
                  )}

                  {/* AI refinement prompt */}
                  <div className="border border-surface-border rounded-xl p-4 bg-surface-inset/50">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2.5">Refine with AI</p>
                    <div className="flex gap-2 items-end">
                      <textarea
                        value={refinePrompt}
                        onChange={(e) => setRefinePrompt(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRefineSchedule(); }}
                        placeholder={'e.g. "increase Q2 payments by 10%" · "add a bonus of AED 5,000 in July" · "split March into two equal payments"'}
                        rows={2}
                        className="flex-1 text-sm border border-surface-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300 placeholder:text-gray-300"
                      />
                      <button
                        onClick={handleRefineSchedule}
                        disabled={refining || !refinePrompt.trim() || !scheduleRows.length}
                        className="flex items-center gap-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-lg transition-colors shrink-0"
                      >
                        {refining ? (
                          <>
                            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="white" strokeOpacity=".3" strokeWidth="3" />
                              <path d="M22 12a10 10 0 0 0-10-10" stroke="white" strokeWidth="3" strokeLinecap="round" />
                            </svg>
                            Refining…
                          </>
                        ) : (
                          <>
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                              <path d="M13 2l-9 9 2 2 9-9-2-2zM4 11l-2 2 2-1 1-2-1 1z" stroke="white" strokeWidth="1.3" strokeLinejoin="round" />
                            </svg>
                            Refine
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-300 mt-1.5">Cmd+Enter to submit</p>
                  </div>

                  {error && <p className="text-xs text-red-500">{error}</p>}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-surface-border shrink-0">
                  <button
                    onClick={() => setStep("form")}
                    className="text-sm text-gray-500 hover:text-gray-700 font-medium flex items-center gap-1.5 transition-colors"
                  >
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Back
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => generate(null)}
                      disabled={loading}
                      className="text-sm font-medium text-gray-600 bg-white hover:bg-gray-50 border border-surface-border px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                    >
                      Just download
                    </button>
                    <button
                      onClick={() => generate(person.id)}
                      disabled={loading}
                      className="flex items-center gap-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {loading ? (
                        <>
                          <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="white" strokeOpacity=".3" strokeWidth="3" />
                            <path d="M22 12a10 10 0 0 0-10-10" stroke="white" strokeWidth="3" strokeLinecap="round" />
                          </svg>
                          Generating…
                        </>
                      ) : isRenewal ? "Renew & download" : person.existingDocumentId ? "Replace & download" : "Confirm & download"}
                    </button>
                  </div>
                </div>
              </>
            )}

          </div>
        </div>
      )}
    </>
  );
}
