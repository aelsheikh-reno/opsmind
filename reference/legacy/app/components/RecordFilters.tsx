"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

type Option = { value: string; label: string };

type Props = {
  q?: string;
  party?: string;
  year?: string;
  status?: string;
  docType?: string;
  partyOptions: Option[];
  yearOptions: Option[];
  statusOptions: Option[];
  docTypeOptions?: Option[];
  searchPlaceholder?: string;
  extraParams?: Record<string, string>;
};

function PartyCombobox({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Option[];
  onChange: (val: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const selectedLabel = value ? (options.find(o => o.value === value)?.label ?? value) : "";
  const filtered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  function handleOpen() {
    setOpen(true);
    setSearch("");
  }

  function handleSelect(val: string) {
    onChange(val);
    setOpen(false);
    setSearch("");
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange("");
    setOpen(false);
    setSearch("");
  }

  const isActive = !!value;

  return (
    <div ref={containerRef} className="relative">
      <div
        onClick={handleOpen}
        className={`flex items-center gap-1.5 h-8 pl-2.5 pr-2 text-sm border rounded-lg cursor-pointer select-none transition-colors min-w-[140px] ${
          isActive
            ? "border-indigo-300 bg-indigo-50 text-indigo-700 font-medium"
            : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
        }`}
      >
        {open ? (
          <input
            ref={inputRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Escape") { setOpen(false); setSearch(""); }
              if (e.key === "Enter" && filtered.length === 1) handleSelect(filtered[0].value);
            }}
            placeholder={selectedLabel || "Search parties…"}
            className="bg-transparent outline-none flex-1 min-w-0 text-gray-700 placeholder-gray-400 text-sm"
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 truncate">{selectedLabel || "All parties"}</span>
        )}

        {isActive && !open ? (
          <button onClick={handleClear} className="shrink-0 text-indigo-400 hover:text-indigo-700 transition-colors" aria-label="Clear">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        ) : !open ? (
          <svg className="shrink-0 text-gray-400" width="10" height="10" viewBox="0 0 10 6" fill="none">
            <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </div>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-surface-border rounded-xl shadow-lg w-56 max-h-64 overflow-y-auto py-1">
          <button
            className={`w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-surface-hover ${!value ? "text-indigo-600 font-medium" : "text-gray-400"}`}
            onClick={() => handleSelect("")}
          >
            All parties
          </button>
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-400">No matches</p>
          ) : (
            filtered.map(o => (
              <button
                key={o.value}
                className={`w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-surface-hover ${o.value === value ? "text-indigo-600 font-medium bg-indigo-50/50" : "text-gray-700"}`}
                onClick={() => handleSelect(o.value)}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function RecordFilters({
  q: initQ = "",
  party: initParty = "",
  year: initYear = "",
  status: initStatus = "",
  docType: initDocType = "",
  partyOptions,
  yearOptions,
  statusOptions,
  docTypeOptions = [],
  searchPlaceholder = "Search…",
  extraParams = {},
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const [q, setQ] = useState(initQ);
  const [party, setParty] = useState(initParty);
  const [year, setYear] = useState(initYear);
  const [status, setStatus] = useState(initStatus);
  const [docType, setDocType] = useState(initDocType);

  const qRef = useRef(initQ);
  const partyRef = useRef(initParty);
  const yearRef = useRef(initYear);
  const statusRef = useRef(initStatus);
  const docTypeRef = useRef(initDocType);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function buildUrl(overrides: Partial<{ q: string; party: string; year: string; status: string; docType: string }> = {}) {
    const vals = {
      q: qRef.current,
      party: partyRef.current,
      year: yearRef.current,
      status: statusRef.current,
      docType: docTypeRef.current,
      ...overrides,
    };
    const params = new URLSearchParams(extraParams);
    if (vals.q?.trim()) params.set("q", vals.q.trim());
    if (vals.party) params.set("party", vals.party);
    if (vals.year) params.set("year", vals.year);
    if (vals.status) params.set("status", vals.status);
    if (vals.docType) params.set("docType", vals.docType);
    return `${pathname}${params.size ? `?${params}` : ""}`;
  }

  function handleQChange(next: string) {
    setQ(next);
    qRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => router.replace(buildUrl()), 300);
  }

  function handleParty(val: string) {
    setParty(val);
    partyRef.current = val;
    router.replace(buildUrl({ party: val }));
  }

  function handleSelect(key: "year" | "status" | "docType", val: string) {
    if (key === "year") { setYear(val); yearRef.current = val; }
    else if (key === "status") { setStatus(val); statusRef.current = val; }
    else { setDocType(val); docTypeRef.current = val; }
    router.replace(buildUrl({ [key]: val }));
  }

  function clearAll() {
    setQ(""); setParty(""); setYear(""); setStatus(""); setDocType("");
    qRef.current = ""; partyRef.current = ""; yearRef.current = ""; statusRef.current = ""; docTypeRef.current = "";
    const params = new URLSearchParams(extraParams);
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`);
  }

  const hasFilters = q || party || year || status || docType;

  const selectCls = (active: boolean) =>
    `h-8 px-2.5 text-sm border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors cursor-pointer ${
      active
        ? "border-indigo-300 bg-indigo-50 text-indigo-700 font-medium"
        : "border-gray-200 bg-white text-gray-500"
    }`;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative flex items-center w-56">
        <svg className="absolute left-2.5 text-gray-400 pointer-events-none shrink-0" width="13" height="13" viewBox="0 0 14 14" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M9.5 9.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={q}
          onChange={e => handleQChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 w-full pl-8 pr-7 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400"
        />
        {q && (
          <button type="button" onClick={() => handleQChange("")} className="absolute right-2.5 text-gray-400 hover:text-gray-600 transition-colors">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {partyOptions.length > 0 && (
        <PartyCombobox value={party} options={partyOptions} onChange={handleParty} />
      )}

      {docTypeOptions.length > 0 && (
        <select value={docType} onChange={e => handleSelect("docType", e.target.value)} className={selectCls(!!docType)}>
          <option value="">All types</option>
          {docTypeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}

      {yearOptions.length > 0 && (
        <select value={year} onChange={e => handleSelect("year", e.target.value)} className={selectCls(!!year)}>
          <option value="">All years</option>
          {yearOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}

      {statusOptions.length > 0 && (
        <select value={status} onChange={e => handleSelect("status", e.target.value)} className={selectCls(!!status)}>
          <option value="">All statuses</option>
          {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}

      {hasFilters && (
        <button
          type="button"
          onClick={clearAll}
          className="h-8 px-2.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}
