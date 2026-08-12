"use client";

import { useState, useRef, useEffect } from "react";

export default function EditableParties({
  documentId,
  initialParties,
}: {
  documentId: string;
  initialParties: string[];
}) {
  const [parties, setParties] = useState<string[]>(initialParties);
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<string[]>([]);
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);
  const newInputRef = useRef<HTMLInputElement>(null);

  function openEdit() {
    setEditValues([...parties]);
    setNewValue("");
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setNewValue("");
  }

  function updateValue(i: number, val: string) {
    setEditValues(prev => prev.map((v, idx) => idx === i ? val : v));
  }

  function removeEntry(i: number) {
    setEditValues(prev => prev.filter((_, idx) => idx !== i));
  }

  function addEntry() {
    const trimmed = newValue.trim();
    if (!trimmed) return;
    setEditValues(prev => [...prev, trimmed]);
    setNewValue("");
    setTimeout(() => newInputRef.current?.focus(), 0);
  }

  async function save() {
    const cleaned = [...editValues.map(v => v.trim()).filter(Boolean)];
    const trimmedNew = newValue.trim();
    if (trimmedNew) cleaned.push(trimmedNew);

    setSaving(true);
    const res = await fetch(`/api/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parties: cleaned }),
    });
    if (res.ok) {
      setParties(cleaned);
      setEditing(false);
      setNewValue("");
    }
    setSaving(false);
  }

  if (!editing) {
    return (
      <div className="flex items-start gap-2 flex-wrap group">
        {parties.length > 0 ? (
          parties.map((p, i) => (
            <span key={i} className="inline-flex items-center text-xs font-medium bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full">
              {p}
            </span>
          ))
        ) : (
          <span className="text-sm text-gray-300">—</span>
        )}
        <button
          onClick={openEdit}
          title="Edit parties"
          className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-full shrink-0"
        >
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
            <path d="M8.5 1.5l2 2-6 6H2.5v-2l6-6z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Existing entries */}
      {editValues.map((val, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="text"
            value={val}
            onChange={e => updateValue(i, e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); newInputRef.current?.focus(); } }}
            className="flex-1 h-7 px-2.5 text-sm text-gray-800 bg-white border border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
          />
          <button
            onClick={() => removeEntry(i)}
            className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
            title="Remove"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}

      {/* Add new entry */}
      <div className="flex items-center gap-1.5">
        <input
          ref={newInputRef}
          type="text"
          value={newValue}
          onChange={e => setNewValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addEntry(); } }}
          placeholder="Add party…"
          className="flex-1 h-7 px-2.5 text-sm text-gray-600 bg-gray-50 border border-dashed border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-300"
        />
        <button
          onClick={addEntry}
          disabled={!newValue.trim()}
          className="p-1 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-30 transition-colors shrink-0"
          title="Add"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={save}
          disabled={saving}
          className="h-7 px-3 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={cancelEdit}
          className="h-7 px-3 text-xs font-semibold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
