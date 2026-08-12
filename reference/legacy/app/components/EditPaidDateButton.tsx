"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function EditPaidDateButton({
  documentId,
  paidAt,
}: {
  documentId: string;
  paidAt: string | null; // ISO date string YYYY-MM-DD or null
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(paidAt ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch(`/api/documents/${documentId}/paid`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paidAt: input || null }),
    });
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  function cancel() {
    setInput(paidAt ?? "");
    setEditing(false);
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5 group">
        <span className="text-sm text-green-700">{paidAt ?? <span className="text-gray-400">—</span>}</span>
        <button
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-indigo-600"
          title="Edit paid date"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
          </svg>
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="date"
        value={input}
        onChange={e => setInput(e.target.value)}
        autoFocus
        onKeyDown={e => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") cancel();
        }}
        className="text-sm border border-indigo-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />
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
  );
}
