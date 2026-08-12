"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

const DOC_TYPE_LABELS: Record<string, string> = {
  visa: "Visa", emirates_id: "Emirates ID", labor_card: "Labor Card",
  trade_license: "Trade License", employee_contract: "Employee Contract",
  client_contract: "Client Contract", lease_contract: "Lease / Rental",
  invoice: "Invoice", invoice_report: "Invoice Report", payroll: "Payroll",
  insurance: "Insurance", government_permit: "Gov. Permit", other: "Other",
};

const DOC_TYPE_COLORS: Record<string, string> = {
  visa: "bg-blue-50 text-blue-700", emirates_id: "bg-purple-50 text-purple-700",
  labor_card: "bg-indigo-50 text-indigo-700", trade_license: "bg-amber-50 text-amber-700",
  employee_contract: "bg-green-50 text-green-700", client_contract: "bg-teal-50 text-teal-700",
  lease_contract: "bg-violet-50 text-violet-700", invoice: "bg-orange-50 text-orange-700",
  invoice_report: "bg-orange-50 text-orange-700", payroll: "bg-pink-50 text-pink-700",
  insurance: "bg-cyan-50 text-cyan-700", government_permit: "bg-red-50 text-red-700",
  other: "bg-gray-100 text-gray-700",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-50 text-green-700",
  completed: "bg-blue-50 text-blue-700",
  on_hold: "bg-amber-50 text-amber-700",
  cancelled: "bg-gray-100 text-gray-500",
};

const CLAIM_COLORS: Record<string, string> = {
  approved: "bg-green-50 text-green-700",
  pending:  "bg-amber-50 text-amber-700",
  rejected: "bg-red-50 text-red-700",
};

type DocResult     = { id: string; filename: string; docType: string | null; parties: string | null; referenceNumber: string | null };
type PersonResult  = { id: string; name: string; jobTitle: string | null; department: string | null };
type ProjectResult = { id: string; name: string; clientName: string | null; status: string; billingType: string };
type ExpenseResult = { id: string; name: string; expenseType: string | null; amount: number | null; currency: string; claimStatus: string | null };
type ClientResult  = { id: string; name: string; country: string };

type Results = {
  documents: DocResult[];
  people:    PersonResult[];
  projects:  ProjectResult[];
  expenses:  ExpenseResult[];
  clients:   ClientResult[];
};

function ArrowIcon({ active }: { active: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
      className={`shrink-0 transition-opacity ${active ? "opacity-100 text-indigo-400" : "opacity-0"}`}>
      <path d="M2 5h6M5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-4 pt-3 pb-1.5">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
    </div>
  );
}

function Divider() {
  return <div className="mx-4 my-1 border-t border-surface-border" />;
}

