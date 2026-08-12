"use client";

import { useState } from "react";

type InsightBlock = {
  emoji: string;
  title: string;
  body: string;
};

type InsightType = "critical" | "warning" | "positive" | "action" | "data";

function insightType(emoji: string): InsightType {
  if (emoji === "🔴") return "critical";
  if (emoji === "⚠️") return "warning";
  if (emoji === "✅") return "positive";
  if (emoji === "💡") return "action";
  return "data";
}

const TYPE_STYLES: Record<InsightType, { border: string; bg: string; badge: string; badgeText: string }> = {
  critical: { border: "border-red-200",    bg: "bg-red-50/50",    badge: "bg-red-100 text-red-700",     badgeText: "Critical"     },
  warning:  { border: "border-amber-200",  bg: "bg-amber-50/50",  badge: "bg-amber-100 text-amber-700", badgeText: "Warning"      },
  positive: { border: "border-emerald-200",bg: "bg-emerald-50/30",badge: "bg-emerald-100 text-emerald-700", badgeText: "On track" },
  action:   { border: "border-indigo-200", bg: "bg-indigo-50/30", badge: "bg-indigo-100 text-indigo-700",badgeText: "Action"       },
  data:     { border: "border-gray-200",   bg: "bg-gray-50/50",   badge: "bg-gray-100 text-gray-600",   badgeText: "Insight"      },
};

const INSIGHT_EMOJIS = ["🔴", "⚠️", "✅", "💡", "📊"];

function parseInsights(raw: string): InsightBlock[] {
  const blocks: InsightBlock[] = [];
  // Split on lines that start with a known emoji
  const lines = raw.split("\n");
  let current: { emoji: string; title: string; bodyLines: string[] } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const matchedEmoji = INSIGHT_EMOJIS.find(e => trimmed.startsWith(e));

    if (matchedEmoji) {
      if (current) {
        blocks.push({ emoji: current.emoji, title: current.title, body: current.bodyLines.join(" ").trim() });
      }
      // Title is the rest of the line after the emoji, strip markdown bold markers
      const title = trimmed.slice(matchedEmoji.length).trim().replace(/\*\*/g, "");
      current = { emoji: matchedEmoji, title, bodyLines: [] };
    } else if (current && trimmed) {
      current.bodyLines.push(trimmed);
    }
  }

  if (current) {
    blocks.push({ emoji: current.emoji, title: current.title, body: current.bodyLines.join(" ").trim() });
  }

  return blocks;
}

export default function ProjectInsightsPanel({ projectId }: { projectId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "streaming" | "done" | "error">("idle");
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");

  async function analyze() {
    setState("loading");
    setRaw("");
    setError("");

    try {
      const res = await fetch(`/api/projects/${projectId}/analyze`, { method: "POST" });
      if (!res.ok || !res.body) {
        setError("Analysis failed — please try again.");
        setState("error");
        return;
      }

      setState("streaming");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setRaw(accumulated);
      }

      setState("done");
    } catch {
      setError("Network error — please try again.");
      setState("error");
    }
  }

  const insights = (state === "streaming" || state === "done") ? parseInsights(raw) : [];

  return (
    <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-border">
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
          {state === "done" && (
            <span className="text-[10px] text-gray-400">Analysis complete</span>
          )}
          <button
            onClick={analyze}
            disabled={state === "loading" || state === "streaming"}
            className="flex items-center gap-1.5 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-colors"
          >
            {state === "loading" || state === "streaming" ? (
              <>
                <div className="w-3 h-3 rounded-full border border-violet-300 border-t-white animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1l1.5 4.5H14l-3.5 2.5 1.5 4.5L8 10l-4 2.5L5.5 8 2 5.5h4.5L8 1z" fill="currentColor" />
                </svg>
                {state === "done" ? "Re-analyze" : "Analyze project"}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      {state === "idle" && (
        <div className="px-5 py-10 flex flex-col items-center gap-3 text-center">
          <div className="w-10 h-10 rounded-full bg-violet-50 border border-violet-100 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M8 1l1.5 4.5H14l-3.5 2.5 1.5 4.5L8 10l-4 2.5L5.5 8 2 5.5h4.5L8 1z" fill="#7c3aed" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">Get AI-powered project insights</p>
            <p className="text-xs text-gray-400 mt-1 max-w-xs">
              Claude analyzes your financial data, milestone progress, team utilization, and billing to give you actionable recommendations.
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

      {(state === "loading") && (
        <div className="px-5 py-8 flex flex-col items-center gap-3">
          <div className="flex gap-1.5">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-violet-300 animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
          <p className="text-xs text-gray-400">Reading your project data…</p>
        </div>
      )}

      {(state === "streaming" || state === "done") && (
        <div className="divide-y divide-surface-border">
          {insights.map((insight, i) => {
            const type = insightType(insight.emoji);
            const styles = TYPE_STYLES[type];
            return (
              <div key={i} className={`flex gap-3 px-5 py-4 ${styles.bg}`}>
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
            );
          })}

          {/* Streaming cursor */}
          {state === "streaming" && insights.length === 0 && (
            <div className="px-5 py-4 flex items-center gap-2">
              <div className="w-2 h-4 bg-violet-400 rounded-sm animate-pulse" />
              <span className="text-xs text-gray-400">Reading…</span>
            </div>
          )}
        </div>
      )}

      {state === "error" && (
        <div className="px-5 py-6 text-center">
          <p className="text-xs text-red-600">{error}</p>
          <button onClick={analyze} className="mt-2 text-xs text-indigo-600 hover:underline">
            Try again
          </button>
        </div>
      )}

      {state === "done" && (
        <div className="px-5 py-2.5 border-t border-surface-border bg-gray-50 flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <circle cx="5" cy="5" r="4" stroke="#9ca3af" strokeWidth="1" />
            <path d="M5 3v2.5L6.5 7" stroke="#9ca3af" strokeWidth="1" strokeLinecap="round" />
          </svg>
          <p className="text-[10px] text-gray-400">Based on data as of {new Date().toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })} · Re-analyze after making changes</p>
        </div>
      )}
    </div>
  );
}
