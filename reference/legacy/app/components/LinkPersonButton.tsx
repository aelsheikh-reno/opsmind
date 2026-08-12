"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { smartSimilarity } from "@/lib/name-match";

interface PersonOption {
  id: string;
  name: string;
  jobTitle: string | null;
}

export default function LinkPersonButton({
  employeeName,
  personId,
  personName,
  people,
  linkedPersonIds = [],
  hidden,
}: {
  employeeName: string;
  personId: string | null;
  personName: string | null;
  people: PersonOption[];
  linkedPersonIds?: string[];
  hidden?: boolean;
}) {
  if (hidden) return null;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentPersonId, setCurrentPersonId] = useState(personId);
  const [currentPersonName, setCurrentPersonName] = useState(personName);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    setCurrentPersonId(personId);
    setCurrentPersonName(personName);
  }, [personId, personName]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const isLinkedElsewhere = (pid: string) =>
    linkedPersonIds.includes(pid) && pid !== currentPersonId;

  const ranked = people
    .map(p => ({ ...p, score: smartSimilarity(employeeName, p.name) }))
    .sort((a, b) => b.score - a.score);

  const filtered = (search.trim()
    ? ranked.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.jobTitle ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : ranked
  ).sort((a, b) => {
    const aLinked = isLinkedElsewhere(a.id);
    const bLinked = isLinkedElsewhere(b.id);
    if (aLinked === bLinked) return 0;
    return aLinked ? 1 : -1;
  });

  async function applyLink(pid: string | null, pname: string | null) {
    setLoading(true);
    setOpen(false);
    setSearch("");
    const res = await fetch("/api/payroll/link", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeName, personId: pid }),
    });
    if (res.ok) {
      setCurrentPersonId(pid);
      setCurrentPersonName(pname);
      router.refresh();
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <span className="text-xs text-gray-400 flex items-center gap-1">
        <svg width="10" height="10" viewBox="0 0 10 10" className="animate-spin" fill="none">
          <circle cx="5" cy="5" r="3.5" stroke="#9ca3af" strokeWidth="1.2" strokeDasharray="5 5" />
        </svg>
        Linking…
      </span>
    );
  }

  if (currentPersonId && currentPersonName) {
    if (confirmUnlink) {
      return (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-gray-500">Remove link?</span>
          <button onClick={() => applyLink(null, null)} className="font-medium text-red-600 hover:text-red-800">Yes</button>
          <button onClick={() => setConfirmUnlink(false)} className="text-gray-400 hover:text-gray-600">Cancel</button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <Link
          href={`/people/${currentPersonId}`}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 truncate max-w-32"
          title={currentPersonName}
        >
          {currentPersonName}
        </Link>
        <button
          onClick={() => setConfirmUnlink(true)}
          title="Unlink person"
          className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => { setOpen(o => !o); setSearch(""); }}
        className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-indigo-600 transition-colors"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 10c0-2-1.8-3-4-3s-4 1-4 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
          <path d="M10 4v4M8 6h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        Link
      </button>

      {open && (
        <div className="absolute left-0 top-6 z-50 w-64 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search people…"
              className="w-full text-xs text-gray-700 placeholder-gray-300 outline-none bg-transparent"
            />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-xs text-gray-400 text-center">No people found</p>
            ) : (
              filtered.map(p => {
                const linked = isLinkedElsewhere(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => !linked && applyLink(p.id, p.name)}
                    disabled={linked}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 transition-colors text-left ${
                      linked ? "opacity-50 cursor-not-allowed bg-gray-50/80" : "hover:bg-indigo-50"
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${linked ? "bg-gray-100" : "bg-indigo-100"}`}>
                      <span className={`text-[9px] font-bold ${linked ? "text-gray-400" : "text-indigo-500"}`}>
                        {p.name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs font-medium truncate ${linked ? "text-gray-400" : "text-gray-900"}`}>{p.name}</p>
                      {p.jobTitle && <p className="text-[10px] text-gray-400 truncate">{p.jobTitle}</p>}
                    </div>
                    {linked ? (
                      <span className="shrink-0 text-[9px] font-semibold text-gray-400 bg-gray-100 px-1 py-0.5 rounded">
                        Linked
                      </span>
                    ) : p.score >= 0.6 ? (
                      <span className="shrink-0 text-[9px] font-semibold text-indigo-500 bg-indigo-50 px-1 py-0.5 rounded">
                        {Math.round(p.score * 100)}%
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
