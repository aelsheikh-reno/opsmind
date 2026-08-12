"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AddPersonModal from "./AddPersonModal";
import Money from "./Money";

export default function PayrollOnlyRow({
  name,
  salary,
  currency,
  rates,
  canWrite,
}: {
  name: string;
  salary: number | null;
  currency: string | null;
  rates: Record<string, number>;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <tr className="hover:bg-surface-hover transition-colors">
      <td className="px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-gray-400">
              {name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="font-medium text-gray-700">{name}</span>
            <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full w-fit leading-none mt-0.5">
              Payroll only
            </span>
          </div>
        </div>
      </td>
      <td className="px-5 py-3"><span className="text-gray-300">—</span></td>
      <td className="px-5 py-3"><span className="text-gray-300">—</span></td>
      <td className="px-5 py-3"><span className="text-gray-300">—</span></td>
      <td className="px-5 py-3"><span className="text-gray-300">—</span></td>
      <td className="px-5 py-3"><span className="text-gray-300">—</span></td>
      <td className="px-5 py-3">
        {salary != null ? (
          <Money amount={salary} currency={currency ?? "AED"} rates={rates} size="sm" />
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
      <td className="px-5 py-3">
        {canWrite ? (
          <>
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="5" r="3" stroke="currentColor" strokeWidth="1.4" fill="none" />
                <path d="M1 13c0-3.3 2.7-5 6-5s6 1.7 6 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
                <path d="M10 2v4M8 4h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              Setup profile
            </button>
            <AddPersonModal
              controlledOpen={modalOpen}
              prefillName={name}
              onClose={() => setModalOpen(false)}
              onCreated={(personId) => {
                setModalOpen(false);
                router.push(`/people/${personId}`);
              }}
            />
          </>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )}
      </td>
      <td className="px-3 py-3" />
    </tr>
  );
}
