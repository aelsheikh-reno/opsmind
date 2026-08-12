"use client";

import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";

type Log = {
  id: string;
  action: string;
  details: string | null;
  userName: string | null;
  createdAt: string;
};

const ACTION_META: Record<string, { label: string; color: string; icon: string }> = {
  "project.created":        { label: "Project created",   color: "bg-green-100 text-green-700",  icon: "+" },
  "project.updated":        { label: "Details updated",   color: "bg-sky-100 text-sky-700",      icon: "✎" },
  "project.status_updated": { label: "Status updated",    color: "bg-amber-100 text-amber-700",  icon: "●" },
  "project.deleted":        { label: "Project deleted",   color: "bg-red-100 text-red-600",      icon: "×" },
  "milestone.date_changed": { label: "Milestone rescheduled", color: "bg-violet-100 text-violet-700", icon: "⇄" },
  "milestone.completed":    { label: "Milestone completed",   color: "bg-green-100 text-green-700",  icon: "✓" },
  "milestone.reopened":     { label: "Milestone reopened",    color: "bg-orange-100 text-orange-700", icon: "↩" },
};

const FIELD_LABELS: Record<string, string> = {
  name: "Name", description: "Description", contractValue: "Contract value",
  currency: "Currency", startDate: "Start date", endDate: "End date",
  billingType: "Billing type", clientName: "Client", status: "Status",
};

function fmtRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)    return "just now";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AE", { day: "numeric", month: "short" });
}

function getLabel(action: string, details: string | null): string {
  const base = ACTION_META[action]?.label ?? action;
  if (!details) return base;
  try {
    const d = JSON.parse(details);
    if ((action === "project.updated" || action === "project.status_updated") && d.changes) {
      const keys = Object.keys(d.changes as Record<string, unknown>);
      if (keys.length === 0) return base;
      if (action === "project.status_updated") {
        const to = (d.changes as Record<string, { to: unknown }>).status?.to;
        return `Status → ${String(to).replace("_", " ")}`;
      }
      return keys.map(k => FIELD_LABELS[k] ?? k).join(" & ") + " updated";
    }
    if (action === "milestone.date_changed" && d.milestoneName) {
      return `${d.milestoneName} rescheduled`;
    }
    if (action === "milestone.completed" && d.milestoneName) {
      return `${d.milestoneName} completed`;
    }
    if (action === "milestone.reopened" && d.milestoneName) {
      return `${d.milestoneName} reopened`;
    }
  } catch { /* ignore */ }
  return base;
}

function Detail({ action, details }: { action: string; details: string | null }) {
  if (!details) return null;
  try {
    const d = JSON.parse(details);
    if ((action === "project.updated" || action === "project.status_updated") && d.changes) {
      const entries = Object.entries(d.changes as Record<string, { from: unknown; to: unknown }>);
      const fmt = (v: unknown) => v == null ? "—" : String(v);
      return (
        <div className="mt-0.5 space-y-0.5">
          {entries.map(([k, v]) => (
            <p key={k} className="text-[10px] text-gray-400">
              {FIELD_LABELS[k] ?? k}: {fmt(v.from)} → {fmt(v.to)}
            </p>
          ))}
        </div>
      );
    }
    if (action === "milestone.date_changed" && (d.from || d.to)) {
      return (
        <p className="text-[10px] text-gray-400 mt-0.5">
          {fmtDateShort(d.from as string)} → {fmtDateShort(d.to as string)}
        </p>
      );
    }
    if (action === "project.created" && (d.billingType || d.clientName)) {
      const parts: string[] = [];
      if (d.billingType) parts.push(String(d.billingType).replace("_", " & "));
      if (d.clientName) parts.push(`Client: ${d.clientName}`);
      return <p className="text-[10px] text-gray-400 mt-0.5 capitalize">{parts.join(" · ")}</p>;
    }
  } catch { /* ignore */ }
  return null;
}

export type ProjectActivityPanelHandle = { refresh: () => void };

const ProjectActivityPanel = forwardRef<ProjectActivityPanelHandle, { projectId: string }>(
  function ProjectActivityPanel({ projectId }, ref) {
    const [logs, setLogs] = useState<Log[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(() => {
      setLoading(true);
      fetch(`/api/projects/${projectId}/activity`)
        .then(r => r.ok ? r.json() : [])
        .then(setLogs)
        .catch(() => setLogs([]))
        .finally(() => setLoading(false));
    }, [projectId]);

    useEffect(() => { load(); }, [load]);

    useImperativeHandle(ref, () => ({ refresh: load }), [load]);

    if (loading) {
      return (
        <div className="px-4 py-5 space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex gap-3 animate-pulse">
              <div className="w-6 h-6 rounded-full bg-gray-100 shrink-0" />
              <div className="flex-1 space-y-1.5 pt-1">
                <div className="h-2.5 bg-gray-100 rounded w-3/4" />
                <div className="h-2 bg-gray-100 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (logs.length === 0) {
      return <p className="text-xs text-gray-400 text-center py-5 px-4">No activity recorded yet.</p>;
    }

    return (
      <ul className="divide-y divide-gray-100">
        {logs.map((log, i) => {
          const meta = ACTION_META[log.action] ?? { label: log.action, color: "bg-gray-100 text-gray-600", icon: "·" };
          return (
            <li key={log.id} className="flex items-start gap-3 py-3 px-4">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${meta.color}`}>
                {meta.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-gray-800">{getLabel(log.action, log.details)}</p>
                  <time className="text-[10px] text-gray-400 shrink-0 tabular-nums">{fmtRelative(log.createdAt)}</time>
                </div>
                {log.userName && <p className="text-[10px] text-gray-400 mt-0.5">by {log.userName}</p>}
                <Detail action={log.action} details={log.details} />
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
);

export default ProjectActivityPanel;
