"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function InvoiceFileManager({
  documentId,
  hasFile,
  filename,
}: {
  documentId: string;
  hasFile: boolean;
  filename: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/documents/${documentId}/file`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Upload failed");
      setUploading(false);
      return;
    }
    setUploading(false);
    router.refresh();
  }

  async function removeFile() {
    setRemoving(true);
    setConfirmRemove(false);
    const res = await fetch(`/api/documents/${documentId}/file`, { method: "DELETE" });
    if (!res.ok) setError("Failed to remove file");
    setRemoving(false);
    router.refresh();
  }

  if (!hasFile) {
    return (
      <div className="mt-4">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.docx,.doc"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full flex flex-col items-center gap-2 py-6 rounded-xl border-2 border-dashed border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/30 text-gray-400 hover:text-indigo-500 transition-all disabled:opacity-50"
        >
          {uploading ? (
            <>
              <svg width="20" height="20" viewBox="0 0 20 20" className="animate-spin" fill="none">
                <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="2" strokeDasharray="12 12" />
              </svg>
              <span className="text-xs font-medium">Uploading…</span>
            </>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 3v10M6 7l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="text-xs font-medium">Attach document</span>
              <span className="text-[10px] text-gray-300">PDF, image, spreadsheet, or Word doc</span>
            </>
          )}
        </button>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-4 pt-3 border-t border-surface-border">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.docx,.doc"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">File actions</p>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading || removing}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-surface-inset border border-surface-border hover:bg-surface-hover px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {uploading ? (
            <svg width="12" height="12" viewBox="0 0 12 12" className="animate-spin" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="7 7" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 2v6M3 4l3-2 3 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M1 10h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          )}
          {uploading ? "Replacing…" : "Replace file"}
        </button>

        {confirmRemove ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Remove attached file?</span>
            <button
              onClick={removeFile}
              disabled={removing}
              className="text-xs font-medium text-red-600 hover:text-red-800 transition-colors disabled:opacity-50"
            >
              {removing ? "Removing…" : "Yes, remove"}
            </button>
            <button
              onClick={() => setConfirmRemove(false)}
              className="text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmRemove(true)}
            disabled={uploading || removing}
            className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 3h8M5 3V2h2v1M4.5 5v4M7.5 5v4M3 3l.5 7h5L9 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Remove file
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  );
}
