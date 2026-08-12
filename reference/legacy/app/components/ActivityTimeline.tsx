import React from "react";
import { prisma } from "@/lib/prisma";

const ACTION_META: Record<string, { label: string; color: string; icon: string }> = {
  "employee.created":        { label: "Profile created",        color: "bg-green-100 text-green-700",  icon: "+" },
  "employee.deleted":        { label: "Profile deleted",        color: "bg-red-100 text-red-600",      icon: "×" },
  "employee.updated":        { label: "Details updated",        color: "bg-sky-100 text-sky-700",      icon: "✎" },
  "employee.salary_updated": { label: "Salary updated",         color: "bg-indigo-100 text-indigo-700",icon: "$" },
  "employee.rate_updated":   { label: "Labor rate updated",     color: "bg-violet-100 text-violet-700",icon: "%" },
  "employee.merged":         { label: "Profiles merged",        color: "bg-purple-100 text-purple-700",icon: "⊕" },
  "document.uploaded":       { label: "Document uploaded",      color: "bg-blue-100 text-blue-700",    icon: "↑" },
  "document.updated":        { label: "Document updated",       color: "bg-sky-100 text-sky-700",      icon: "✎" },
  "document.parties_updated":{ label: "Parties updated",         color: "bg-sky-100 text-sky-700",      icon: "✎" },
  "document.paid":           { label: "Marked as paid",         color: "bg-teal-100 text-teal-700",    icon: "✓" },
  "document.unpaid":         { label: "Marked as unpaid",       color: "bg-gray-100 text-gray-500",    icon: "○" },
  "document.paid_date_updated": { label: "Paid date updated",   color: "bg-teal-100 text-teal-700",    icon: "✎" },
  "payroll.processed":       { label: "Payroll processed",      color: "bg-green-100 text-green-700",  icon: "✓" },
  "payroll.unprocessed":     { label: "Payroll unmarked",       color: "bg-amber-100 text-amber-700",  icon: "↺" },
  "payroll.paid":            { label: "Marked paid",            color: "bg-teal-100 text-teal-700",    icon: "✓" },
  "payroll.unpaid":          { label: "Marked unpaid",          color: "bg-gray-100 text-gray-500",    icon: "○" },
  "rate.locked":             { label: "Rate locked",            color: "bg-indigo-100 text-indigo-700",icon: "🔒" },
  "rate.unlocked":           { label: "Rate unlocked",          color: "bg-gray-100 text-gray-500",    icon: "🔓" },
  "setting.changed":         { label: "Setting changed",        color: "bg-gray-100 text-gray-600",    icon: "⚙" },
  "contract.generated":     { label: "Contract generated",     color: "bg-violet-100 text-violet-700",icon: "✦" },
  "project.created":        { label: "Project created",        color: "bg-green-100 text-green-700",  icon: "+" },
  "project.updated":        { label: "Details updated",        color: "bg-sky-100 text-sky-700",      icon: "✎" },
  "project.status_updated": { label: "Status updated",         color: "bg-amber-100 text-amber-700",  icon: "●" },
  "project.deleted":        { label: "Project deleted",        color: "bg-red-100 text-red-600",      icon: "×" },
};

const DOC_FIELD_LABELS: Record<string, string> = {
  issueDate: "Issue date",
  expiryDate: "Expiry date",
  renewalDeadline: "Renewal deadline",
  parties: "Parties",
};

const EMPLOYEE_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  jobTitle: "Job title",
  department: "Department",
  nationality: "Nationality",
  contractStart: "Start date",
  contractEnd: "End date",
};

const RATE_FIELD_LABELS: Record<string, string> = {
  costPerHour:  "Cost/hr",
  billingRate:  "Billing rate",
  rateCurrency: "Currency",
};

const PROJECT_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  description: "Description",
  contractValue: "Contract value",
  currency: "Currency",
  startDate: "Start date",
  endDate: "End date",
  billingType: "Billing type",
  clientName: "Client",
  status: "Status",
};

