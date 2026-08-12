"use client";

import { useState, useEffect } from "react";

type ActionTag =
  | { type: "edit_project" }
  | { type: "create_invoice"; amount?: number }
  | { type: "view_milestones" }
  | { type: "view_team" }
  | { type: "view_invoices" };

type InsightBlock = {
  emoji: string;
  title: string;
  body: string;
  action?: ActionTag;
};

type InsightType = "critical" | "warning" | "positive" | "action" | "data";

function insightType(emoji: string): InsightType {
  if (emoji === "🔴") return "critical";
  if (emoji === "⚠️") return "warning";
  if (emoji === "✅") return "positive";
  if (emoji === "💡") return "action";
  return "data";
}

const TYPE_STYLES: Record<InsightType, { bg: string; badge: string; badgeText: string }> = {
  critical: { bg: "bg-red-50/50",     badge: "bg-red-100 text-red-700",          badgeText: "Critical"  },
  warning:  { bg: "bg-amber-50/50",   badge: "bg-amber-100 text-amber-700",       badgeText: "Warning"   },
  positive: { bg: "bg-emerald-50/30", badge: "bg-emerald-100 text-emerald-700",   badgeText: "On track"  },
  action:   { bg: "bg-indigo-50/30",  badge: "bg-indigo-100 text-indigo-700",     badgeText: "Action"    },
  data:     { bg: "bg-gray-50/50",    badge: "bg-gray-100 text-gray-600",         badgeText: "Insight"   },
};

const ACTION_BTN: Record<string, { label: (a?: number, c?: string) => string; section?: string }> = {
  edit_project:   { label: () => "Edit project details" },
  create_invoice: { label: (a, c) => a && c ? `Create invoice · ${c} ${a.toLocaleString("en-US")}` : "Create invoice" },
  view_milestones:{ label: () => "View milestones", section: "section-milestones" },
  view_team:      { label: () => "Review team",     section: "section-team"       },
  view_invoices:  { label: () => "View invoices",   section: "section-invoices"   },
};

const INSIGHT_EMOJIS = ["🔴", "⚠️", "✅", "💡", "📊"];
const ACTION_RE = /\[ACTION:([^\]]+)\]/;

function parseAction(tag: string): ActionTag | undefined {
  const parts = tag.split(":");
  const type = parts[0];
  if (type === "edit_project")    return { type: "edit_project" };
  if (type === "create_invoice")  return { type: "create_invoice", amount: parts[1] ? parseFloat(parts[1]) : undefined };
  if (type === "view_milestones") return { type: "view_milestones" };
  if (type === "view_team")       return { type: "view_team" };
  if (type === "view_invoices")   return { type: "view_invoices" };
  return undefined;
}

function parseInsights(raw: string): InsightBlock[] {
  const blocks: InsightBlock[] = [];
  const lines = raw.split("\n");
  let current: { emoji: string; title: string; bodyLines: string[]; action?: ActionTag } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const matchedEmoji = INSIGHT_EMOJIS.find(e => trimmed.startsWith(e));

    if (matchedEmoji) {
      if (current) {
        blocks.push({ emoji: current.emoji, title: current.title, body: current.bodyLines.join(" ").trim(), action: current.action });
      }
      const title = trimmed.slice(matchedEmoji.length).trim().replace(/\*\*/g, "");
      current = { emoji: matchedEmoji, title, bodyLines: [] };
    } else if (current) {
      const actionMatch = trimmed.match(ACTION_RE);
      if (actionMatch) {
        current.action = parseAction(actionMatch[1]);
      } else if (trimmed) {
        current.bodyLines.push(trimmed);
      }
    }
  }

  if (current) {
    blocks.push({ emoji: current.emoji, title: current.title, body: current.bodyLines.join(" ").trim(), action: current.action });
  }

  return blocks;
}

