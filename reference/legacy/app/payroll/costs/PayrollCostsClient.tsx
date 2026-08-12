"use client";

function fmt(usd: number) {
  if (usd === 0) return "—";
  const abs = Math.abs(usd);
  if (abs >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${Math.round(usd).toLocaleString()}`;
}

function initials(name: string) {
  return name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();
}

type MonthRow = {
  key: string;
  month: number;
  year: number;
  salariesUSD: number;
  bankingFeesUSD: number;
  claimsUSD: number;
  totalUSD: number;
  entries: {
    id: string;
    employeeName: string;
    salaryUSD: number;
    bankingFeeUSD: number;
    budget: { name: string; color: string | null } | null;
  }[];
  claims: {
    id: string;
    name: string;
    personName: string | null;
    amountUSD: number;
    budget: { name: string; color: string | null } | null;
  }[];
};

type PersonSummary = {
  employeeName: string;
  personId: string | null;
  salaryUSD: number;
  claimsUSD: number;
  bankingFeeUSD: number;
  totalUSD: number;
};

export default function PayrollCostsClient({
  rows,
  personRows,
}: {
  rows: MonthRow[];
  personRows: PersonSummary[];
}) {
  const grandTotal  = rows.reduce((s, r) => s + r.totalUSD, 0);
  const grandSalary = rows.reduce((s, r) => s + r.salariesUSD, 0);
  const grandFees   = rows.reduce((s, r) => s + r.bankingFeesUSD, 0);
  const grandClaims = rows.reduce((s, r) => s + r.claimsUSD, 0);
  const maxPerson   = Math.max(...personRows.map(p => p.totalUSD), 1);

  if (personRows.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 px-6 py-16 text-center">
        <p className="text-sm font-medium text-gray-500">No paid payroll entries yet</p>
        <p className="text-xs text-gray-400 mt-1">Mark payroll entries as paid to see the cost breakdown here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total people cost", value: grandTotal },
          { label: "Salaries paid",     value: grandSalary },
          { label: "Expense claims",    value: grandClaims },
          { label: "Banking fees",      value: grandFees },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-[11px] font-medium mb-1 text-gray-500">{label}</p>
            <p className="text-xl font-bold text-gray-800">{fmt(value)}</p>
            <p className="text-[10px] mt-0.5 text-gray-400">all time · USD equiv.</p>
          </div>
        ))}
      </div>

      {/* Per-person bar chart */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">

        {/* Legend */}
        <div className="flex items-center gap-4 px-5 py-3 border-b border-gray-100 bg-surface-inset">
          {[
            { label: "Salary",     color: "#6366f1" },
            { label: "Claims",     color: "#2dd4bf" },
            { label: "Bank fees",  color: "#fb923c" },
          ].map(s => (
            <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-gray-500 font-medium">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
          <span className="ml-auto text-[11px] text-gray-400 font-medium uppercase tracking-wide">Total (USD)</span>
        </div>

        <div className="divide-y divide-gray-50">
          {personRows.map((p, i) => {
            const salPct = (p.salaryUSD    / maxPerson) * 100;
            const clmPct = (p.claimsUSD    / maxPerson) * 100;
            const feePct = (p.bankingFeeUSD / maxPerson) * 100;

            return (
              <div key={p.personId ?? p.employeeName} className="flex items-center gap-4 px-5 py-3.5 hover:bg-surface-hover transition-colors">
                <span className="text-[11px] text-gray-300 font-semibold tabular-nums w-5 shrink-0 text-right">{i + 1}</span>

                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-indigo-600">{initials(p.employeeName)}</span>
                </div>

                <div className="w-44 shrink-0 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{p.employeeName}</p>
                  {(p.claimsUSD > 0 || p.bankingFeeUSD > 0) && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {p.claimsUSD > 0 && `claims ${fmt(p.claimsUSD)}`}
                      {p.claimsUSD > 0 && p.bankingFeeUSD > 0 && " · "}
                      {p.bankingFeeUSD > 0 && `fees ${fmt(p.bankingFeeUSD)}`}
                    </p>
                  )}
                </div>

                {/* Stacked bar */}
                <div className="flex-1 flex items-center h-6 gap-px">
                  {salPct > 0 && (
                    <div
                      title={`Salary ${fmt(p.salaryUSD)}`}
                      className={`h-full bg-indigo-500 transition-all ${clmPct === 0 && feePct === 0 ? "rounded" : "rounded-l"}`}
                      style={{ width: `${salPct}%` }}
                    />
                  )}
                  {clmPct > 0 && (
                    <div
                      title={`Claims ${fmt(p.claimsUSD)}`}
                      className={`h-full bg-teal-400 transition-all ${salPct === 0 ? "rounded-l" : ""} ${feePct === 0 ? "rounded-r" : ""}`}
                      style={{ width: `${clmPct}%` }}
                    />
                  )}
                  {feePct > 0 && (
                    <div
                      title={`Bank fees ${fmt(p.bankingFeeUSD)}`}
                      className={`h-full bg-orange-400 transition-all rounded-r ${salPct === 0 && clmPct === 0 ? "rounded-l" : ""}`}
                      style={{ width: `${feePct}%` }}
                    />
                  )}
                </div>

                <span className="text-sm font-bold text-gray-900 tabular-nums w-20 text-right shrink-0">
                  {fmt(p.totalUSD)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 bg-surface-inset">
          <span className="text-xs font-semibold text-gray-500">{personRows.length} team members</span>
          <span className="text-sm font-bold text-gray-900">{fmt(grandTotal)}</span>
        </div>
      </div>
    </div>
  );
}