function getLogLabel(action: string, details: string | null): string {
  const defaultLabel = ACTION_META[action]?.label ?? action;
  if (!details) return defaultLabel;
  try {
    const d = JSON.parse(details);
    if (action === "document.uploaded" && d.source === "google-drive") {
      return "Synced from Google Drive";
    }
    if (action === "document.updated" && d.changes) {
      const keys = Object.keys(d.changes as Record<string, unknown>);
      // If expiry + renewal changed together, renewal is auto-derived — show only expiry
      const displayKeys = (keys.includes("expiryDate") && keys.includes("renewalDeadline"))
        ? keys.filter(k => k !== "renewalDeadline")
        : keys;
      if (displayKeys.length === 0) return defaultLabel;
      const names = displayKeys.map(k => DOC_FIELD_LABELS[k] ?? k);
      return names.join(" & ") + " updated";
    }
    if (action === "employee.updated" && d.changes) {
      const keys = Object.keys(d.changes as Record<string, unknown>);
      if (keys.length === 0) return defaultLabel;
      const names = keys.map(k => EMPLOYEE_FIELD_LABELS[k] ?? k);
      return names.join(" & ") + " updated";
    }
    if (action === "project.updated" && d.changes) {
      const keys = Object.keys(d.changes as Record<string, unknown>);
      if (keys.length === 0) return defaultLabel;
      const names = keys.map(k => PROJECT_FIELD_LABELS[k] ?? k);
      return names.join(" & ") + " updated";
    }
    if (action === "project.status_updated" && d.changes?.status) {
      const s = (d.changes as Record<string, { to: unknown }>).status;
      return `Status → ${String(s.to).replace("_", " ")}`;
    }
  } catch { /* ignore */ }
  return defaultLabel;
}

function fmtRelative(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)  return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function DetailLine({ details, action }: { details: string | null; action: string }) {
  if (!details) return null;
  try {
    const d = JSON.parse(details);
    if (action === "employee.salary_updated" && d.from != null && d.to != null) {
      return (
        <p className="text-[10px] text-gray-400 mt-0.5">
          {d.fromCurrency} {Number(d.from).toLocaleString()} → {d.toCurrency} {Number(d.to).toLocaleString()}
        </p>
      );
    }
    if (action === "document.paid" && d.paidAt) {
      return <p className="text-[10px] text-gray-400 mt-0.5">Paid on {String(d.paidAt)}</p>;
    }
    if ((action === "document.paid" || action === "document.unpaid") && d.dueDate) {
      return <p className="text-[10px] text-gray-400 mt-0.5">Payment due {String(d.dueDate)}</p>;
    }
    if (action === "document.paid_date_updated") {
      const fmt = (v: unknown) => v == null ? "—" : String(v);
      return <p className="text-[10px] text-gray-400 mt-0.5">{fmt(d.from)} → {fmt(d.to)}</p>;
    }
    if ((action === "document.updated" || action === "document.parties_updated") && d.changes) {
      const fieldLabels: Record<string, string> = { issueDate: "Issue date", expiryDate: "Expiry date", renewalDeadline: "Renewal deadline" };
      const changes = d.changes as Record<string, unknown>;
      const nodes: React.ReactNode[] = [];

      // Parties — new format: { added, removed }; old format: { from, to }
      if (changes.parties) {
        const p = changes.parties as { added?: string[]; removed?: string[]; from?: string; to?: string };
        if (Array.isArray(p.added) || Array.isArray(p.removed)) {
          nodes.push(
            <p key="parties-label" className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mt-0.5">Parties</p>
          );
          (p.added ?? []).forEach(name =>
            nodes.push(<p key={`a-${name}`} className="text-[10px] text-green-600 font-medium">+ {name}</p>)
          );
          (p.removed ?? []).forEach(name =>
            nodes.push(<p key={`r-${name}`} className="text-[10px] text-red-500 font-medium">− {name}</p>)
          );
        } else {
          const fmt = (v: unknown) => v == null ? "—" : String(v);
          nodes.push(<p key="parties" className="text-[10px] text-gray-400">Parties: {fmt(p.from)} → {fmt(p.to)}</p>);
        }
      }

      // Other date fields
      for (const [k, v] of Object.entries(changes)) {
        if (k === "parties") continue;
        const label = fieldLabels[k] ?? k;
        const val = v as { from: unknown; to: unknown };
        const fmt = (x: unknown) => x == null ? "—" : String(x);
        nodes.push(<p key={k} className="text-[10px] text-gray-400">{label}: {fmt(val.from)} → {fmt(val.to)}</p>);
      }

      return nodes.length > 0 ? <div className="mt-0.5 space-y-0.5">{nodes}</div> : null;
    }
    if (action === "employee.updated" && d.changes) {
      const labels: Record<string, string> = { name: "Name", jobTitle: "Title", department: "Dept", nationality: "Nationality", contractStart: "Start date", contractEnd: "End date" };
      const entries = Object.entries(d.changes as Record<string, { from: unknown; to: unknown }>);
      const fmt = (v: unknown) => v == null ? "—" : String(v);
      return (
        <div className="mt-0.5 space-y-0.5">
          {entries.map(([k, v]) => (
            <p key={k} className="text-[10px] text-gray-400">
              {labels[k] ?? k}: {fmt(v.from)} → {fmt(v.to)}
            </p>
          ))}
        </div>
      );
    }
    if (action === "employee.rate_updated" && d.changes) {
      const entries = Object.entries(d.changes as Record<string, { from: unknown; to: unknown }>);
      const fmt = (v: unknown) => v == null ? "—" : String(v);
      return (
        <div className="mt-0.5 space-y-0.5">
          {entries.map(([k, v]) => (
            <p key={k} className="text-[10px] text-gray-400">
              {RATE_FIELD_LABELS[k] ?? k}: {fmt(v.from)} → {fmt(v.to)}
            </p>
          ))}
        </div>
      );
    }
    if ((action === "project.updated" || action === "project.status_updated") && d.changes) {
      const entries = Object.entries(d.changes as Record<string, { from: unknown; to: unknown }>);
      const fmt = (v: unknown) => v == null ? "—" : String(v);
      return (
        <div className="mt-0.5 space-y-0.5">
          {entries.map(([k, v]) => (
            <p key={k} className="text-[10px] text-gray-400">
              {PROJECT_FIELD_LABELS[k] ?? k}: {fmt(v.from)} → {fmt(v.to)}
            </p>
          ))}
        </div>
      );
    }
    if (action === "project.created" && (d.billingType || d.clientName)) {
      const parts: string[] = [];
      if (d.billingType) parts.push((d.billingType as string).replace("_", " & "));
      if (d.clientName) parts.push(`Client: ${d.clientName}`);
      return <p className="text-[10px] text-gray-400 mt-0.5 capitalize">{parts.join(" · ")}</p>;
    }
    if (action === "employee.merged" && d.mergedFrom) {
      return <p className="text-[10px] text-gray-400 mt-0.5">Merged from {d.mergedFrom}</p>;
    }
    if (action === "employee.merged" && d.linkedPayrollName) {
      return <p className="text-[10px] text-gray-400 mt-0.5">Linked payroll entries for {d.linkedPayrollName}</p>;
    }
    if ((action === "payroll.processed" || action === "payroll.unprocessed" || action === "payroll.paid" || action === "payroll.unpaid") && d.period) {
      return <p className="text-[10px] text-gray-400 mt-0.5">{d.period}</p>;
    }
    if (action === "document.uploaded") {
      const parts: string[] = [];
      if (d.docType) parts.push((d.docType as string).replace(/_/g, " "));
      if (d.source === "google-drive") parts.push("via Google Drive");
      if (parts.length === 0) return null;
      return <p className="text-[10px] text-gray-400 mt-0.5 capitalize">{parts.join(" · ")}</p>;
    }
    if (action === "contract.generated" && (d.templateName || d.personName)) {
      return (
        <p className="text-[10px] text-gray-400 mt-0.5">
          {d.templateName ? `Template: ${d.templateName}` : ""}
          {d.templateName && d.personName ? " · " : ""}
          {d.personName ? `For: ${d.personName}` : ""}
        </p>
      );
    }
  } catch { /* ignore */ }
  return null;
}

