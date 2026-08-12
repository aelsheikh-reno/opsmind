"use client";

import { useState, useRef, useTransition } from "react";

type Template = {
  id: string;
  name: string;
  filePath: string;
  placeholders: string[];
  isActive: boolean;
  createdAt: string;
};

type Replacement = { original: string; placeholder: string };

type ConvertPreview = {
  originalDocxBase64: string;
  docxBase64: string;
  placeholders: string[];
  replacements: Replacement[];
  contractText?: string;
};

type Props = {
  initialTemplates: Template[];
};

export default function ContractTemplates({ initialTemplates }: Props) {
  const [templates, setTemplates] = useState<Template[]>(initialTemplates);
  const [isPending, startTransition] = useTransition();

  // — Manual upload tab —
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // — AI extract tab —
  const [tab, setTab] = useState<"manual" | "extract">("manual");
  const [convertFile, setConvertFile] = useState<File | null>(null);
  const [convertName, setConvertName] = useState("");
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState("");
  const [preview, setPreview] = useState<ConvertPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [removedIndices, setRemovedIndices] = useState<Set<number>>(new Set());
  const convertFileRef = useRef<HTMLInputElement>(null);
  const [refinementPrompt, setRefinementPrompt] = useState("");
  const [refining, setRefining] = useState(false);

  // — Delete confirmation —
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // — Template preview modal —
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  async function openPreview(t: Template) {
    setPreviewTemplate(t);
    setPreviewHtml("");
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/contracts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: t.id, fields: {} }),
      });
      const data = await res.json();
      if (res.ok) setPreviewHtml(data.html ?? "");
    } catch {}
    setPreviewLoading(false);
  }

  async function handleUpload() {
    if (!file || !name.trim()) { setUploadError("Name and file are required."); return; }
    setUploadError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("file", file);
      const res = await fetch("/api/contract-templates", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setUploadError(data.error ?? "Upload failed"); return; }
      setTemplates((prev) => [data.template, ...prev]);
      setName("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setUploading(false);
    }
  }

  async function handleExtract() {
    if (!convertFile) { setConvertError("Please choose a contract file."); return; }
    if (!convertName.trim()) { setConvertError("Template name is required."); return; }
    setConvertError("");
    setPreview(null);
    setRemovedIndices(new Set());
    setConverting(true);
    try {
      const fd = new FormData();
      fd.append("file", convertFile);
      const res = await fetch("/api/contract-templates/convert", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setConvertError(data.error ?? "Extraction failed"); return; }
      setPreview(data as ConvertPreview);
    } catch {
      setConvertError("Unexpected error. Please try again.");
    } finally {
      setConverting(false);
    }
  }

  function activeReplacements() {
    if (!preview) return [];
    return preview.replacements.filter((_, i) => !removedIndices.has(i));
  }

  function updatePlaceholder(i: number, value: string) {
    setPreview((prev) => {
      if (!prev) return prev;
      const next = [...prev.replacements];
      next[i] = { ...next[i], placeholder: value.startsWith("{{") ? value : `{{${value.replace(/^\{\{|\}\}$/g, "")}}}` };
      return { ...prev, replacements: next };
    });
  }

  async function handleRefine() {
    if (!preview || !refinementPrompt.trim()) return;
    setRefining(true);
    setConvertError("");
    try {
      const res = await fetch("/api/contract-templates/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractText: preview.contractText ?? "",
          existingReplacements: activeReplacements(),
          refinementPrompt: refinementPrompt.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setConvertError(data.error ?? "Refinement failed"); return; }
      setPreview((prev) => prev ? { ...prev, replacements: data.replacements, placeholders: data.placeholders } : prev);
      setRemovedIndices(new Set());
      setRefinementPrompt("");
    } catch {
      setConvertError("Unexpected error during refinement.");
    } finally {
      setRefining(false);
    }
  }

  async function applyActiveReplacements(): Promise<string | null> {
    if (!preview) return null;
    const res = await fetch("/api/contract-templates/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalDocxBase64: preview.originalDocxBase64,
        replacements: activeReplacements(),
      }),
    });
    const data = await res.json();
    if (!res.ok) { setConvertError(data.error ?? "Apply failed"); return null; }
    return data.docxBase64 as string;
  }

  async function handleSaveTemplate() {
    if (!preview) return;
    setSaving(true);
    setConvertError("");
    try {
      const docxBase64 = await applyActiveReplacements();
      if (!docxBase64) return;
      const bytes = Uint8Array.from(atob(docxBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const fd = new FormData();
      fd.append("name", convertName.trim());
      fd.append("file", blob, `${convertName.trim()}.docx`);
      const res = await fetch("/api/contract-templates", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setConvertError(data.error ?? "Save failed"); return; }
      setTemplates((prev) => [data.template, ...prev]);
      setPreview(null);
      setConvertFile(null);
      setConvertName("");
      setRemovedIndices(new Set());
      if (convertFileRef.current) convertFileRef.current.value = "";
      setTab("manual");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadPreview() {
    if (!preview) return;
    const docxBase64 = await applyActiveReplacements();
    if (!docxBase64) return;
    const bytes = Uint8Array.from(atob(docxBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${convertName.trim() || "template"}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDelete(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/contract-templates/${id}`, { method: "DELETE" });
      if (res.ok) setTemplates((prev) => prev.filter((t) => t.id !== id));
    });
  }

  async function handleActivate(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/contract-templates/${id}/activate`, { method: "POST" });
      if (res.ok) setTemplates((prev) => prev.map((t) => t.id === id ? { ...t, isActive: !t.isActive } : t));
    });
  }

  return (
    <div className="px-5 py-5 space-y-5">

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-surface-inset rounded-xl w-fit">
        <button
          onClick={() => setTab("manual")}
          className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${tab === "manual" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
        >
          Upload template
        </button>
        <button
          onClick={() => setTab("extract")}
          className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${tab === "extract" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5.5 8h5M8 5.5l2.5 2.5L8 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Extract from contract
        </button>
      </div>

      {/* Manual upload */}
      {tab === "manual" && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400 leading-relaxed">
            Create a Word document (.docx) with{" "}
            <code className="bg-surface-inset px-1 py-0.5 rounded text-gray-600">{"{{placeholder}}"}</code>{" "}
            markers, e.g.{" "}
            <code className="bg-surface-inset px-1 py-0.5 rounded text-gray-600">{"{{Employee Name}}"}</code>,{" "}
            <code className="bg-surface-inset px-1 py-0.5 rounded text-gray-600">{"{{Basic Salary}}"}</code>.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Template name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 text-sm border border-surface-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 bg-surface-inset hover:bg-gray-100 border border-surface-border px-3 py-2 rounded-lg cursor-pointer transition-colors">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 2v8M5 5l3-3 3 3" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 13h12" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {file ? file.name : "Choose .docx"}
              <input
                ref={fileRef}
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <button
              onClick={handleUpload}
              disabled={uploading || !file || !name.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
          {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
        </div>
      )}

      {/* AI extract from filled contract */}
      {tab === "extract" && (
        <div className="space-y-4">
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-indigo-800 mb-1">How it works</p>
            <p className="text-xs text-indigo-700 leading-relaxed">
              Upload a filled contract (with real employee data). The AI will identify employee-specific fields — name, salary, dates, allowances — and replace them with <code className="bg-indigo-100 px-1 rounded">{"{{placeholders}}"}</code>. Review the detected fields, then save as a reusable template.
            </p>
          </div>

          {!preview ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Template name (e.g. Advisor Contract)"
                  value={convertName}
                  onChange={(e) => setConvertName(e.target.value)}
                  className="flex-1 text-sm border border-surface-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 bg-surface-inset hover:bg-gray-100 border border-surface-border px-3 py-2 rounded-lg cursor-pointer transition-colors">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 2v8M5 5l3-3 3 3" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 13h12" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  {convertFile ? convertFile.name : "Choose .docx"}
                  <input
                    ref={convertFileRef}
                    type="file"
                    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(e) => { setConvertFile(e.target.files?.[0] ?? null); setPreview(null); }}
                  />
                </label>
                <button
                  onClick={handleExtract}
                  disabled={converting || !convertFile || !convertName.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                >
                  {converting ? (
                    <>
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
                        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Analysing…
                    </>
                  ) : "Extract fields"}
                </button>
              </div>
              {convertError && <p className="text-xs text-red-500">{convertError}</p>}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Found fields */}
              <div className="border border-surface-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-surface-inset border-b border-surface-border flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-700">
                    {preview.replacements.length - removedIndices.size} of {preview.replacements.length} field{preview.replacements.length !== 1 ? "s" : ""} active
                  </p>
                  <button onClick={() => setPreview(null)} className="text-[10px] text-gray-400 hover:text-gray-600">
                    Re-extract
                  </button>
                </div>
                <div className="divide-y divide-surface-border max-h-64 overflow-y-auto">
                  {preview.replacements.map((r, i) => {
                    const removed = removedIndices.has(i);
                    const placeholderLabel = r.placeholder.replace(/^\{\{|\}\}$/g, "");
                    return (
                      <div key={i} className={`flex items-center gap-3 px-4 py-2.5 ${removed ? "opacity-40" : ""}`}>
                        <span className={`text-xs flex-1 truncate font-mono ${removed ? "line-through text-gray-400" : "text-gray-500"}`}>{r.original}</span>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-gray-300">
                          <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <input
                          key={`${r.original}-${placeholderLabel}`}
                          type="text"
                          defaultValue={placeholderLabel}
                          disabled={removed}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v) updatePlaceholder(i, v);
                          }}
                          className="text-xs font-semibold font-mono text-indigo-600 bg-transparent border-b border-transparent hover:border-indigo-200 focus:border-indigo-400 focus:outline-none w-52 disabled:text-gray-300 disabled:line-through"
                        />
                        <button
                          onClick={() => setRemovedIndices((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i); else next.add(i);
                            return next;
                          })}
                          className={`shrink-0 p-1 rounded transition-colors ${removed ? "text-gray-300 hover:text-indigo-500" : "text-gray-300 hover:text-red-500"}`}
                          title={removed ? "Restore field" : "Remove field"}
                        >
                          {removed ? (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6a4 4 0 1 0 8 0 4 4 0 0 0-8 0Z" stroke="currentColor" strokeWidth="1.2" />
                              <path d="M4.5 6l1.5 1.5L8 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6a4 4 0 1 0 8 0 4 4 0 0 0-8 0Z" stroke="currentColor" strokeWidth="1.2" />
                              <path d="M4.5 4.5l3 3M7.5 4.5l-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                            </svg>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* AI refinement prompt */}
              <div className="border border-surface-border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-surface-inset border-b border-surface-border flex items-center gap-1.5">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke="#6366f1" strokeWidth="1.3" />
                    <path d="M5.5 8h5M8 5.5l2.5 2.5L8 10.5" stroke="#6366f1" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <p className="text-[11px] font-semibold text-indigo-700">Refine with AI</p>
                </div>
                <div className="px-4 py-3 flex gap-2 items-start">
                  <textarea
                    value={refinementPrompt}
                    onChange={(e) => setRefinementPrompt(e.target.value)}
                    placeholder={`e.g. "also extract the visa number", "rename Basic Salary to Base Pay", "remove the address field"`}
                    rows={2}
                    className="flex-1 text-xs text-gray-700 placeholder-gray-400 bg-surface-inset border border-surface-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                  <button
                    onClick={handleRefine}
                    disabled={refining || !refinementPrompt.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 shrink-0"
                  >
                    {refining ? (
                      <>
                        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
                          <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                        Refining…
                      </>
                    ) : "Refine"}
                  </button>
                </div>
              </div>

              {convertError && <p className="text-xs text-red-500">{convertError}</p>}

              <div className="flex items-center gap-3">
                <button
                  onClick={handleDownloadPreview}
                  disabled={saving}
                  className="text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-40 bg-surface-inset hover:bg-gray-100 border border-surface-border px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M7 2v7M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 11h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  Download template
                </button>
                <button
                  onClick={handleSaveTemplate}
                  disabled={saving || removedIndices.size === preview.replacements.length}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
                >
                  {saving ? "Saving…" : "Save as template"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Template list */}
      {templates.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-surface-border">
          <p className="text-xs font-semibold text-gray-700">Templates</p>
          {templates.map((t) => (
            <div
              key={t.id}
              className={`flex items-start gap-3 p-3.5 rounded-xl border ${t.isActive ? "border-emerald-200 bg-emerald-50/40" : "border-surface-border bg-surface-inset/40"}`}
            >
              <div className="w-8 h-8 rounded-lg bg-white border border-surface-border flex items-center justify-center shrink-0">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="1" width="10" height="13" rx="1.5" stroke="#6b7280" strokeWidth="1.3" fill="none" />
                  <path d="M5 5h6M5 7.5h6M5 10h4" stroke="#6b7280" strokeWidth="1.1" strokeLinecap="round" />
                  <path d="M10 1v3.5h3.5" stroke="#6b7280" strokeWidth="1.1" strokeLinecap="round" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900 truncate">{t.name}</p>
                  {t.isActive && (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">ACTIVE</span>
                  )}
                </div>
                {t.placeholders.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {t.placeholders.map((p) => (
                      <span key={p} className="text-[10px] font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                        {"{{"}{p}{"}}"}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">No placeholders detected</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openPreview(t)}
                  className="text-gray-300 hover:text-indigo-500 transition-colors p-1"
                  title="Preview template"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z" stroke="currentColor" strokeWidth="1.3" fill="none" />
                    <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
                  </svg>
                </button>
                <button
                  onClick={() => handleActivate(t.id)}
                  disabled={isPending}
                  title={t.isActive ? "Deactivate" : "Activate"}
                  className={`relative w-9 h-5 rounded-full transition-colors ${t.isActive ? "bg-emerald-500" : "bg-gray-200"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${t.isActive ? "translate-x-4" : "translate-x-0"}`} />
                </button>
                {confirmDeleteId === t.id ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-gray-500 font-medium">Delete?</span>
                    <button
                      onClick={() => { handleDelete(t.id); setConfirmDeleteId(null); }}
                      disabled={isPending}
                      className="text-[11px] font-semibold text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-[11px] font-medium text-gray-500 hover:text-gray-700 px-1.5 py-0.5 transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(t.id)}
                    disabled={isPending}
                    className="text-gray-300 hover:text-red-500 transition-colors p-1"
                    aria-label="Delete template"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {templates.length === 0 && (
        <p className="text-xs text-gray-400">No templates uploaded yet.</p>
      )}

      {/* Template preview modal */}
      {previewTemplate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setPreviewTemplate(null); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border shrink-0">
              <div>
                <h2 className="text-base font-semibold text-gray-900">{previewTemplate.name}</h2>
                <p className="text-xs text-gray-400 mt-0.5">Template preview</p>
              </div>
              <button
                onClick={() => setPreviewTemplate(null)}
                className="text-gray-300 hover:text-gray-600 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto bg-surface-inset p-6 min-h-0">
              {previewLoading ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <svg className="animate-spin w-6 h-6 text-indigo-400" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
                    <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  <p className="text-sm text-gray-400">Loading preview…</p>
                </div>
              ) : previewHtml ? (
                <div className="bg-white rounded-xl shadow-sm border border-surface-border mx-auto max-w-2xl p-8 contract-preview">
                  <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-gray-400">Preview unavailable</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