export default function ProjectInsightsDrawer({
  projectId,
  currency,
  onClose,
  onOpenEditModal,
  onIssueInvoice,
  onViewSection,
}: {
  projectId: string;
  currency: string;
  onClose: () => void;
  onOpenEditModal?: () => void;
  onIssueInvoice?: (amount?: number) => void;
  onViewSection?: (id: string) => void;
}) {
  const [state, setState] = useState<"loading" | "idle" | "streaming" | "done" | "error">("loading");
  const [raw, setRaw] = useState("");
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saveWarning, setSaveWarning] = useState("");

  // Load cached insight on open
  useEffect(() => {
    fetch(`/api/projects/${projectId}/analyze`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { text: string | null; analyzedAt: string | null } | null) => {
        if (data?.text) {
          setRaw(data.text);
          setAnalyzedAt(data.analyzedAt);
          setState("done");
        } else {
          setState("idle");
        }
      })
      .catch(() => setState("idle"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function analyze() {
    setState("streaming");
    setRaw("");
    setError("");
    setSaveWarning("");
    setAnalyzedAt(null);

    try {
      const res = await fetch(`/api/projects/${projectId}/analyze`, { method: "POST" });
      if (!res.ok || !res.body) {
        setError("Analysis failed — please try again.");
        setState("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setRaw(accumulated);
      }
      accumulated += decoder.decode();

      // Save to DB
      const saveRes = await fetch(`/api/projects/${projectId}/analyze`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: accumulated }),
      });

      if (!saveRes.ok) {
        const body = await saveRes.text().catch(() => "");
        console.error("Failed to save insight:", saveRes.status, body);
        setSaveWarning("Analysis ran but could not be saved. Restart the dev server if this persists.");
      }

      setAnalyzedAt(new Date().toISOString());
      setState("done");
    } catch (err) {
      console.error("Analyze error:", err);
      setError("Network error — please try again.");
      setState("error");
    }
  }

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleAction(action: ActionTag) {
    const meta = ACTION_BTN[action.type];
    if (action.type === "edit_project")   { onOpenEditModal?.(); return; }
    if (action.type === "create_invoice") { onIssueInvoice?.((action as { type: "create_invoice"; amount?: number }).amount); return; }
    if (meta?.section) { onViewSection?.(meta.section); return; }
  }

  const insights = (state === "streaming" || state === "done") ? parseInsights(raw) : [];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-[440px] max-w-full bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-violet-50 flex items-center justify-center shrink-0">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M8 1l1.5 4.5H14l-3.5 2.5 1.5 4.5L8 10l-4 2.5L5.5 8 2 5.5h4.5L8 1z" fill="#7c3aed" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-gray-900">AI Project Insights</span>
            <span className="text-[10px] font-semibold text-violet-600 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-full">Beta</span>
          </div>
          <div className="flex items-center gap-2">
            {state === "streaming" && (
              <div className="flex items-center gap-1.5 text-xs text-violet-500">
                <div className="w-3 h-3 rounded-full border border-violet-300 border-t-violet-600 animate-spin" />
                Analyzing…
              </div>
            )}
            {state === "done" && (
              <button
                onClick={analyze}
                className="flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-800 hover:bg-violet-50 px-2.5 py-1.5 rounded-lg transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1l1.5 4.5H14l-3.5 2.5 1.5 4.5L8 10l-4 2.5L5.5 8 2 5.5h4.5L8 1z" fill="currentColor" />
                </svg>
                Re-analyze
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Close"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {state === "loading" && (
            <div className="flex flex-col items-center gap-3 justify-center h-48 px-5">
              <div className="flex gap-1.5">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-2 h-2 rounded-full bg-violet-300 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <p className="text-xs text-gray-400">Loading…</p>
            </div>
          )}

          {state === "idle" && (
            <div className="flex flex-col items-center gap-3 justify-center h-64 px-5 text-center">
              <div className="w-10 h-10 rounded-full bg-violet-50 border border-violet-100 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1l1.5 4.5H14l-3.5 2.5 1.5 4.5L8 10l-4 2.5L5.5 8 2 5.5h4.5L8 1z" fill="#7c3aed" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">No analysis yet</p>
                <p className="text-xs text-gray-400 mt-1 max-w-xs">
                  Claude will analyze your financial data, milestone progress, team utilization, and billing.
                </p>
              </div>
              <button
                onClick={analyze}
                className="mt-1 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 px-4 py-2 rounded-lg transition-colors"
              >
                Analyze project
              </button>
            </div>
          )}

          {state === "streaming" && insights.length === 0 && (
            <div className="flex flex-col items-center gap-3 justify-center h-48 px-5">
              <div className="flex gap-1.5">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-2 h-2 rounded-full bg-violet-300 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <p className="text-xs text-gray-400">Analyzing your project…</p>
            </div>
          )}

          {(state === "streaming" || state === "done") && insights.length > 0 && (
            <div className="divide-y divide-gray-100">
              {insights.map((insight, i) => {
                const type = insightType(insight.emoji);
                const styles = TYPE_STYLES[type];
                const actionMeta = insight.action ? ACTION_BTN[insight.action.type] : null;
                const inv = insight.action?.type === "create_invoice" ? (insight.action as { type: "create_invoice"; amount?: number }) : null;
                return (
                  <div key={i} className={`px-5 py-4 ${styles.bg}`}>
                    <div className="flex gap-3">
                      <div className="text-xl shrink-0 leading-none mt-0.5">{insight.emoji}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900">{insight.title}</p>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${styles.badge}`}>
                            {styles.badgeText}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">{insight.body}</p>
                      </div>
                    </div>
                    {insight.action && actionMeta && (
                      <div className="mt-3 pl-8">
                        <button
                          onClick={() => handleAction(insight.action!)}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 bg-white border border-indigo-200 hover:bg-indigo-50 hover:border-indigo-300 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          <ActionIcon type={insight.action.type} />
                          {actionMeta.label(inv?.amount, inv?.amount ? currency : undefined)}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {state === "streaming" && (
                <div className="px-5 py-3 flex items-center gap-2">
                  <div className="w-1.5 h-3.5 bg-violet-400 rounded-sm animate-pulse" />
                </div>
              )}
            </div>
          )}

          {state === "error" && (
            <div className="px-5 py-10 flex flex-col items-center gap-3 text-center">
              <div className="w-10 h-10 rounded-full bg-red-50 border border-red-100 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="#ef4444" strokeWidth="1.2" />
                  <path d="M8 5v4M8 11v.5" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-sm text-red-600 font-medium">{error}</p>
              <button onClick={analyze} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline">
                Try again
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {state === "done" && (
          <div className="shrink-0 border-t border-gray-100">
            {saveWarning && (
              <div className="px-5 py-2 bg-amber-50 flex items-center gap-1.5">
                <span className="text-amber-500 text-xs">⚠️</span>
                <p className="text-[10px] text-amber-700">{saveWarning}</p>
              </div>
            )}
            <div className="px-5 py-2.5 bg-gray-50 flex items-center gap-1.5">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <circle cx="5" cy="5" r="4" stroke="#9ca3af" strokeWidth="1" />
                <path d="M5 3v2.5L6.5 7" stroke="#9ca3af" strokeWidth="1" strokeLinecap="round" />
              </svg>
              <p className="text-[10px] text-gray-400">
                {analyzedAt
                  ? `Analyzed ${new Date(analyzedAt).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })} · Re-analyze after making changes`
                  : "Based on current project data · Re-analyze after making changes"}
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function ActionIcon({ type }: { type: string }) {
  if (type === "edit_project") return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
      <path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (type === "create_invoice") return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="1.5" width="10" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.5 5h5M4.5 7.5h5M4.5 10h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
  if (type === "view_milestones") return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
      <path d="M2 7h10M2 7l4-4M2 7l4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
