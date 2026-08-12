"use client";

import { useState, useEffect, useRef } from "react";

export default function PartiesComboInput({
  parties,
  onChange,
}: {
  parties: string[];
  onChange: (p: string[]) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/party-suggestions")
      .then(r => r.json())
      .then(d => setSuggestions(d.suggestions ?? []))
      .catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const filtered = draft.trim()
    ? suggestions.filter(
        s => s.toLowerCase().includes(draft.toLowerCase()) && !parties.includes(s)
      )
    : suggestions.filter(s => !parties.includes(s));

  const draftIsNew = draft.trim() !== "" && !suggestions.some(
    s => s.toLowerCase() === draft.trim().toLowerCase()
  );

  function add(name: string) {
    const trimmed = name.trim();
    if (trimmed && !parties.includes(trimmed)) {
      onChange([...parties, trimmed]);
    }
    setDraft("");
    setOpen(false);
    inputRef.current?.focus();
  }

  function remove(name: string) {
    onChange(parties.filter(p => p !== name));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered.length > 0 && !draftIsNew) {
        add(filtered[0]);
      } else if (draft.trim()) {
        add(draft);
      }
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
    if (e.key === "Backspace" && draft === "" && parties.length > 0) {
      onChange(parties.slice(0, -1));
    }
  }

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Selected chips */}
      {parties.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {parties.map(p => (
            <span
              key={p}
              className="flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-medium px-2.5 py-1 rounded-full"
            >
              {p}
              <button
                type="button"
                onClick={() => remove(p)}
                className="text-indigo-400 hover:text-indigo-700 leading-none ml-0.5"
                tabIndex={-1}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input + dropdown */}
      <div className="relative">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={e => { setDraft(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search or type a new party…"
            className="flex-1 border border-surface-border rounded-lg px-3 py-2 text-sm text-gray-900 bg-white placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-colors"
          />
          <button
            type="button"
            onClick={() => draft.trim() ? add(draft) : setOpen(o => !o)}
            className="px-3 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors shrink-0"
          >
            {draft.trim() ? "Add" : "Browse"}
          </button>
        </div>

        {/* Dropdown */}
        {open && (filtered.length > 0 || draftIsNew) && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-surface-border rounded-xl shadow-lg overflow-hidden">
            {/* Existing suggestions */}
            {filtered.length > 0 && (
              <div className="max-h-48 overflow-y-auto">
                {filtered.length > 0 && (
                  <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                    Existing parties
                  </p>
                )}
                {filtered.map(s => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); add(s); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors text-left"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-gray-300">
                      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M4 6l1.5 1.5L8 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Add new option */}
            {draftIsNew && (
              <div className={filtered.length > 0 ? "border-t border-surface-border" : ""}>
                <button
                  type="button"
                  onMouseDown={e => { e.preventDefault(); add(draft); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors text-left"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-indigo-400">
                    <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span>Add <strong>&ldquo;{draft.trim()}&rdquo;</strong> as new party</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400">
        Select from existing or type a new name and press Enter
      </p>
    </div>
  );
}
