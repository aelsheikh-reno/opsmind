"use client";

import { useState, useEffect, useRef } from "react";

const DEFAULT_TYPES = [
  "Supplies",
  "Travel",
  "Accommodation",
  "Food & Beverage",
  "Per Diem",
  "Software & Subscriptions",
  "Marketing & Advertising",
  "Entertainment",
  "Training & Education",
  "Equipment",
  "Utilities",
  "Professional Services",
  "Medical",
  "Miscellaneous",
];

const STORAGE_KEY = "opsmind_expense_types_custom";

function loadCustom(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustom(types: string[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(types)); } catch { /* ignore */ }
}

export default function TypeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [showInput, setShowInput] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCustomTypes(loadCustom());
  }, []);

  const knownTypes = [
    ...DEFAULT_TYPES,
    ...customTypes.filter(t => !DEFAULT_TYPES.includes(t)),
  ];
  // Ensure the current value is always present even if it came from another device
  const allTypes = value && !knownTypes.includes(value) ? [...knownTypes, value] : knownTypes;

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v === "__custom__") {
      setShowInput(true);
      setInputVal("");
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      onChange(v);
      setShowInput(false);
    }
  }

  function confirm() {
    const trimmed = inputVal.trim();
    if (!trimmed) { setShowInput(false); return; }
    const updated = customTypes.includes(trimmed) ? customTypes : [...customTypes, trimmed];
    setCustomTypes(updated);
    saveCustom(updated);
    onChange(trimmed);
    setShowInput(false);
    setInputVal("");
  }

  return (
    <div className="flex flex-col gap-1.5">
      <select
        value={showInput ? "__custom__" : value}
        onChange={handleSelectChange}
        className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
      >
        <option value="">— Select type —</option>
        {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
        <option disabled value="__sep__">──────────────</option>
        <option value="__custom__">+ Add new type…</option>
      </select>

      {showInput && (
        <input
          ref={inputRef}
          type="text"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          placeholder="Type a custom category…"
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); confirm(); }
            if (e.key === "Escape") { setShowInput(false); }
          }}
          onBlur={confirm}
          className="w-full h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-indigo-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400"
        />
      )}
    </div>
  );
}
