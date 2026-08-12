"use client";

export type TrendMonth = { label: string; income: number; expense: number };

function fmtK(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return n > 0 ? `$${n.toFixed(0)}` : "—";
}

const CHART_H = 180; // px — visible bar area
const GRID_LINES = 4;

export default function TrendChart({ months }: { months: TrendMonth[] }) {
  const rawMax = Math.max(...months.flatMap(m => [m.income, m.expense]), 1);
  // Round max up to a clean grid value
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const max = Math.ceil(rawMax / magnitude) * magnitude;

  const gridValues = Array.from({ length: GRID_LINES + 1 }, (_, i) =>
    Math.round((max / GRID_LINES) * (GRID_LINES - i))
  );

  return (
    <div className="flex gap-3">
      {/* Y-axis labels */}
      <div className="flex flex-col justify-between pb-6 text-right shrink-0" style={{ height: CHART_H + 24 }}>
        {gridValues.map(v => (
          <span key={v} className="text-[10px] text-gray-300 font-medium leading-none">{fmtK(v)}</span>
        ))}
      </div>

      {/* Chart area */}
      <div className="flex-1 flex flex-col">
        {/* Grid + bars */}
        <div className="relative flex-1" style={{ height: CHART_H }}>
          {/* Horizontal gridlines */}
          {gridValues.map((_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0 border-t border-gray-100"
              style={{ top: `${(i / GRID_LINES) * 100}%` }}
            />
          ))}

          {/* Bar groups */}
          <div className="absolute inset-0 flex items-end gap-1 px-1">
            {months.map(m => {
              const incH = m.income > 0 ? Math.max((m.income / max) * CHART_H, 4) : 0;
              const expH = m.expense > 0 ? Math.max((m.expense / max) * CHART_H, 4) : 0;
              return (
                <div key={m.label} className="flex-1 flex items-end justify-center gap-0.5 h-full">
                  {/* Income bar */}
                  <div className="flex-1 flex flex-col items-center justify-end" style={{ height: "100%" }}>
                    {m.income > 0 && (
                      <span className="text-[9px] font-semibold text-indigo-500 leading-none mb-0.5 whitespace-nowrap">
                        {fmtK(m.income)}
                      </span>
                    )}
                    <div
                      className="w-full bg-indigo-400 hover:bg-indigo-500 rounded-t transition-colors cursor-default"
                      style={{ height: incH }}
                      title={`Income ${m.label}: ${fmtK(m.income)}`}
                    />
                  </div>
                  {/* Expense bar */}
                  <div className="flex-1 flex flex-col items-center justify-end" style={{ height: "100%" }}>
                    {m.expense > 0 && (
                      <span className="text-[9px] font-semibold text-rose-400 leading-none mb-0.5 whitespace-nowrap">
                        {fmtK(m.expense)}
                      </span>
                    )}
                    <div
                      className="w-full bg-rose-300 hover:bg-rose-400 rounded-t transition-colors cursor-default"
                      style={{ height: expH }}
                      title={`Payroll ${m.label}: ${fmtK(m.expense)}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* X-axis month labels */}
        <div className="flex gap-1 px-1 mt-1.5">
          {months.map(m => (
            <div key={m.label} className="flex-1 text-center">
              <span className="text-[10px] text-gray-400 font-medium">{m.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
