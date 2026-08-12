"use client";

import { useState } from "react";

export default function EntityNameForm({ initialName }: { initialName: string }) {
  const [value, setValue] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!value.trim()) return;
    setSaving(true);
    setSaved(false);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "entityName", value: value.trim() }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-4">
        This name appears in the sidebar and breadcrumb navigation across the app.
      </p>
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={value}
          onChange={e => { setValue(e.target.value); setSaved(false); }}
          onKeyDown={e => e.key === "Enter" && save()}
          placeholder="e.g. Reno Holdings"
          className="flex-1 max-w-xs h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400"
        />
        <button
          onClick={save}
          disabled={!value.trim() || saving}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            !value.trim()
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : saving
              ? "bg-indigo-400 text-white cursor-wait"
              : "bg-indigo-600 hover:bg-indigo-700 text-white"
          }`}
        >
          {saving ? (
            <>
              <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" />
              </svg>
              Saving…
            </>
          ) : "Save"}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-green-700 font-medium">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 7l2.5 2.5L11 4" stroke="#15803d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
