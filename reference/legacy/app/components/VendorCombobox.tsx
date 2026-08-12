"use client";

import { useState, useRef, useEffect } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (value: string) => void;
  vendors: string[];
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

export default function VendorCombobox({
  value,
  onChange,
  onSelect,
  vendors,
  placeholder = "Search or add client…",
  className = "",
  inputClassName = "",
}: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = vendors.filter(v => v.toLowerCase().includes(query.toLowerCase()));
  const exactMatch = vendors.some(v => v.toLowerCase() === query.trim().toLowerCase());
  const canCreate = query.trim().length > 0 && !exactMatch;

  function select(v: string) {
    setQuery(v);
    onChange(v);
    if (onSelect) onSelect(v);
    setOpen(false);
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    onChange(v);
    setOpen(true);
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        type="text"
        value={query}
        onChange={handleInput}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className={`w-full outline-none ${inputClassName}`}
      />
      {open && (filtered.length > 0 || canCreate) && (
        <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-y-auto max-h-52">
          {filtered.map(v => (
            <button
              key={v}
              type="button"
              onMouseDown={() => select(v)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-indigo-50 ${
                v === value ? "bg-indigo-50 text-indigo-700 font-medium" : "text-gray-800"
              }`}
            >
              {v}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onMouseDown={() => select(query.trim())}
              className="w-full text-left px-3 py-2 text-sm text-indigo-600 font-medium hover:bg-indigo-50 border-t border-gray-100 transition-colors"
            >
              + Add &ldquo;{query.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
