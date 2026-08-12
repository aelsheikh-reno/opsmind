"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import LinkPersonButton from "../components/LinkPersonButton";
import SendPayslipButton from "../components/SendPayslipButton";
import PayrollZohoPushButton from "../components/PayrollZohoPushButton";
import PayrollBudgetSelect from "../components/PayrollBudgetSelect";
import DeletePayrollEntryButton from "../components/DeletePayrollEntryButton";

type SalaryComponent = { name: string; amount: number };
type PersonStub = { id: string; name: string; jobTitle: string | null };
type Budget = { id: string; name: string; color: string | null };
type Claim = { id: string; name: string; amount: number; currency: string };

export type EntryRow = {
  id: string;
  employeeName: string;
  salary: number;
  currency: string;
  isPaid: boolean;
  note: string | null;
  salaryComponents: string | null;
  zohoExpenseId: string | null;
  payslipSentCount: number;
  bankingFee: number | null;
  bankingFeeCurrency: string | null;
  budgetId: string | null;
  personId: string | null;
  person: {
    id: string;
    name: string | null;
    email: string | null;
    contractEnd: string | null;
    payslipInContractCurrency: boolean;
  } | null;
  usdEquiv: number;
  isOverdue: boolean;
  isNonUsd: boolean;
  personClaims: Claim[];
  claimsUsd: number;
};

type Props = {
  entries: EntryRow[];
  budgets: Budget[];
  activeCurrencies: string[];
  allPeople: PersonStub[];
  allLinkedPersonIds: string[];
  canWrite: boolean;
  rates: Record<string, number>;
};

function parseSalaryComponents(json: string | null | undefined): SalaryComponent[] {
  try { return json ? JSON.parse(json) : []; } catch { return []; }
}

