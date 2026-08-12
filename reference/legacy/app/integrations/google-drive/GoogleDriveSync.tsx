"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { syncGoogleDrive, resetSyncHistory, type SyncFileResult } from "./actions";

type DriveFolder = { id: string; name: string };

function FolderBrowser({ onSelect }: { onSelect: (id: string, name: string) => void }) {
  const [stack, setStack] = useState<{ id: string; name: string }[]>([{ id: "root", name: "My Drive" }]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const current = stack[stack.length - 1];

  const load = useCallback(async (parentId: string) => {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/integrations/google-drive/folders?parentId=${parentId}`);
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error ?? "Failed to load folders"); return; }
    setFolders(data.folders);
  }, []);

  useEffect(() => { load(current.id); }, [current.id, load]);

  function navigateInto(folder: DriveFolder) {
    setStack(s => [...s, folder]);
  }

  function navigateTo(index: number) {
    setStack(s => s.slice(0, index + 1));
  }

  return (
    <div className="rounded-xl border border-surface-border bg-white overflow-hidden">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-3 py-2.5 border-b border-surface-border bg-surface-inset flex-wrap">
        {stack.map((crumb, i) => (
          <span key={crumb.id} className="flex items-center gap-1">
            {i > 0 && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M2 1l3 3-3 3" stroke="#9ca3af" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            <button
              onClick={() => navigateTo(i)}
              className={`text-xs font-medium transition-colors ${i === stack.length - 1 ? "text-gray-900" : "text-indigo-500 hover:text-indigo-700"}`}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>

      {/* Folder list */}
      <div className="max-h-52 overflow-y-auto divide-y divide-surface-border">
        {loading && (
          <div className="flex items-center gap-2 px-4 py-3 text-xs text-gray-400">
            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg>
            Loading…
          </div>
        )}
        {!loading && error && <p className="px-4 py-3 text-xs text-red-600">{error}</p>}
        {!loading && !error && folders.length === 0 && (
          <p className="px-4 py-3 text-xs text-gray-400">No subfolders — select the current folder below.</p>
        )}
        {!loading && folders.map(f => (
          <div key={f.id} className="flex items-center gap-2.5 px-4 py-2 hover:bg-surface-inset group">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="shrink-0">
              <path d="M1 3a1 1 0 011-1h4l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H2a1 1 0 01-1-1V3z" fill="#f59e0b" opacity="0.85"/>
            </svg>
            <span className="text-sm text-gray-700 flex-1 truncate">{f.name}</span>
            <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => onSelect(f.id, f.name)}
                className="text-[11px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-2 py-1 rounded-lg transition-colors"
              >
                Select
              </button>
              <button
                onClick={() => navigateInto(f)}
                className="text-[11px] font-medium text-gray-500 hover:text-gray-800 px-2 py-1 rounded-lg border border-gray-200 hover:bg-surface-hover transition-colors"
              >
                Open →
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Select current folder */}
      <div className="px-4 py-2.5 border-t border-surface-border bg-surface-inset flex items-center justify-between">
        <span className="text-xs text-gray-500">Select <strong>{current.name}</strong> itself</span>
        <button
          onClick={() => onSelect(current.id, current.name)}
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          Use this folder
        </button>
      </div>
    </div>
  );
}

type DriveFile = {
  id: string;
  driveFileId: string;
  filename: string;
  documentId: string | null;
  status: string;
  error: string | null;
  syncedAt: string;
};

type Status =
  | { connected: false }
  | {
      connected: true;
      email: string;
      folderId: string | null;
      folderName: string | null;
      lastSyncAt: string | null;
      recentFiles: DriveFile[];
    };


function DriveIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 87.3 78" fill="none" className="shrink-0">
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47" />
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#ea4335" />
      <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${ok ? "bg-green-500" : "bg-gray-300"}`} />
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function GoogleDriveSync() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [folderInput, setFolderInput] = useState("");
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [showBrowser, setShowBrowser] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [resetting, setResetting] = useState(false);

  const knownSyncAt = useRef<string | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/integrations/google-drive/status");
    if (res.ok) {
      setStatus(await res.json());
    } else {
      // Treat any non-OK response (e.g. 403 for users without settings access) as disconnected
      setStatus({ connected: false });
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Poll every 60s — detect cron-triggered syncs by watching lastSyncAt change
  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch("/api/integrations/google-drive/status");
      if (!res.ok) return;
      const data = await res.json();
      if (!data.connected) return;

      if (knownSyncAt.current === null) {
        // First poll — just record baseline, don't toast
        knownSyncAt.current = data.lastSyncAt ?? "";
        return;
      }

      if (data.lastSyncAt && data.lastSyncAt !== knownSyncAt.current) {
        knownSyncAt.current = data.lastSyncAt;
        setStatus(data);
        toast.success("Google Drive auto-synced — check Records for new documents");
      }
    }, 60_000);

    return () => clearInterval(interval);
  }, []);

  async function handleSetFolder() {
    setFolderError("");
    setFolderLoading(true);
    const res = await fetch("/api/integrations/google-drive/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: folderInput }),
    });
    const data = await res.json();
    setFolderLoading(false);
    if (!res.ok) { setFolderError(data.error ?? "Failed to set folder"); return; }
    setFolderInput("");
    loadStatus();
  }

  async function handleSync() {
    setSyncing(true);
    const toastId = toast.loading("Syncing Google Drive…");
    try {
      const result = await syncGoogleDrive();
      if (!result.ok) {
        toast.error(result.error, { id: toastId });
      } else {
        loadStatus();
        // Update baseline so the background poll doesn't re-toast for this manual sync
        knownSyncAt.current = new Date().toISOString();
        const { synced, duplicates, failed } = result;
        if (synced === 0 && duplicates === 0 && failed === 0) {
          toast.success("Google Drive — nothing new to sync", { id: toastId });
        } else {
          const parts = [
            synced > 0 && `${synced} ingested`,
            duplicates > 0 && `${duplicates} duplicate${duplicates !== 1 ? "s" : ""}`,
            failed > 0 && `${failed} failed`,
          ].filter(Boolean).join(" · ");
          failed > 0
            ? toast.warning(`Sync done — ${parts}`, { id: toastId })
            : toast.success(`Sync done — ${parts}`, { id: toastId });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sync failed";
      toast.error(msg, { id: toastId });
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Google Drive? Sync history will be preserved.")) return;
    await fetch("/api/integrations/google-drive/disconnect", { method: "DELETE" });
    setStatus({ connected: false });
  }

  async function handleReset() {
    if (!confirm("Clear sync history? This removes all cached file records so the next sync will re-process all files in the folder. Existing documents in OpsMind are not deleted.")) return;
    setResetting(true);
    try {
      const result = await resetSyncHistory();
      if (result.ok) {
        loadStatus();
      }
    } finally {
      setResetting(false);
    }
  }

  const urlError = searchParams.get("error");
  const urlErrorDetail = searchParams.get("detail");
  const justConnected = searchParams.get("connected") === "1";

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 mt-8">
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <DriveIcon />
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Google Drive</h1>
          <p className="text-sm text-gray-500">Watch a folder — new documents are auto-ingested into OpsMind.</p>
        </div>
      </div>

      {/* URL error banner */}
      {urlError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {urlError === "access_denied" && "Access was denied. Please try connecting again."}
          {urlError === "no_tokens" && "Google did not return tokens. Please try again and make sure to grant all permissions."}
          {urlError === "callback_failed" && <>Something went wrong during the OAuth flow.{urlErrorDetail && <> Detail: <code className="font-mono text-xs">{urlErrorDetail}</code></>}</>}
          {!["access_denied","no_tokens","callback_failed"].includes(urlError) && `Error: ${urlError}`}
        </div>
      )}

      {/* Just connected banner */}
      {justConnected && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 font-medium">
          Connected successfully. Now select a folder to watch below.
        </div>
      )}

      {/* Connection card */}
      <div className="rounded-xl border border-surface-border bg-white p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold text-gray-700">Connection</p>
          <StatusDot ok={status.connected} />
        </div>
        {status.connected ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-900">{status.email}</p>
              <p className="text-xs text-gray-400 mt-0.5">Google account connected</p>
            </div>
            <button
              onClick={handleDisconnect}
              className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between mt-2">
            <p className="text-sm text-gray-400">No Google account connected</p>
            <a
              href="/api/integrations/google-drive/connect"
              className="inline-flex items-center gap-2 text-sm font-semibold bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
            >
              <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Connect with Google
            </a>
          </div>
        )}
      </div>

      {/* Folder card — only shown when connected */}
      {status.connected && (
        <div className="rounded-xl border border-surface-border bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Watched folder</p>
            <button
              onClick={() => { setShowBrowser(b => !b); setFolderError(""); }}
              className="text-xs font-medium text-indigo-500 hover:text-indigo-700 transition-colors"
            >
              {showBrowser ? "Paste URL instead" : "Browse folders"}
            </button>
          </div>

          {status.folderId && !showBrowser && (
            <div className="flex items-center gap-3">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="shrink-0">
                <path d="M1 4a1 1 0 011-1h5l2 2h7a1 1 0 011 1v9a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" fill="#f59e0b" opacity="0.8"/>
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{status.folderName}</p>
                <p className="text-xs text-gray-400 font-mono truncate">{status.folderId}</p>
              </div>
            </div>
          )}

          {showBrowser ? (
            <FolderBrowser
              onSelect={async (id, name) => {
                setFolderLoading(true);
                setFolderError("");
                const res = await fetch("/api/integrations/google-drive/folder", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ input: id }),
                });
                const data = await res.json();
                setFolderLoading(false);
                if (!res.ok) { setFolderError(data.error ?? "Failed to set folder"); return; }
                setShowBrowser(false);
                loadStatus();
              }}
            />
          ) : (
            <>
              {!status.folderId && <p className="text-sm text-gray-400">No folder selected yet.</p>}
              <div className="flex gap-2">
                <input
                  value={folderInput}
                  onChange={e => setFolderInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && folderInput && handleSetFolder()}
                  placeholder="Paste Google Drive folder URL or ID…"
                  className="flex-1 text-sm text-gray-700 placeholder-gray-300 bg-surface-inset border border-surface-border rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-200"
                />
                <button
                  onClick={handleSetFolder}
                  disabled={!folderInput || folderLoading}
                  className="text-sm font-semibold bg-indigo-600 text-white px-3 py-2 rounded-lg hover:bg-indigo-700 disabled:bg-indigo-200 transition-colors whitespace-nowrap"
                >
                  {folderLoading ? "Checking…" : status.folderId ? "Change" : "Set folder"}
                </button>
              </div>
            </>
          )}
          {folderError && <p className="text-xs text-red-600">{folderError}</p>}
        </div>
      )}

      {/* Sync card — only when folder is set */}
      {status.connected && status.folderId && (
        <div className="rounded-xl border border-surface-border bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-700">Sync</p>
              {status.lastSyncAt && (
                <p className="text-xs text-gray-400 mt-0.5">Last sync {timeAgo(status.lastSyncAt)}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
            {status.recentFiles && status.recentFiles.length > 0 && (
              <button
                onClick={handleReset}
                disabled={resetting}
                className="text-xs font-medium text-gray-400 hover:text-red-500 disabled:opacity-50 transition-colors"
              >
                {resetting ? "Clearing…" : "Clear cache"}
              </button>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 text-sm font-semibold bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white px-3 py-2 rounded-lg transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={syncing ? "animate-spin" : ""}>
                <path d="M2 7a5 5 0 0 1 8.5-3.5L12 5M12 2v3H9" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 7a5 5 0 0 1-8.5 3.5L2 9M2 12V9h3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            </div>
          </div>

        </div>
      )}

      {/* History — recentFiles */}
      {status.connected && status.recentFiles && status.recentFiles.length > 0 && (
        <div className="rounded-xl border border-surface-border bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-border bg-surface-inset flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Sync history</p>
            <button
              onClick={handleReset}
              disabled={resetting}
              className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
            >
              {resetting ? "Clearing…" : "Clear cache"}
            </button>
          </div>
          <div className="divide-y divide-surface-border">
            {status.recentFiles.map(f => (
              <div key={f.id} className="px-5 py-2.5 space-y-0.5">
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                    f.status === "ok" ? "bg-green-50 text-green-700" :
                    f.status === "duplicate" ? "bg-amber-50 text-amber-700" :
                    "bg-red-50 text-red-700"
                  }`}>
                    {f.status === "ok" ? "added" : f.status}
                  </span>
                  <span className="text-sm text-gray-700 truncate flex-1">{f.filename}</span>
                  <span className="text-xs text-gray-400 shrink-0">{timeAgo(f.syncedAt)}</span>
                  {f.documentId && (
                    <Link href={`/records/${f.documentId}`} className="shrink-0 text-xs text-indigo-500 hover:text-indigo-700">
                      View →
                    </Link>
                  )}
                </div>
                {f.error && <p className="text-[10px] text-red-500 pl-8 leading-snug">{f.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Setup guide when no env vars */}
      <div className="rounded-xl border border-surface-border bg-surface-inset p-5 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Setup</p>
        <div className="space-y-1.5 text-xs text-gray-500 leading-relaxed">
          <p>1. Go to <span className="font-mono bg-white px-1 py-0.5 rounded border border-gray-200">console.cloud.google.com</span> → create a project → enable the Drive API.</p>
          <p>2. Create OAuth 2.0 credentials (Web application). Add <span className="font-mono bg-white px-1 py-0.5 rounded border border-gray-200">/api/integrations/google-drive/callback</span> as an authorised redirect URI.</p>
          <p>3. Add to <span className="font-mono bg-white px-1 py-0.5 rounded border border-gray-200">.env.local</span>:</p>
          <pre className="bg-white border border-gray-200 rounded-lg p-3 text-[10px] font-mono text-gray-700 overflow-x-auto whitespace-pre">
{`GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/google-drive/callback
DRIVE_INTERNAL_TOKEN=any-random-string-you-choose`}
          </pre>
          <p>4. Restart the dev server, then click <strong>Connect with Google</strong> above.</p>
        </div>
      </div>
    </div>
  );
}
