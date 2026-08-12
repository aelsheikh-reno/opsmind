"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  hasToken: boolean;
  tokenPreview: string | null;
  userGid: string | null;
  workspaceGid: string | null;
  syncFromSaved: string | null;
};

export default function AsanaSection({ hasToken, tokenPreview, userGid, workspaceGid, syncFromSaved }: Props) {
  const router = useRouter();

  const [accessToken, setAccessToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [userGidVal, setUserGidVal] = useState(userGid ?? "");
  const [workspaceGidVal, setWorkspaceGidVal] = useState(workspaceGid ?? "");

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Pre-fill from saved preference so the user sees what auto-sync will use
  const savedMonthValue = syncFromSaved ? syncFromSaved.slice(0, 7) : "";
  const [syncFrom, setSyncFrom] = useState(savedMonthValue);
  const [syncTo,   setSyncTo]   = useState("");

  const [testResult, setTestResult] = useState<{ ok: boolean; name?: string; email?: string; error?: string } | null>(null);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; synced?: number; extracted?: number; deleted?: number; error?: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaveError(null);
    const body: Record<string, string> = { userGid: userGidVal, workspaceGid: workspaceGidVal };
    if (accessToken.trim()) body.accessToken = accessToken.trim();

    const res = await fetch("/api/settings/asana", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { setSaveError(data.error ?? "Failed to save"); }
    else { setAccessToken(""); router.refresh(); }
    setSaving(false);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/settings/asana/test", { method: "POST" });
    const data = await res.json();
    setTestResult(data);
    setTesting(false);
  }

  async function clearSynced() {
    if (!confirm("Delete all Asana-synced claims? This cannot be undone.")) return;
    setClearing(true);
    setSyncResult(null);
    await fetch("/api/settings/asana/clear", { method: "DELETE" });
    setClearing(false);
    router.refresh();
  }

  async function syncNow() {
    setSyncing(true);
    setSyncResult(null);
    const body: Record<string, string> = {};
    if (syncFrom) body.from = syncFrom + "-01";
    if (syncTo)   body.to   = new Date(new Date(syncTo + "-01").getFullYear(), new Date(syncTo + "-01").getMonth() + 1, 0).toISOString().slice(0, 10);
    const res = await fetch("/api/settings/asana/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setSyncResult(data);
    if (data.ok) router.refresh();
    setSyncing(false);
  }

  const isConfigured = hasToken && !!userGid && !!workspaceGid;

  return (
    <div className="space-y-5">
      {/* Status */}
      <div className="flex items-center gap-2.5 px-4 py-3 bg-surface-inset rounded-xl border border-surface-border">
        <div className={`w-2 h-2 rounded-full shrink-0 ${isConfigured ? "bg-emerald-500" : "bg-amber-400"}`} />
        <span className="text-sm text-gray-700 font-medium">
          {isConfigured ? "Connected" : "Not configured"}
        </span>
        {isConfigured && tokenPreview && (
          <span className="text-xs text-gray-400 ml-1">Token: {tokenPreview}</span>
        )}
        {isConfigured && (
          <button
            onClick={testConnection}
            disabled={testing}
            className="ml-auto text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
        )}
      </div>

      {testResult && (
        <div className={`text-xs px-3 py-2 rounded-lg ${testResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
          {testResult.ok
            ? `Connected as ${testResult.name ?? "Unknown"}${testResult.email ? ` (${testResult.email})` : ""}`
            : `Connection failed: ${testResult.error}`}
        </div>
      )}

      {/* Credentials form */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            Access Token {hasToken && <span className="normal-case font-normal text-gray-400">(leave blank to keep current)</span>}
          </label>
          <div className="flex gap-2">
            <input
              type={showToken ? "text" : "password"}
              value={accessToken}
              onChange={e => setAccessToken(e.target.value)}
              placeholder={hasToken ? tokenPreview ?? "••••••••" : "Enter Asana personal access token"}
              className="flex-1 h-9 px-3 text-sm text-gray-900 bg-white border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowToken(v => !v)}
              className="px-3 h-9 text-xs font-medium text-gray-500 bg-surface-inset border border-surface-border rounded-lg hover:bg-surface-hover transition-colors"
            >
              {showToken ? "Hide" : "Show"}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            Generate a personal access token at{" "}
            <a href="https://app.asana.com/0/developer-console" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:text-indigo-700">
              app.asana.com/0/developer-console
            </a>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">User GID</label>
            <input
              type="text"
              value={userGidVal}
              onChange={e => setUserGidVal(e.target.value)}
              placeholder="e.g. 1234567890123456"
              className="w-full h-9 px-3 text-sm text-gray-900 bg-white border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Workspace GID</label>
            <input
              type="text"
              value={workspaceGidVal}
              onChange={e => setWorkspaceGidVal(e.target.value)}
              placeholder="e.g. 9876543210987654"
              className="w-full h-9 px-3 text-sm text-gray-900 bg-white border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400 font-mono"
            />
            <p className="text-[11px] text-gray-400 mt-1">Find GIDs in your Asana workspace URL</p>
          </div>
        </div>

        {saveError && (
          <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{saveError}</p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || (!accessToken.trim() && !userGidVal.trim() && !workspaceGidVal.trim())}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 rounded-lg transition-colors"
          >
            {saving ? "Saving…" : "Save credentials"}
          </button>
        </div>

        {isConfigured && (
          <div className="space-y-2.5 pt-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sync claims</p>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500 shrink-0">From</label>
                <input
                  type="month"
                  value={syncFrom}
                  onChange={e => setSyncFrom(e.target.value)}
                  className="h-8 px-2 text-sm text-gray-700 bg-white border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500 shrink-0">To</label>
                <input
                  type="month"
                  value={syncTo}
                  onChange={e => setSyncTo(e.target.value)}
                  className="h-8 px-2 text-sm text-gray-700 bg-white border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
                />
              </div>
              <button
                onClick={syncNow}
                disabled={syncing}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-gray-700 bg-surface-inset border border-surface-border hover:bg-surface-hover disabled:opacity-50 rounded-lg transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className={syncing ? "animate-spin" : ""}>
                  <path d="M2 7a5 5 0 0 1 8.5-3.5L12 5M12 2v3H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 7a5 5 0 0 1-8.5 3.5L2 9M2 12V9h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
            <p className="text-[11px] text-gray-400">
              {syncFromSaved
                ? <>Auto-sync starts from <span className="font-medium text-gray-500">{syncFromSaved.slice(0, 7)}</span>. Change the From date and sync to update.</>
                : "Leave blank to sync all claims. Set a From date to restrict auto-sync to that month onwards."}
            </p>
            <button
              onClick={clearSynced}
              disabled={clearing || syncing}
              className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-40 transition-colors"
            >
              {clearing ? "Clearing…" : "Clear all synced data"}
            </button>
          </div>
        )}

        {syncResult && (
          <div className={`text-xs px-3 py-2 rounded-lg ${syncResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
            {syncResult.ok
              ? `Sync complete — ${syncResult.synced} claims synced, ${syncResult.extracted} amounts extracted, ${syncResult.deleted} removed`
              : `Sync failed: ${syncResult.error}`}
          </div>
        )}
      </div>
    </div>
  );
}
