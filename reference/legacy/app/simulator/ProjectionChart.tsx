"use client";

import { useState } from "react";

export type ChartSeries = {
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  values: number[];
};

export type EventMarker = {
  id: string;
  startMonth: number;
  endMonth: number;
  label: string;
  color: string;
  typeLabel: string;
  amountLabel: string;
  scheduledPayments?: { month: number; amountUSD: number }[];
};

export type ChartMode = "monthly" | "cumulative";

type Props = {
  series: ChartSeries[];
  monthLabels: string[];
  markers?: EventMarker[];
  mode?: ChartMode;
};

function fmtK(v: number) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function fmtFull(v: number) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function assignRows(markers: EventMarker[]): number[] {
  const rows: number[] = new Array(markers.length).fill(0);
  for (let i = 0; i < markers.length; i++) {
    const occupied = new Set<number>();
    for (let j = 0; j < i; j++) {
      if (markers[j].startMonth <= markers[i].endMonth && markers[j].endMonth >= markers[i].startMonth) {
        occupied.add(rows[j]);
      }
    }
    let r = 0;
    while (occupied.has(r)) r++;
    rows[i] = r;
  }
  return rows;
}

export default function ProjectionChart({ series, monthLabels, markers = [], mode = "monthly" }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [clickedIdx, setClickedIdx] = useState<number | null>(null);

  if (!series.length || !series[0].values.length) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        Add a scenario to see projections
      </div>
    );
  }

  const maxRows = markers.length > 0 ? Math.max(...assignRows(markers)) + 1 : 0;
  const ROW_H = 15;
  const GANTT_H = maxRows * ROW_H + (maxRows > 0 ? 8 : 0);

  const W = 900;
  const padL = 76;
  const padR = 24;
  const padT = 20;
  const padB = 44;
  const CHART_H = 420;
  const H = padT + CHART_H + padB + GANTT_H;
  const chartW = W - padL - padR;
  const n = series[0].values.length;

  const allVals = series.flatMap((s) => s.values);
  const dataMin = Math.min(0, ...allVals);
  const dataMax = Math.max(0, ...allVals);
  const range = dataMax - dataMin || 1;
  const padY = range * 0.15;
  const yMin = dataMin - padY;
  const yMax = dataMax + padY;
  const yRange = yMax - yMin;

  function xPos(i: number) { return padL + (i / Math.max(n - 1, 1)) * chartW; }
  function yPos(v: number) { return padT + (1 - (v - yMin) / yRange) * CHART_H; }
  function toPath(vals: number[]) {
    return vals.map((v, i) => `${i === 0 ? "M" : "L"}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`).join(" ");
  }

  function niceStep(r: number, t: number) {
    if (r === 0) return 1;
    const raw = r / t;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    return ([1, 2, 2.5, 5, 10].find((f) => f * mag >= raw) ?? 10) * mag;
  }
  const step = niceStep(yRange, 5);
  const ticks: number[] = [];
  for (let t = Math.ceil(yMin / step) * step; t <= yMax + step * 0.01; t += step) ticks.push(t);

  const labelEvery = n > 18 ? 3 : n > 12 ? 2 : 1;
  const rows = assignRows(markers);
  const ganttY = padT + CHART_H + padB - 4;

  // Active index: clicked (pinned) takes priority over hovered
  const activeIdx = clickedIdx ?? hoverIdx;
  const isPinned = clickedIdx !== null;
  const fmt = isPinned ? fmtFull : fmtK;

  // Exclude scheduled-payment markers — they get their own tooltip section
  const activeAtHover  = activeIdx !== null ? markers.filter((m) => !m.scheduledPayments && m.startMonth <= activeIdx! && m.endMonth >= activeIdx!) : [];
  const startingNow    = activeAtHover.filter((m) => m.startMonth === activeIdx);
  const ongoingNow     = activeAtHover.filter((m) => m.startMonth < activeIdx!);
  // Payments due in the active month (scheduled-revenue events only)
  const paymentsNow = activeIdx !== null
    ? markers
        .filter(m => m.scheduledPayments?.some(p => p.month === activeIdx))
        .map(m => ({ marker: m, payment: m.scheduledPayments!.find(p => p.month === activeIdx)! }))
    : [];

  return (
    <div className="relative select-none">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          const raw = ((x - padL) / chartW) * (n - 1);
          setHoverIdx(Math.max(0, Math.min(n - 1, Math.round(raw))));
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          const raw = ((x - padL) / chartW) * (n - 1);
          const idx = Math.max(0, Math.min(n - 1, Math.round(raw)));
          setClickedIdx(prev => prev === idx ? null : idx);
        }}
      >
        {/* Y grid + labels */}
        {ticks.map((tick) => {
          const y = yPos(tick);
          const isZero = Math.abs(tick) < step * 0.01;
          return (
            <g key={tick}>
              <line x1={padL} y1={y} x2={W - padR} y2={y}
                stroke={isZero ? "#6B7280" : "#E5E7EB"}
                strokeWidth={isZero ? 1.5 : 1}
                strokeDasharray={isZero ? undefined : "4 3"} />
              <text x={padL - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={9.5} fill="#9CA3AF">
                {fmtK(tick)}
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {monthLabels.map((label, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={i} x={xPos(i)} y={padT + CHART_H + 16} textAnchor="middle" fontSize={9.5} fill="#9CA3AF">
              {label}
            </text>
          ) : null
        )}

        {/* Event shaded regions */}
        {markers.map((m) => {
          const x1 = xPos(m.startMonth);
          const x2 = xPos(m.endMonth);
          return (
            <rect key={`shade-${m.id}`}
              x={x1} y={padT} width={Math.max(x2 - x1, 1)} height={CHART_H}
              fill={m.color} opacity={0.06} />
          );
        })}

        {/* Event vertical lines */}
        {markers.map((m) => (
          <g key={`vlines-${m.id}`}>
            <line x1={xPos(m.startMonth)} y1={padT} x2={xPos(m.startMonth)} y2={padT + CHART_H}
              stroke={m.color} strokeWidth={1.5} strokeDasharray="3 2" opacity={0.45} />
            {m.endMonth < n - 1 && (
              <line x1={xPos(m.endMonth)} y1={padT} x2={xPos(m.endMonth)} y2={padT + CHART_H}
                stroke={m.color} strokeWidth={1} strokeDasharray="2 3" opacity={0.3} />
            )}
          </g>
        ))}

        {/* Scenario lines (rendered first, underneath) */}
        {series.filter(s => !s.dashed).map((s) => (
          <path key={s.id}
            d={toPath(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={hoverIdx !== null ? 0.45 : 1}
          />
        ))}
        {/* Baseline (dashed) — rendered on top, always full opacity */}
        {series.filter(s => s.dashed).map((s) => (
          <path key={s.id}
            d={toPath(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth={1.5}
            strokeDasharray="6 3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Crosshair — shown for hovered or clicked month */}
        {activeIdx !== null && (
          <>
            <line x1={xPos(activeIdx)} y1={padT} x2={xPos(activeIdx)} y2={padT + CHART_H}
              stroke={isPinned ? "#4F46E5" : "#6B7280"} strokeWidth={isPinned ? 1.5 : 1} strokeDasharray="4 2" />
            {series.map((s) => (
              <circle key={s.id}
                cx={xPos(activeIdx)} cy={yPos(s.values[activeIdx])}
                r={4.5} fill={s.color} stroke="white" strokeWidth={2} />
            ))}
          </>
        )}

        {/* Gantt strip */}
        {markers.map((m, idx) => {
          const row = rows[idx];
          const x1 = xPos(m.startMonth);
          const x2 = xPos(m.endMonth);
          const y = ganttY + row * ROW_H;
          const w = Math.max(x2 - x1, 4);
          const barH = ROW_H - 3;
          const shortLabel = m.label.length > 18 ? m.label.slice(0, 17) + "…" : m.label;
          return (
            <g key={`gantt-${m.id}`}>
              <rect x={x1} y={y} width={w} height={barH} rx={3} fill={m.color} opacity={0.15} />
              <rect x={x1} y={y} width={w} height={barH} rx={3} stroke={m.color} strokeWidth={0.8} fill="none" opacity={0.45} />
              <rect x={x1} y={y} width={3} height={barH} rx={1} fill={m.color} opacity={0.65} />
              {m.endMonth < n - 1 && (
                <rect x={x2 - 3} y={y} width={3} height={barH} rx={1} fill={m.color} opacity={0.45} />
              )}
              {w > 55 && (
                <text x={x1 + 7} y={y + barH / 2} dominantBaseline="middle" fontSize={8} fill={m.color} fontWeight="600" opacity={0.85}>
                  {shortLabel}
                </text>
              )}
            </g>
          );
        })}
        {/* Scheduled payment markers — triangles at chart baseline per payment month */}
        {markers.filter(m => m.scheduledPayments).flatMap(m =>
          (m.scheduledPayments ?? []).map(p => {
            const x   = xPos(p.month);
            const isH = hoverIdx === p.month;
            const base = padT + CHART_H;
            const tip  = isH ? 10 : 6;
            return (
              <g key={`pay-${m.id}-${p.month}`}>
                {/* Faint vertical line up from the triangle */}
                <line x1={x} y1={base - (isH ? 24 : 0)} x2={x} y2={base}
                  stroke={m.color} strokeWidth={1} strokeDasharray="2 2" opacity={isH ? 0.55 : 0} />
                {/* Label above when hovered */}
                {isH && (
                  <text x={x} y={base - 28} textAnchor="middle" fontSize={8.5} fill={m.color} fontWeight="700">
                    {fmtK(p.amountUSD)}
                  </text>
                )}
                {/* Upward triangle */}
                <polygon
                  points={`${x},${base - tip} ${x - (isH ? 5 : 3.5)},${base + 2} ${x + (isH ? 5 : 3.5)},${base + 2}`}
                  fill={m.color} opacity={isH ? 1 : 0.55}
                />
              </g>
            );
          })
        )}
      </svg>

      {/* Tooltip — visible on hover or when a month is clicked/pinned */}
      {activeIdx !== null && (
        <div className={`absolute top-2 right-3 bg-white rounded-xl shadow-lg p-3 text-xs min-w-[210px] max-w-[260px] z-10 ${isPinned ? "border border-indigo-200 pointer-events-auto" : "border border-gray-200 pointer-events-none"}`}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="font-semibold text-gray-800">{monthLabels[activeIdx]}</p>
            {isPinned && (
              <button
                onClick={() => setClickedIdx(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
                title="Unpin"
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
          {series.map((s) => {
            const val = s.values[activeIdx];
            return (
              <div key={s.id} className="flex items-center justify-between gap-3 mb-1">
                <span className="flex items-center gap-1.5 text-gray-600 truncate">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="truncate">{s.label}</span>
                </span>
                <span className="font-semibold shrink-0 tabular-nums" style={{ color: val >= 0 ? "#10B981" : "#EF4444" }}>
                  {mode === "cumulative" ? fmt(val) + " cash" : fmt(val) + "/mo"}
                </span>
              </div>
            );
          })}

          {paymentsNow.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Payment due</p>
              {paymentsNow.map(({ marker, payment }) => (
                <div key={marker.id} className="flex items-center justify-between gap-2 mb-1 last:mb-0">
                  <span className="flex items-center gap-1.5 text-gray-600 truncate">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: marker.color }} />
                    <span className="truncate">{marker.label}</span>
                  </span>
                  <span className="font-bold shrink-0 tabular-nums" style={{ color: marker.color }}>
                    {fmt(payment.amountUSD)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {startingNow.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Starts this month</p>
              {startingNow.map((m) => (
                <div key={m.id} className="flex items-start gap-1.5 mb-1 last:mb-0">
                  <span className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ backgroundColor: m.color }} />
                  <div>
                    <span className="font-medium text-gray-700">{m.label}</span>
                    <span className="text-gray-400"> · {m.typeLabel}</span>
                    {m.amountLabel && <p className="text-gray-500">{m.amountLabel}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {ongoingNow.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Active events</p>
              {ongoingNow.map((m) => (
                <div key={m.id} className="flex items-center gap-1.5 mb-1 last:mb-0 text-gray-500">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                  <span className="truncate">{m.label}</span>
                  <span className="text-gray-400 text-[10px] ml-auto shrink-0">→ {monthLabels[m.endMonth]}</span>
                </div>
              ))}
            </div>
          )}

          {!isPinned && (
            <p className="mt-2 pt-2 border-t border-gray-100 text-[10px] text-gray-300 text-center">Click to pin with exact amounts</p>
          )}
        </div>
      )}
    </div>
  );
}
