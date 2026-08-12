"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Entity = { id: string; name: string; country: string; currency: string | null };

export default function EntityPicker({
  documentId,
  currentEntityId,
  currentEntityName,
}: {
  documentId: string;
  currentEntityId: string | null;
  currentEntityName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && entities.length === 0) {
      fetch("/api/legal-entities").then(r => r.json()).then(setEntities);
    }
  }, [open]);

  async function assign(entityId: string | null) {
    setSaving(true);
    setOpen(false);
    await fetch(`/api/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ legalEntityId: entityId }),
    });
    setSaving(false);
    router.refresh();
  }

  if (saving) {
    return <span className="text-xs text-gray-400">Saving…</span>;
  }

  if (!open) {
    if (currentEntityName) {
      return (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full hover:bg-indigo-100 transition-colors"
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" className="shrink-0">
              <rect x="0.5" y="1.5" width="9" height="7" rx="1" stroke="currentColor" strokeWidth="1.1" fill="none" />
              <path d="M0.5 3.5h9" stroke="currentColor" strokeWidth="0.9" />
            </svg>
            {currentEntityName}
          </button>
          <button
            onClick={() => assign(null)}
            className="p-0.5 text-gray-300 hover:text-red-400 transition-colors"
            title="Remove entity"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      );
    }
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-gray-400 hover:text-indigo-600 transition-colors"
      >
        — Assign entity
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1 min-w-[200px]">
      <div className="bg-white border border-indigo-300 rounded-xl shadow-sm overflow-hidden">
        {currentEntityId && (
          <button
            onClick={() => assign(null)}
            className="w-full text-left px-3 py-2 text-[11px] text-red-500 hover:bg-red-50 border-b border-gray-100 transition-colors"
          >
            Remove assignment
          </button>
        )}
        {entities.length === 0 && (
          <p className="text-[11px] text-gray-400 px-3 py-2">
            No entities configured — add them in Settings.
          </p>
        )}
        {entities.map(e => (
          <button
            key={e.id}
            onClick={() => assign(e.id)}
            className={`w-full text-left px-3 py-2 hover:bg-indigo-50 transition-colors ${e.id === currentEntityId ? "bg-indigo-50" : ""}`}
          >
            <p className={`text-[11px] font-medium ${e.id === currentEntityId ? "text-indigo-700" : "text-gray-800"}`}>{e.name}</p>
            <p className="text-[10px] text-gray-400">{e.country}{e.currency ? ` · ${e.currency}` : ""}</p>
          </button>
        ))}
      </div>
      <button onClick={() => setOpen(false)} className="text-[10px] text-gray-400 hover:text-gray-600 text-left px-1">
        Cancel
      </button>
    </div>
  );
}
