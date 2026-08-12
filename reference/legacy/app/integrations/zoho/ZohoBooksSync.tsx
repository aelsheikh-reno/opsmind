"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";

type Status =
  | { connected: false }
  | { connected: true; organizationId: string; organizationName: string | null; accountId: string | null; accountName: string | null };

type Account = { account_id: string; account_name: string };

// Salary and Banking Fee are virtual types for payroll line items
const EXPENSE_TYPES = ["Salary", "Banking Fee", "Travel", "Supplies", "Food & Beverage", "Other"];

const PAYMENT_MODES: { value: string; label: string }[] = [
  { value: "cash",            label: "Cash" },
  { value: "check",           label: "Check" },
  { value: "creditcard",      label: "Credit Card" },
  { value: "bankremittance",  label: "Bank Remittance" },
  { value: "autotransaction", label: "Auto Transaction" },
  { value: "others",          label: "Others" },
];

function ZohoIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="shrink-0">
      <rect width="32" height="32" rx="8" fill="#E42527" />
      <path d="M6 22L14 10h-7.5M12 10h13.5L17 22h8.5" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${ok ? "bg-green-500" : "bg-gray-300"}`} />;
}

export default function ZohoBooksSync() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedAccountName, setSelectedAccountName] = useState("");
  const [typeMapping, setTypeMapping] = useState<Record<string, string>>({});
  const [savingMapping, setSavingMapping] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [pullResult, setPullResult] = useState<{ imported: number; skippedAlreadyTracked: number; skippedAsanaDup: number; skippedExcluded: number; total: number } | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [excludeAccounts, setExcludeAccounts] = useState<{ id: string; name: string }[]>([]);
  const [excludePaymentModes, setExcludePaymentModes] = useState<string[]>([]);
  const [loadingExclusions, setLoadingExclusions] = useState(false);
  const [savingExclusions, setSavingExclusions] = useState(false);
  const [exclusionAccountsLoaded, setExclusionAccountsLoaded] = useState(false);

  const loadStatus = useCallback(async () => {
    const [statusRes, mappingRes, configRes] = await Promise.all([
      fetch("/api/integrations/zoho/status"),
      fetch("/api/integrations/zoho/claim-type-accounts"),
      fetch("/api/integrations/zoho/pull-config"),
    ]);
    if (statusRes.ok) {
      const data = await statusRes.json();
      setStatus(data);
      if (data.connected && data.accountId) {
        setSelectedAccountId(data.accountId);
        setSelectedAccountName(data.accountName ?? "");
      }
    } else {
      setStatus({ connected: false });
    }
    if (mappingRes.ok) {
      const data = await mappingRes.json();
      setTypeMapping(data.mapping ?? {});
    }
    if (configRes.ok) {
      const data = await configRes.json();
      setExcludeAccounts(data.excludeAccounts ?? []);
      setExcludePaymentModes(data.excludePaymentModes ?? []);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  async function loadAccounts() {
    setLoadingAccounts(true);
    const res = await fetch("/api/integrations/zoho/accounts");
    if (res.ok) {
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    }
    setLoadingAccounts(false);
  }

  async function saveAccount() {
    if (!selectedAccountId) return;
    setSavingAccount(true);
    await fetch("/api/integrations/zoho/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: selectedAccountId, accountName: selectedAccountName }),
    });
    setSavingAccount(false);
    loadStatus();
  }

  async function saveMapping() {
    setSavingMapping(true);
    await fetch("/api/integrations/zoho/claim-type-accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapping: typeMapping }),
    });
    setSavingMapping(false);
  }

  async function handlePullExpenses() {
    setPulling(true);
    setPullResult(null);
    setPullError(null);
    const res = await fetch("/api/integrations/zoho/pull-expenses", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setPullResult(data);
    } else {
      setPullError(data.error ?? "Import failed");
    }
    setPulling(false);
  }

  async function handleClearImported() {
    if (!confirm("Delete all Zoho-imported expenses? This cannot be undone.")) return;
    setClearing(true);
    setPullResult(null);
    await fetch("/api/integrations/zoho/pull-expenses", { method: "DELETE" });
    setClearing(false);
  }

  async function loadExclusionAccounts() {
    setLoadingExclusions(true);
    const res = await fetch("/api/integrations/zoho/accounts");
    if (res.ok) {
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    }
    setExclusionAccountsLoaded(true);
    setLoadingExclusions(false);
  }

  function toggleExcludeAccount(id: string, name: string) {
    setExcludeAccounts(prev =>
      prev.some(a => a.id === id) ? prev.filter(a => a.id !== id) : [...prev, { id, name }]
    );
  }

  function toggleExcludePaymentMode(mode: string) {
    setExcludePaymentModes(prev =>
      prev.includes(mode) ? prev.filter(m => m !== mode) : [...prev, mode]
    );
  }

  async function saveExclusions() {
    setSavingExclusions(true);
    await fetch("/api/integrations/zoho/pull-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ excludeAccounts, excludePaymentModes }),
    });
    setSavingExclusions(false);
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Zoho Books?")) return;
    await fetch("/api/integrations/zoho/disconnect", { method: "DELETE" });
    setStatus({ connected: false });
    setAccounts([]);
    setSelectedAccountId("");
  }

  const urlError       = searchParams.get("error");
  const urlErrorDetail = searchParams.get("detail");
  const justConnected  = searchParams.get("connected") === "1";

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
        <ZohoIcon />
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Zoho Books</h1>
          <p className="text-sm text-gray-500">Push approved expense claims directly to Zoho Books.</p>
        </div>
      </div>

      {/* URL error */}
      {urlError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {urlError === "access_denied" && "Access was denied. Please try connecting again."}
          {urlError === "no_tokens"     && "Zoho did not return tokens. Please try again."}
          {urlError === "no_org"        && "No Zoho Books organisation found on this account."}
          {urlError === "callback_failed" && <>Something went wrong.{urlErrorDetail && <> Detail: <code className="font-mono text-xs">{urlErrorDetail}</code></>}</>}
          {!["access_denied","no_tokens","no_org","callback_failed"].includes(urlError) && `Error: ${urlError}`}
        </div>
      )}

      {justConnected && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 font-medium">
          Connected successfully. Select a default expense account below.
        </div>
      )}

      {/* Connection card */}
      <div className="rounded-xl border border-surface-border bg-white p-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-gray-700">Connection</p>
          <StatusDot ok={status.connected} />
        </div>
        {status.connected ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-900">{status.organizationName ?? status.organizationId}</p>
              <p className="text-xs text-gray-400 mt-0.5">Zoho Books organisation connected</p>
            </div>
            <button onClick={handleDisconnect} className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors">
              Disconnect
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between mt-1">
            <p className="text-sm text-gray-400">No Zoho Books account connected</p>
            <a
              href="/api/integrations/zoho/connect"
              className="inline-flex items-center gap-2 text-sm font-semibold bg-[#E42527] text-white px-3 py-1.5 rounded-lg hover:bg-red-700 transition-colors shadow-sm"
            >
              Connect Zoho Books
            </a>
          </div>
        )}
      </div>

      {/* Default expense account */}
      {status.connected && (
        <div className="rounded-xl border border-surface-border bg-white p-5 space-y-4">
          <p className="text-sm font-semibold text-gray-700">Default expense account</p>
          {status.accountName ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-900">{status.accountName}</p>
                <p className="text-xs text-gray-400 font-mono mt-0.5">{status.accountId}</p>
              </div>
              <button
                onClick={() => { loadAccounts(); setSelectedAccountId(status.accountId ?? ""); }}
                className="text-xs font-medium text-indigo-500 hover:text-indigo-700 transition-colors"
              >
                Change
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No account selected — required before pushing expenses.</p>
          )}

          {/* Account picker */}
          {accounts.length === 0 && !status.accountName && (
            <button
              onClick={loadAccounts}
              disabled={loadingAccounts}
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 transition-colors"
            >
              {loadingAccounts ? "Loading accounts…" : "Load expense accounts from Zoho →"}
            </button>
          )}
          {accounts.length > 0 && (
            <div className="space-y-2">
              <select
                value={selectedAccountId}
                onChange={e => {
                  const acct = accounts.find(a => a.account_id === e.target.value);
                  setSelectedAccountId(e.target.value);
                  setSelectedAccountName(acct?.account_name ?? "");
                }}
                className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Select an account…</option>
                {accounts.map(a => (
                  <option key={a.account_id} value={a.account_id}>{a.account_name}</option>
                ))}
              </select>
              <button
                onClick={saveAccount}
                disabled={!selectedAccountId || savingAccount}
                className="text-sm font-semibold bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:bg-indigo-200 transition-colors"
              >
                {savingAccount ? "Saving…" : "Save account"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Expense type → Zoho account mapping */}
      {status.connected && (
        <div className="rounded-xl border border-surface-border bg-white p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-700">Expense type accounts</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Map each expense type to its Zoho Books expense account. Used for itemised payroll pushes.
              Falls back to the default account if not set.
            </p>
          </div>

          {accounts.length === 0 ? (
            <button
              onClick={loadAccounts}
              disabled={loadingAccounts}
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 transition-colors"
            >
              {loadingAccounts ? "Loading accounts…" : "Load accounts from Zoho to configure →"}
            </button>
          ) : (
            <div className="space-y-3">
              {EXPENSE_TYPES.map(type => (
                <div key={type} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-600 w-32 shrink-0">{type}</span>
                  <select
                    value={typeMapping[type] ?? ""}
                    onChange={e => setTypeMapping(prev => ({ ...prev, [type]: e.target.value }))}
                    className="flex-1 text-xs border border-surface-border rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">— Use default account</option>
                    {accounts.map(a => (
                      <option key={a.account_id} value={a.account_id}>{a.account_name}</option>
                    ))}
                  </select>
                </div>
              ))}
              <button
                onClick={saveMapping}
                disabled={savingMapping}
                className="text-sm font-semibold bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:bg-indigo-200 transition-colors"
              >
                {savingMapping ? "Saving…" : "Save mapping"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Pull expenses from Zoho */}
      {status.connected && (
        <div className="rounded-xl border border-surface-border bg-white p-5 space-y-3">
          <div>
            <p className="text-sm font-semibold text-gray-700">Import expenses from Zoho</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Pulls expenses from Zoho Books into OpsMind. Items already tracked (by amount + name)
              and accounts/payment modes in the exclusion rules below are skipped automatically.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handlePullExpenses}
              disabled={pulling || clearing}
              className="text-sm font-semibold bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:bg-indigo-200 transition-colors"
            >
              {pulling ? "Importing…" : "Import from Zoho →"}
            </button>
            <button
              onClick={handleClearImported}
              disabled={pulling || clearing}
              className="text-sm font-medium text-red-500 hover:text-red-700 disabled:opacity-40 transition-colors"
            >
              {clearing ? "Clearing…" : "Clear imported"}
            </button>
          </div>
          {pullError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-700 break-all">
              {pullError}
            </div>
          )}
          {pullResult && (
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3 text-xs text-gray-600 space-y-0.5">
              <p><span className="font-semibold text-gray-800">{pullResult.imported}</span> imported</p>
              <p><span className="font-semibold text-gray-500">{pullResult.skippedAlreadyTracked}</span> already tracked in OpsMind</p>
              <p><span className="font-semibold text-gray-500">{pullResult.skippedAsanaDup}</span> matched existing expense (amount + name)</p>
              <p><span className="font-semibold text-gray-500">{pullResult.skippedExcluded}</span> excluded by rules</p>
              <p className="text-gray-400 pt-0.5">{pullResult.total} total in Zoho</p>
            </div>
          )}
        </div>
      )}

      {/* Exclusion rules */}
      {status.connected && (
        <div className="rounded-xl border border-surface-border bg-white p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-700">Import exclusion rules</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Choose which expense accounts and payment methods to skip when importing from Zoho.
              Use this to prevent double-booking (e.g. exclude your Salary account or Bank Remittance payments).
            </p>
          </div>

          {/* Payment modes */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Payment methods</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {PAYMENT_MODES.map(pm => (
                <label key={pm.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={excludePaymentModes.includes(pm.value)}
                    onChange={() => toggleExcludePaymentMode(pm.value)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-gray-700">{pm.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Expense accounts */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Expense accounts</p>
            {accounts.length === 0 && !exclusionAccountsLoaded ? (
              <button
                onClick={loadExclusionAccounts}
                disabled={loadingExclusions}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 transition-colors"
              >
                {loadingExclusions ? "Loading accounts…" : "Load accounts from Zoho →"}
              </button>
            ) : accounts.length === 0 ? (
              <p className="text-xs text-gray-400">No expense accounts found.</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {accounts.map(a => (
                  <label key={a.account_id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={excludeAccounts.some(e => e.id === a.account_id)}
                      onChange={() => toggleExcludeAccount(a.account_id, a.account_name)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-gray-700">{a.account_name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={saveExclusions}
            disabled={savingExclusions}
            className="text-sm font-semibold bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:bg-indigo-200 transition-colors"
          >
            {savingExclusions ? "Saving…" : "Save exclusion rules"}
          </button>
        </div>
      )}

      {/* Setup guide */}
      <div className="rounded-xl border border-surface-border bg-surface-inset p-5 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Setup</p>
        <div className="space-y-1.5 text-xs text-gray-500 leading-relaxed">
          <p>1. Go to <span className="font-mono bg-white px-1 py-0.5 rounded border border-gray-200">api-console.zoho.com</span> → Other → Server-based Application.</p>
          <p>2. Set the redirect URI to <span className="font-mono bg-white px-1 py-0.5 rounded border border-gray-200">/api/integrations/zoho/callback</span> (your full domain).</p>
          <p>3. Add to environment variables:</p>
          <pre className="bg-white border border-gray-200 rounded-lg p-3 text-[10px] font-mono text-gray-700 overflow-x-auto whitespace-pre">
{`ZOHO_CLIENT_ID=your-client-id
ZOHO_CLIENT_SECRET=your-client-secret
ZOHO_REDIRECT_URI=https://yourdomain.com/api/integrations/zoho/callback`}
          </pre>
          <p>4. Click <strong>Connect Zoho Books</strong>, then select your default expense account.</p>
        </div>
      </div>
    </div>
  );
}
