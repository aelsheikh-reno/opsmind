"use client";

import { useState } from "react";
import DeleteStaffButton from "../components/DeleteStaffButton";
import LinkPersonButton from "../components/LinkPersonButton";
import PayrollBudgetPanel, { type StaffWithBudget } from "./PayrollBudgetPanel";

type Budget = { id: string; name: string; color: string | null };
type Person = { id: string; name: string; jobTitle: string | null };

export default function PayrollRightPanel({
  staffList,
  budgets,
  allPeople,
  allLinkedPersonIds,
  canWrite,
}: {
  staffList: StaffWithBudget[];
  budgets: Budget[];
  allPeople: Person[];
  allLinkedPersonIds: string[];
  canWrite: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"staff" | "budgets">("staff");

  return (
    <div className="w-full lg:w-72 shrink-0 lg:sticky top-6 z-0">
      <div className="bg-white border border-surface-border rounded-xl overflow-hidden">

        {/* Tab bar */}
        <div className="flex border-b border-surface-border">
          {(["staff", "budgets"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-xs font-semibold transition-colors ${
                activeTab === tab
                  ? "text-gray-900 border-b-2 border-gray-900 -mb-px bg-white"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {tab === "staff" ? "Staff links" : "Budget assignments"}
            </button>
          ))}
        </div>

        {activeTab === "staff" ? (
          <>
            <div className="px-4 py-3.5 border-b border-surface-border">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Staff links</h2>
                <span className="text-xs text-gray-400">
                  {staffList.filter(s => s.personId).length}/{staffList.length}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">Links apply across all months</p>
              {staffList.some(s => !s.personId) && (
                <span className="mt-2 inline-block text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                  {staffList.filter(s => !s.personId).length} unlinked
                </span>
              )}
            </div>
            <div className="divide-y divide-[#EEEAE0] max-h-[calc(100vh-220px)] overflow-y-auto">
              {staffList.map(staff => (
                <div key={staff.employeeName} className={`px-4 py-3 group ${!staff.personId ? "bg-amber-50/30" : ""}`}>
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <p className="text-xs font-medium text-gray-700 truncate" title={staff.employeeName}>
                      {staff.employeeName}
                    </p>
                    <DeleteStaffButton
                      hidden={!canWrite}
                      employeeName={staff.employeeName}
                      personId={staff.personId}
                    />
                  </div>
                  <LinkPersonButton
                    hidden={!canWrite}
                    employeeName={staff.employeeName}
                    personId={staff.personId}
                    personName={staff.personName}
                    people={allPeople}
                    linkedPersonIds={allLinkedPersonIds}
                  />
                </div>
              ))}
            </div>
          </>
        ) : (
          <PayrollBudgetPanel
            staffList={staffList}
            budgets={budgets}
            canWrite={canWrite}
          />
        )}

      </div>
    </div>
  );
}