export default async function ActivityTimeline({
  entityId,
  limit = 20,
}: {
  entityId: string;
  limit?: number;
}) {
  const logs = await prisma.auditLog.findMany({
    where: { entityId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  if (logs.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-xs text-gray-400">No activity recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="flow-root">
      <ul className="divide-y divide-surface-border">
        {logs.map((log, i) => {
          const meta = ACTION_META[log.action] ?? { label: log.action, color: "bg-gray-100 text-gray-600", icon: "·" };
          const isLast = i === logs.length - 1;
          return (
            <li key={log.id} className="flex items-start gap-3 py-3 px-4">
              {/* Timeline dot */}
              <div className="flex flex-col items-center shrink-0 mt-0.5">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${meta.color}`}>
                  {meta.icon}
                </span>
                {!isLast && <div className="w-px flex-1 bg-surface-border mt-1 min-h-[12px]" />}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pb-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-gray-800">{getLogLabel(log.action, log.details)}</p>
                  <time className="text-[10px] text-gray-400 shrink-0 tabular-nums">
                    {fmtRelative(new Date(log.createdAt))}
                  </time>
                </div>
                {log.userName && (
                  <p className="text-[10px] text-gray-400 mt-0.5">by {log.userName}</p>
                )}
                <DetailLine details={log.details} action={log.action} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
