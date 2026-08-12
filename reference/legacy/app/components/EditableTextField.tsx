"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Props {
  documentId: string;
  field: string;
  value: string | number | null;
  type?: "text" | "textarea" | "number";
  placeholder?: string;
  canEdit?: boolean;
}

const PencilIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
    <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);

export default function EditableTextField({ documentId, field, value, type = "text", placeholder = "—", canEdit = true }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(value != null ? String(value) : "");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  async function save() {
    const parsed = type === "number"
      ? (input.trim() === "" ? null : parseFloat(input))
      : (input.trim() === "" ? null : input.trim());
    setSaving(true);
    await fetch(`/api/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: parsed }),
    });
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  function cancel() {
    setInput(value != null ? String(value) : "");
    setEditing(false);
  }

  if (!editing) {
    const display = value != null && value !== "" ? String(value) : null;
    return (
      <span className="inline-flex items-start gap-1.5 group">
        <span className={display ? "" : "text-gray-400"}>{display ?? placeholder}</span>
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-indigo-600 mt-0.5 shrink-0"
            title="Edit"
          >
            <PencilIcon />
          </button>
        )}
      </span>
    );
  }

  const sharedClass = "text-sm border border-indigo-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400";

  return (
    <span className="inline-flex items-start gap-1.5 w-full">
      {type === "textarea" ? (
        <textarea
          ref={ref}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          className={`${sharedClass} w-full resize-y`}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
          }}
        />
      ) : (
        <input
          ref={ref}
          type={type}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className={`${sharedClass} ${type === "number" ? "w-32" : "w-full max-w-xs"}`}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
        />
      )}
      <span className="inline-flex items-center gap-1 shrink-0 mt-0.5">
        <button
          onClick={save}
          disabled={saving}
          className="text-[10px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-2 py-0.5 rounded disabled:opacity-50"
        >
          {saving ? "…" : "Save"}
        </button>
        <button onClick={cancel} className="text-[10px] font-medium text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </span>
    </span>
  );
}
