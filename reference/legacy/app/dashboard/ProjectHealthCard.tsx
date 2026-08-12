"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ProjectHealthEntry } from "@/app/api/projects/health/route";

export default function ProjectHealthCard() {
  const [projects, setProjects] = useState<ProjectHealthEntry[] | null>(null);
  const [loading, setLoading]   = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/projects/health");
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects ?? []);
      }
    } catch {
      // silently ignore fetch errors — card just shows stale data
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, 90_000);

    function onVisibility() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const atRisk    = projects?.filter(p => p.health === "at_risk")    ?? [];
  const profitable = projects?.filter(p => p.health === "profitable") ?? [];
  const total = atRisk.length + profitable.length;

  // Nothing to show
  if (!loading && total === 0) return null;

  const headerBorder = atRisk.length > 0 ? "border-red-100" : "border-surface-border";
  const iconBg       = atRisk.length > 0 ? "bg-red-50"      : "bg-emerald-50";

  return (
    <div className={`bg-white border rounded-xl overflow-hidden ${headerBorder}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-5 py-3.5 border-b ${headerBorder}`}>
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-md ${iconBg} flex items-center justify-center shrink-0`}>
            {atRisk.length > 0 ? (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 2L1.5 13h13L8 2z" stroke="#dc2626" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
                <path d="M8 6v3.5" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="8" cy="11.5" r="0.7" fill="#dc2626" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M3 8l4 4 6-7" stroke="#059669" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Project health</span>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <div className="w-3 h-3 rounded-full border border-gray-200 border-t-gray-400 animate-spin" />
          )}
          {atRisk.length > 0 && (
            <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full border border-red-100">
              {atRisk.length} at risk
            </span>
          )}
          {profitable.length > 0 && (
            <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-100">
              {profitable.length} profitable
            </span>
          )}
          <Link href="/projects" className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
            All projects
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && projects === null && (
        <div className="divide-y divide-surface-border">
          {[1, 2].map(i => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5">
              <div className="w-2 h-2 rounded-full bg-gray-100 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 bg-gray-100 rounded animate-pulse" />
                <div className="h-2 w-20 bg-gray-100 rounded animate-pulse" />
              </div>
              <div className="h-4 w-20 bg-gray-100 rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {/* At risk section */}
      {atRisk.length > 0 && (
        <div>
          {profitable.length > 0 && (
            <div className="px-5 py-1.5 bg-red-50/40 border-b border-red-100">
              <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wide">At risk</p>
            </div>
          )}
          <div className="divide-y divide-surface-border">
            {atRisk.map(p => (
              <Link key={p.id} href={`/projects/${p.id}`} className="flex items-start gap-3 px-5 py-3.5 hover:bg-surface-hover/50 transition-colors">
                <div className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: p.color ?? "#6366f1" }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                  {p.clientName && <p className="text-[10px] text-gray-400 truncate">{p.clientName}</p>}
                </div>
                <div className="flex flex-wrap justify-end gap-1 shrink-0 max-w-[200px]">
                  {p.tags.map(tag => (
                    <span key={tag} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                      tag === "Past end date" ? "text-red-600 bg-red-50 border-red-100" :
                      tag === "Over budget"   ? "text-orange-600 bg-orange-50 border-orange-100" :
                      "text-amber-600 bg-amber-50 border-amber-100"
                    }`}>{tag}</span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Profitable section */}
      {profitable.length > 0 && (
        <div>
          {atRisk.length > 0 && (
            <div className="px-5 py-1.5 bg-emerald-50/40 border-t border-b border-emerald-100">
              <p className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wide">Profitable</p>
            </div>
          )}
          <div className="divide-y divide-surface-border">
            {profitable.map(p => (
              <Link key={p.id} href={`/projects/${p.id}`} className="flex items-start gap-3 px-5 py-3.5 hover:bg-surface-hover/50 transition-colors">
                <div className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: p.color ?? "#10b981" }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                  {p.clientName && <p className="text-[10px] text-gray-400 truncate">{p.clientName}</p>}
                </div>
                <div className="flex flex-wrap justify-end gap-1 shrink-0">
                  {p.tags.map(tag => (
                    <span key={tag} className="text-[10px] font-semibold px-2 py-0.5 rounded-full border text-emerald-600 bg-emerald-50 border-emerald-100">
                      {tag}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