export default function GlobalSearch() {
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<Results | null>(null);
  const [loading, setLoading]   = useState(false);
  const [open, setOpen]         = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const inputRef     = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router       = useRouter();

  // Flattened navigation list for keyboard nav
  const items: Array<{ href: string }> = [
    ...(results?.documents ?? []).map(d => ({ href: `/records/${d.id}` })),
    ...(results?.people    ?? []).map(p => ({ href: `/people/${p.id}` })),
    ...(results?.projects  ?? []).map(p => ({ href: `/projects/${p.id}` })),
    ...(results?.expenses  ?? []).map(() => ({ href: `/expenses` })),
    ...(results?.clients   ?? []).map(() => ({ href: `/records` })),
  ];

  const navigate = useCallback((href: string) => {
    setOpen(false);
    setQuery("");
    setResults(null);
    router.push(href);
  }, [router]);

  // ⌘K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside to close
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Debounced fetch
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults(null); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data);
        setActiveIdx(-1);
      } finally {
        setLoading(false);
      }
    }, 280);
  }, [query]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); return; }
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      navigate(items[activeIdx].href);
    }
  }

  const hasResults = results && (
    results.documents.length > 0 || results.people.length > 0 ||
    results.projects.length > 0  || results.expenses.length > 0 ||
    results.clients.length > 0
  );
  const showDropdown = open && query.length >= 2;

  // Tracks absolute index across all sections for keyboard highlight
  let globalIdx = 0;

  const sectionCount = results
    ? [results.documents, results.people, results.projects, results.expenses, results.clients]
        .filter(a => a.length > 0).length
    : 0;
  let sectionsSeen = 0;

  function maybeDiv(list: unknown[]) {
    if (list.length > 0) {
      sectionsSeen++;
      return sectionsSeen < sectionCount;
    }
    return false;
  }

  return (
    <div ref={containerRef} className="relative hidden md:block w-72 shrink-0">
      {/* Input */}
      <div className={`flex items-center gap-2 bg-surface-inset border rounded-lg px-3 h-8 transition-colors ${open ? "border-indigo-300 ring-2 ring-indigo-50" : "border-gray-200"}`}>
        {loading ? (
          <svg className="animate-spin w-3.5 h-3.5 text-indigo-400 shrink-0" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
            <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-gray-400 shrink-0">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search people, projects, documents…"
          className="bg-transparent text-xs text-gray-600 placeholder-gray-400 outline-none flex-1 min-w-0"
        />
        {query ? (
          <button
            onClick={() => { setQuery(""); setResults(null); setOpen(false); inputRef.current?.focus(); }}
            className="text-gray-300 hover:text-gray-500 transition-colors shrink-0"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        ) : (
          <kbd className="text-[10px] text-gray-400 bg-white border border-gray-200 rounded px-1 py-0.5 shrink-0 font-mono">⌘K</kbd>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute top-full mt-1.5 left-0 right-0 bg-white border border-surface-border rounded-xl shadow-xl z-50 overflow-hidden max-h-[520px] overflow-y-auto">

          {/* Loading skeleton */}
          {loading && !results && (
            <div className="px-4 py-3 space-y-2">
              {[1,2,3].map(i => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-16 h-4 bg-gray-100 rounded animate-pulse" />
                  <div className="flex-1 h-4 bg-gray-100 rounded animate-pulse" />
                </div>
              ))}
            </div>
          )}

          {/* No results */}
          {!loading && results && !hasResults && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-gray-400">No results for <span className="font-medium text-gray-600">&ldquo;{query}&rdquo;</span></p>
            </div>
          )}

          {/* ── Documents ── */}
          {results && results.documents.length > 0 && (
            <div>
              <SectionHeader label="Documents" />
              {results.documents.map(doc => {
                const idx = globalIdx++;
                const isActive = activeIdx === idx;
                const parties: string[] = doc.parties ? (() => { try { return JSON.parse(doc.parties!); } catch { return [doc.parties]; } })() : [];
                return (
                  <button key={doc.id} onClick={() => navigate(`/records/${doc.id}`)} onMouseEnter={() => setActiveIdx(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isActive ? "bg-indigo-50" : "hover:bg-surface-hover"}`}>
                    <div className="w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
                      <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                        <path d="M2.5 1.5h6.5l3 3v8a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5z" stroke="#6b7280" strokeWidth="1.2" fill="none" />
                        <path d="M4 6h6M4 8h5M4 10h3" stroke="#6b7280" strokeWidth="1.1" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">{doc.filename}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {doc.docType && (
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${DOC_TYPE_COLORS[doc.docType] ?? DOC_TYPE_COLORS.other}`}>
                            {DOC_TYPE_LABELS[doc.docType] ?? doc.docType}
                          </span>
                        )}
                        {parties.length > 0 && (
                          <span className="text-[10px] text-gray-400 truncate">{parties.slice(0, 2).join(", ")}</span>
                        )}
                      </div>
                    </div>
                    <ArrowIcon active={isActive} />
                  </button>
                );
              })}
              {maybeDiv(results.documents) && <Divider />}
            </div>
          )}

          {/* ── People ── */}
          {results && results.people.length > 0 && (
            <div>
              <SectionHeader label="People" />
              {results.people.map(person => {
                const idx = globalIdx++;
                const isActive = activeIdx === idx;
                const initials = person.name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();
                return (
                  <button key={person.id} onClick={() => navigate(`/people/${person.id}`)} onMouseEnter={() => setActiveIdx(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isActive ? "bg-indigo-50" : "hover:bg-surface-hover"}`}>
                    <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                      <span className="text-[9px] font-bold text-indigo-600">{initials}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">{person.name}</p>
                      {(person.jobTitle || person.department) && (
                        <p className="text-[10px] text-gray-400 truncate mt-0.5">
                          {[person.jobTitle, person.department].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    <ArrowIcon active={isActive} />
                  </button>
                );
              })}
              {maybeDiv(results.people) && <Divider />}
            </div>
          )}

          {/* ── Projects ── */}
          {results && results.projects.length > 0 && (
            <div>
              <SectionHeader label="Projects" />
              {results.projects.map(project => {
                const idx = globalIdx++;
                const isActive = activeIdx === idx;
                return (
                  <button key={project.id} onClick={() => navigate(`/projects/${project.id}`)} onMouseEnter={() => setActiveIdx(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isActive ? "bg-indigo-50" : "hover:bg-surface-hover"}`}>
                    <div className="w-7 h-7 rounded-md bg-violet-100 flex items-center justify-center shrink-0">
                      <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                        <rect x="1.5" y="3" width="11" height="9" rx="1.5" stroke="#7c3aed" strokeWidth="1.2" fill="none" />
                        <path d="M5 3V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" stroke="#7c3aed" strokeWidth="1.2" strokeLinecap="round" />
                        <path d="M4 7h6M4 9.5h4" stroke="#7c3aed" strokeWidth="1.1" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">{project.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_COLORS[project.status] ?? "bg-gray-100 text-gray-500"}`}>
                          {project.status.replace("_", " ")}
                        </span>
                        {project.clientName && (
                          <span className="text-[10px] text-gray-400 truncate">{project.clientName}</span>
                        )}
                      </div>
                    </div>
                    <ArrowIcon active={isActive} />
                  </button>
                );
              })}
              {maybeDiv(results.projects) && <Divider />}
            </div>
          )}

          {/* ── Expenses ── */}
          {results && results.expenses.length > 0 && (
            <div>
              <SectionHeader label="Expenses" />
              {results.expenses.map(expense => {
                const idx = globalIdx++;
                const isActive = activeIdx === idx;
                return (
                  <button key={expense.id} onClick={() => navigate(`/expenses`)} onMouseEnter={() => setActiveIdx(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isActive ? "bg-indigo-50" : "hover:bg-surface-hover"}`}>
                    <div className="w-7 h-7 rounded-md bg-amber-50 flex items-center justify-center shrink-0">
                      <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                        <circle cx="7" cy="7" r="5.5" stroke="#d97706" strokeWidth="1.2" fill="none" />
                        <path d="M7 4v6M5 5.5c0-.83.67-1.5 2-1.5s2 .67 2 1.5S8.33 7 7 7s-2 .67-2 1.5S5.67 10 7 10s2-.67 2-1.5" stroke="#d97706" strokeWidth="1.1" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">{expense.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {expense.claimStatus && (
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${CLAIM_COLORS[expense.claimStatus] ?? "bg-gray-100 text-gray-500"}`}>
                            {expense.claimStatus}
                          </span>
                        )}
                        {expense.amount != null && (
                          <span className="text-[10px] text-gray-400">
                            {expense.currency} {expense.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        )}
                        {expense.expenseType && (
                          <span className="text-[10px] text-gray-400 truncate">{expense.expenseType}</span>
                        )}
                      </div>
                    </div>
                    <ArrowIcon active={isActive} />
                  </button>
                );
              })}
              {maybeDiv(results.expenses) && <Divider />}
            </div>
          )}

          {/* ── Clients ── */}
          {results && results.clients.length > 0 && (
            <div>
              <SectionHeader label="Clients" />
              {results.clients.map(client => {
                const idx = globalIdx++;
                const isActive = activeIdx === idx;
                const initials = client.name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();
                return (
                  <button key={client.id} onClick={() => navigate(`/records`)} onMouseEnter={() => setActiveIdx(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isActive ? "bg-indigo-50" : "hover:bg-surface-hover"}`}>
                    <div className="w-7 h-7 rounded-md bg-teal-100 flex items-center justify-center shrink-0">
                      <span className="text-[9px] font-bold text-teal-700">{initials}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">{client.name}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{client.country}</p>
                    </div>
                    <ArrowIcon active={isActive} />
                  </button>
                );
              })}
            </div>
          )}

          {/* Footer */}
          {hasResults && (
            <div className="px-4 py-2 border-t border-surface-border bg-surface-inset flex items-center gap-3">
              <span className="text-[10px] text-gray-400 flex items-center gap-1">
                <kbd className="bg-white border border-gray-200 rounded px-1 font-mono text-[9px]">↑↓</kbd> navigate
              </span>
              <span className="text-[10px] text-gray-400 flex items-center gap-1">
                <kbd className="bg-white border border-gray-200 rounded px-1 font-mono text-[9px]">↵</kbd> open
              </span>
              <span className="text-[10px] text-gray-400 flex items-center gap-1">
                <kbd className="bg-white border border-gray-200 rounded px-1 font-mono text-[9px]">Esc</kbd> close
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