function toUSD(amount: number, currency: string, rates: Record<string, number>) {
  if (currency === "USD") return amount;
  const r = rates[currency];
  return r ? amount / r : amount;
}

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function PayrollEntryListClient({
  entries,
  budgets,
  activeCurrencies,
  allPeople,
  allLinkedPersonIds,
  canWrite,
  rates,
}: Props) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<"paid" | "unpaid" | "budget" | "delete" | null>(null);
  const [budgetPickerOpen, setBudgetPickerOpen] = useState(false);

  function toggle(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map(e => e.id)));
    }
  }

  async function bulkMarkPaid(isPaid: boolean) {
    setBulkBusy(isPaid ? "paid" : "unpaid");
    await fetch("/api/payroll/entry/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryIds: Array.from(selectedIds), isPaid }),
    });
    setBulkBusy(null);
    setSelectedIds(new Set());
    router.refresh();
  }

  async function bulkAssignBudget(budgetId: string | null) {
    setBulkBusy("budget");
    setBudgetPickerOpen(false);
    await fetch("/api/payroll/entry/budget/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryIds: Array.from(selectedIds), budgetId }),
    });
    setBulkBusy(null);
    setSelectedIds(new Set());
    router.refresh();
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selectedIds.size} payroll ${selectedIds.size === 1 ? "entry" : "entries"}? This cannot be undone.`)) return;
    setBulkBusy("delete");
    await fetch("/api/payroll/entry/bulk", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryIds: Array.from(selectedIds) }),
    });
    setBulkBusy(null);
    setSelectedIds(new Set());
    router.refresh();
  }

  const allSelected = selectedIds.size === entries.length && entries.length > 0;
  const someSelected = selectedIds.size > 0;
  const selectedEntries = entries.filter(e => selectedIds.has(e.id));
  const allSelectedPaid = selectedEntries.length > 0 && selectedEntries.every(e => e.isPaid);

  return (
    <div>

      {/* Select-all header */}
      {canWrite && entries.length > 1 && (
        <div className="flex items-center gap-4 px-5 py-2 border-b border-surface-border bg-surface-inset/60">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer shrink-0"
          />
          <span className="text-[11px] text-gray-400">
            {someSelected ? `${selectedIds.size} of ${entries.length} selected` : "Select all"}
          </span>
        </div>
      )}

      <div className="divide-y divide-surface-border">
        {entries.map((entry) => {
          const comps = parseSalaryComponents(entry.salaryComponents);
          const totalUsd = entry.usdEquiv + entry.claimsUsd;
          const hasClaims = entry.personClaims.length > 0;
          const contractEnd = entry.person?.contractEnd ? new Date(entry.person.contractEnd) : null;
          const now = new Date();
          const daysToContractEnd = contractEnd
            ? Math.ceil((contractEnd.getTime() - now.getTime()) / 86400000)
            : null;
          const contractExpiringSoon = daysToContractEnd !== null && daysToContractEnd >= 0 && daysToContractEnd <= 90;
          const contractEndLabel = contractEnd
            ? contractEnd.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            : null;
          const isSelected = selectedIds.has(entry.id);

          return (
            <div
              key={entry.id}
              className={`flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-hover group ${entry.isPaid ? "opacity-60" : entry.isOverdue ? "bg-red-50/20" : ""} ${isSelected ? "bg-indigo-50/40" : ""}`}
            >
              {/* Checkbox — sole selection control; paid state shown via row styling */}
              {canWrite && (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(entry.id)}
                  className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer shrink-0"
                />
              )}

              {/* Avatar */}
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-gray-500">
                  {entry.employeeName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                </span>
              </div>

              {/* Name + status */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${entry.isPaid ? "line-through text-gray-400" : "text-gray-900"}`}>
                  {entry.employeeName}
                </p>
                {entry.isPaid ? (
                  <p className="text-xs text-green-600 mt-0.5">Paid</p>
                ) : entry.isOverdue ? (
                  <p className="text-xs text-red-500 font-medium mt-0.5">Overdue</p>
                ) : null}
                {entry.note && (
                  <p className="text-xs text-amber-600 mt-0.5">{entry.note}</p>
                )}
                <SendPayslipButton
                  entryId={entry.id}
                  personEmail={entry.person?.email ?? undefined}
                  currency={entry.currency}
                  defaultContractCurrency={entry.person?.payslipInContractCurrency ?? false}
                  hidden={!canWrite || !entry.personId}
                  initialSentCount={entry.payslipSentCount}
                />
                <PayrollZohoPushButton
                  entryId={entry.id}
                  zohoExpenseId={entry.zohoExpenseId}
                  hidden={!canWrite || !entry.isPaid}
                  bankingFee={entry.bankingFee}
                  bankingFeeCurrency={entry.bankingFeeCurrency}
                  currency={entry.currency}
                  activeCurrencies={activeCurrencies}
                />
                <PayrollBudgetSelect
                  entryId={entry.id}
                  budgetId={entry.budgetId}
                  budgets={budgets}
                  hidden={!canWrite}
                />
                {contractExpiringSoon && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full mt-0.5">
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <circle cx="4" cy="4" r="3.5" stroke="currentColor" strokeWidth="1" fill="none" />
                      <path d="M4 2.5v2M4 5.5v.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                    </svg>
                    Contract ends in {daysToContractEnd}d · {contractEndLabel}
                  </span>
                )}
              </div>

              {/* Profile link */}
              <div className="shrink-0">
                <LinkPersonButton
                  employeeName={entry.employeeName}
                  personId={entry.personId ?? null}
                  personName={entry.person?.name ?? null}
                  people={allPeople}
                  linkedPersonIds={allLinkedPersonIds}
                />
              </div>

              {/* Amount + breakdown */}
              <div className="text-right shrink-0 min-w-[200px]">
                <div className="space-y-0.5">
                  {comps.length > 1 ? (
                    <>
                      {comps.map((c, i) => (
                        <div key={i} className="flex items-center justify-end gap-2">
                          <span className={`text-[10px] ${entry.isPaid ? "text-gray-300" : "text-gray-400"} truncate max-w-[140px]`}>{c.name}</span>
                          <span className={`text-[10px] font-medium tabular-nums ${entry.isPaid ? "text-gray-300" : "text-gray-600"}`}>
                            {entry.currency} {c.amount.toLocaleString()}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-[10px] font-bold text-gray-400">Salary</span>
                        <span className={`text-sm font-semibold tabular-nums ${entry.isPaid ? "text-gray-400" : entry.isOverdue ? "text-red-600" : "text-gray-900"}`}>
                          {entry.currency} {entry.salary.toLocaleString()}
                        </span>
                      </div>
                      {entry.isNonUsd && (
                        <p className="text-[10px] text-gray-400">≈ USD {entry.usdEquiv.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className={`text-sm font-semibold tabular-nums ${entry.isPaid ? "text-gray-400" : entry.isOverdue ? "text-red-600" : "text-gray-900"}`}>
                        {entry.currency} {entry.salary.toLocaleString()}
                      </p>
                      {entry.isNonUsd && (
                        <p className="text-[10px] text-gray-400">≈ USD {entry.usdEquiv.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                      )}
                    </>
                  )}
                  {entry.bankingFee && entry.bankingFee > 0 && (
                    <div className="flex items-center justify-end gap-1.5 mt-0.5">
                      <span className="text-[10px] text-gray-400">Bank fee</span>
                      <span className="text-[10px] font-medium tabular-nums text-gray-400">
                        {entry.bankingFeeCurrency ?? entry.currency} {entry.bankingFee.toLocaleString()}
                      </span>
                    </div>
                  )}
                  {hasClaims && (
                    <>
                      <div className="border-t border-surface-border pt-0.5 mt-0.5">
                        {entry.personClaims.map((c) => (
                          <div key={c.id} className="flex items-center justify-end gap-1.5 mt-0.5">
                            <span className="text-[10px] text-teal-600 truncate max-w-[130px]" title={c.name}>{c.name}</span>
                            <span className="text-[10px] font-medium tabular-nums text-teal-700">
                              +USD {toUSD(c.amount, c.currency, rates).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-end gap-1 border-t border-teal-100 pt-0.5">
                        <span className="text-[10px] font-bold text-gray-500">Total to pay</span>
                        <span className="text-sm font-bold tabular-nums text-gray-900">
                          USD {totalUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Delete */}
              <DeletePayrollEntryButton entryId={entry.id} hidden={!canWrite} />
            </div>
          );
        })}
      </div>


      {/* Fixed bottom bulk action bar */}
      {canWrite && someSelected && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-2xl shadow-2xl">
          <span className="text-sm font-medium tabular-nums">{selectedIds.size} selected</span>
          <div className="w-px h-4 bg-white/20" />

          {/* Mark paid / Mark unpaid toggle */}
          {allSelectedPaid ? (
            <button
              onClick={() => bulkMarkPaid(false)}
              disabled={bulkBusy !== null}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-300 hover:text-white disabled:opacity-50 transition-colors"
            >
              {bulkBusy === "unpaid"
                ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/></svg>
                : <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/><path d="M4.5 4.5l5 5M9.5 4.5l-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>}
              {bulkBusy === "unpaid" ? "Saving…" : "Mark unpaid"}
            </button>
          ) : (
            <button
              onClick={() => bulkMarkPaid(true)}
              disabled={bulkBusy !== null}
              className="flex items-center gap-1.5 text-sm font-semibold text-emerald-300 hover:text-emerald-200 disabled:opacity-50 transition-colors"
            >
              {bulkBusy === "paid"
                ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/></svg>
                : <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5L12 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              {bulkBusy === "paid" ? "Saving…" : "Mark paid"}
            </button>
          )}
          <div className="w-px h-4 bg-white/20" />

          {/* Assign budget */}
          {budgets.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setBudgetPickerOpen(v => !v)}
                disabled={bulkBusy !== null}
                className="flex items-center gap-1.5 text-sm font-semibold text-blue-300 hover:text-blue-200 disabled:opacity-50 transition-colors"
              >
                {bulkBusy === "budget"
                  ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/></svg>
                  : <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M1 4a1 1 0 011-1h2.5l1 1.5H12a1 1 0 011 1v5a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>}
                {bulkBusy === "budget" ? "Saving…" : "Assign budget"}
                {bulkBusy !== "budget" && <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 4l3-3 3 3M2 7l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </button>
              {budgetPickerOpen && (
                <div className="absolute bottom-full mb-3 left-0 bg-white rounded-xl shadow-2xl border border-gray-200 py-1.5 min-w-[200px] z-10">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-3 pb-1.5">Select budget</p>
                  <div className="max-h-52 overflow-y-auto">
                    {budgets.map(b => (
                      <button
                        key={b.id}
                        onClick={() => bulkAssignBudget(b.id)}
                        className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex items-center gap-2"
                      >
                        {b.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: b.color }} />}
                        <span className="font-medium">{b.name}</span>
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-gray-100 mt-1 pt-1">
                    <button
                      onClick={() => bulkAssignBudget(null)}
                      className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-gray-50 transition-colors"
                    >
                      Remove from budget
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="w-px h-4 bg-white/20" />

          {/* Delete */}
          <button
            onClick={bulkDelete}
            disabled={bulkBusy !== null}
            className="flex items-center gap-1.5 text-sm font-semibold text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
          >
            {bulkBusy === "delete"
              ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/></svg>
              : <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 3h10M5.5 3V2h3v1M5 3l.5 8.5M9 3l-.5 8.5M3 3l.5 9h7l.5-9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            {bulkBusy === "delete" ? "Deleting…" : "Delete"}
          </button>

          <div className="w-px h-4 bg-white/20" />
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
