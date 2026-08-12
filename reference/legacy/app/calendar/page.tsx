import { prisma } from "@/lib/prisma";
import { getUsdRates, toUSD } from "@/lib/fx";
import SidebarWrapper from "../components/SidebarWrapper";
import TopBar from "../components/TopBar";
import CalendarEventChip, { CalEvent, TYPE_META, EventType } from "./CalendarEventChip";
import CalendarNav from "./CalendarNav";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtNative(amount: number, currency: string): string {
  return `${Math.round(amount).toLocaleString("en-US")}`;
}

function parseMonth(s?: string): { year: number; month: number } {
  const m = s?.match(/^(\d{4})-(\d{2})$/);
  if (m) return { year: parseInt(m[1]), month: parseInt(m[2]) };
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function parseParties(json: string | null): string[] {
  const arr: string[] = json ? JSON.parse(json) : [];
  return arr.filter(p => p.trim());
}

const DOC_TYPE_NAMES: Record<string, string> = {
  lease_contract:  "Lease contract",
  client_contract: "Client contract",
  invoice:         "Invoice",
};

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const { year, month }       = parseMonth(monthParam);

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 0);

  const today    = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // ── Fetch ────────────────────────────────────────────────────────────────
  const [invoices, schedules, payrollRuns, renewals, payrollDaySetting, rates] = await Promise.all([
    prisma.document.findMany({
      where: { docType: "invoice", expiryDate: { gte: monthStart, lte: monthEnd } },
      select: { id: true, issueDate: true, expiryDate: true, amount: true, currency: true, parties: true, referenceNumber: true, isPaid: true },
    }),
    prisma.paymentSchedule.findMany({
      where: { dueDate: { gte: monthStart, lte: monthEnd } },
      select: {
        id: true, dueDate: true, amount: true, currency: true,
        description: true, isPaid: true, invoiceId: true,
        document: { select: { id: true, docType: true, filename: true, parties: true } },
      },
    }),
    prisma.payrollRun.findMany({
      where: { year, month },
      select: {
        id: true, isProcessed: true,
        entries: { select: { salary: true, currency: true } },
      },
    }),
    prisma.document.findMany({
      where: { docType: { notIn: ["invoice"] }, expiryDate: { gte: monthStart, lte: monthEnd } },
      select: { id: true, docType: true, filename: true, parties: true, expiryDate: true },
    }),
    prisma.setting.findUnique({ where: { key: "payrollDay" } }),
    getUsdRates(),
  ]);

  const payrollDay = Math.max(1, Math.min(31, parseInt(payrollDaySetting?.value ?? "1") || 1));

  // ── Build event map ──────────────────────────────────────────────────────
  const eventMap = new Map<number, CalEvent[]>();

  function addEvent(day: number, ev: CalEvent) {
    const arr = eventMap.get(day) ?? [];
    arr.push(ev);
    eventMap.set(day, arr);
  }

  // Invoices
  for (const inv of invoices) {
    if (!inv.expiryDate) continue;
    const day       = new Date(inv.expiryDate).getDate();
    const ps        = parseParties(inv.parties);
    const client    = ps[0] ?? "";
    const label     = inv.referenceNumber
      ? (client ? `${client} · #${inv.referenceNumber}` : `#${inv.referenceNumber}`)
      : (client || "Invoice");
    const amountUsd = toUSD(inv.amount ?? 0, inv.currency ?? "USD", rates);

    addEvent(day, {
      key: inv.id, type: "collection",
      label,
      amountUsd,
      isPaid: inv.isPaid,
      href: `/records/${inv.id}`,
      dueDate:         fmtDate(new Date(inv.expiryDate)),
      issueDate:       inv.issueDate ? fmtDate(new Date(inv.issueDate)) : undefined,
      nativeAmount:    inv.currency && inv.currency !== "USD" ? fmtNative(inv.amount ?? 0, inv.currency) : undefined,
      nativeCurrency:  inv.currency !== "USD" ? inv.currency ?? undefined : undefined,
      referenceNumber: inv.referenceNumber ?? undefined,
      allParties:      ps,
    });
  }

  // Payment schedules
  for (const s of schedules) {
    const day       = new Date(s.dueDate).getDate();
    const ps        = parseParties(s.document.parties);
    const label     = s.description || ps[0] || s.document.filename;
    const amountUsd = toUSD(s.amount, s.currency, rates);
    const docName   = DOC_TYPE_NAMES[s.document.docType ?? ""] ?? s.document.docType ?? "";

    if (s.document.docType === "lease_contract") {
      addEvent(day, {
        key: s.id, type: "lease",
        label,
        amountUsd,
        isPaid: s.isPaid,
        href: `/records/${s.document.id}`,
        dueDate:       fmtDate(new Date(s.dueDate)),
        nativeAmount:  s.currency !== "USD" ? fmtNative(s.amount, s.currency) : undefined,
        nativeCurrency:s.currency !== "USD" ? s.currency : undefined,
        allParties:    ps,
        docTypeName:   docName,
      });
    }

    if (s.document.docType === "client_contract" && !s.invoiceId) {
      addEvent(day, {
        key: s.id, type: "collection",
        label,
        amountUsd,
        isPaid: s.isPaid,
        href: `/records/${s.document.id}`,
        dueDate:       fmtDate(new Date(s.dueDate)),
        nativeAmount:  s.currency !== "USD" ? fmtNative(s.amount, s.currency) : undefined,
        nativeCurrency:s.currency !== "USD" ? s.currency : undefined,
        allParties:    ps,
        docTypeName:   docName,
      });
    }
  }

  // Payroll runs — pin to payrollDay from settings
  const daysInMonthForPayroll = monthEnd.getDate();
  const effectivePayrollDay   = Math.min(payrollDay, daysInMonthForPayroll);
  const periodLabel           = `${MONTH_NAMES[month - 1]} ${year}`;

  for (const run of payrollRuns) {
    const totalUsd     = run.entries.reduce((s, e) => s + toUSD(e.salary, e.currency ?? "USD", rates), 0);
    const payDate      = new Date(year, month - 1, effectivePayrollDay);

    addEvent(effectivePayrollDay, {
      key: run.id, type: "payroll",
      label: "Payroll run",
      amountUsd:     totalUsd,
      isPaid:        run.isProcessed,
      href:          `/payroll?month=${month}&year=${year}`,
      dueDate:       fmtDate(payDate),
      allParties:    [],
      employeeCount: run.entries.length,
      periodLabel,
    });
  }

  // Contract renewals / expirations
  for (const doc of renewals) {
    if (!doc.expiryDate) continue;
    const day   = new Date(doc.expiryDate).getDate();
    const ps    = parseParties(doc.parties);
    const label = ps[0] || doc.filename;
    addEvent(day, {
      key: `renew-${doc.id}`, type: "renewal",
      label,
      amountUsd:  0,
      isPaid:     false,
      href:       `/records/${doc.id}`,
      dueDate:    fmtDate(new Date(doc.expiryDate)),
      allParties: ps,
      docTypeName: DOC_TYPE_NAMES[doc.docType ?? ""] ?? doc.docType ?? undefined,
    });
  }

  // ── Calendar geometry ────────────────────────────────────────────────────
  const daysInMonth  = monthEnd.getDate();
  const firstWeekDay = monthStart.getDay();
  const startPad     = firstWeekDay === 0 ? 6 : firstWeekDay - 1;
  const totalCells   = Math.ceil((startPad + daysInMonth) / 7) * 7;
  const trailingPad  = totalCells - startPad - daysInMonth;

  const allEvents  = Array.from(eventMap.values()).flat();
  const totalIn    = allEvents.filter(e => e.type === "collection").reduce((s, e) => s + e.amountUsd, 0);
  const totalOut   = allEvents.filter(e => e.type === "lease" || e.type === "payroll").reduce((s, e) => s + e.amountUsd, 0);
  const renewCount = allEvents.filter(e => e.type === "renewal").length;

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Calendar" }]} />

        <main className="px-4 sm:px-8 py-4 sm:py-6 w-full max-w-7xl space-y-5">

          {/* Header */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{MONTH_NAMES[month - 1]} {year}</h1>
              <p className="text-sm text-gray-400 mt-0.5">Financial calendar · dues, collections &amp; renewals</p>
            </div>
            <CalendarNav year={year} month={month} />
          </div>

          {/* Summary strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-emerald-100 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Expected in</p>
                <p className="text-lg font-bold text-emerald-600 tabular-nums">{totalIn > 0 ? fmt(totalIn) : "—"}</p>
              </div>
            </div>
            <div className="bg-white border border-surface-border rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-gray-400 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Committed out</p>
                <p className="text-lg font-bold text-gray-800 tabular-nums">{totalOut > 0 ? fmt(totalOut) : "—"}</p>
              </div>
            </div>
            <div className="bg-white border border-amber-100 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Renewals</p>
                <p className="text-lg font-bold text-amber-600 tabular-nums">{renewCount > 0 ? renewCount : "—"}</p>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-5 flex-wrap">
            {(Object.entries(TYPE_META) as [EventType, typeof TYPE_META[EventType]][]).map(([type, meta]) => (
              <span key={type} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.dot }} />
                {meta.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-[11px] text-gray-400 pl-3 border-l border-gray-200">
              <span className="w-2 h-2 rounded-full shrink-0 bg-red-400" />
              Overdue
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
              <span className="w-2 h-2 rounded-full shrink-0 bg-gray-200" />
              Already paid
            </span>
          </div>

          {/* Calendar grid — no overflow-hidden so tooltips can escape */}
          <div className="bg-white border border-surface-border rounded-xl">

            {/* Day-of-week headers */}
            <div className="grid grid-cols-7 border-b border-surface-border bg-surface-inset rounded-t-xl overflow-hidden">
              {DAY_LABELS.map(d => (
                <div key={d} className="py-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">
                  {d}
                </div>
              ))}
            </div>

            {/* Cells */}
            <div className="grid grid-cols-7">

              {Array.from({ length: startPad }).map((_, i) => (
                <div key={`pre-${i}`} className="min-h-[110px] border-b border-r border-surface-border bg-surface-inset/50" />
              ))}

              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day     = i + 1;
                const dayStr  = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const isToday = dayStr === todayStr;
                const dayDate = new Date(year, month - 1, day);
                const isPast  = dayDate < new Date(today.getFullYear(), today.getMonth(), today.getDate());
                const events  = eventMap.get(day) ?? [];
                const visible = events.slice(0, 3);
                const extra   = events.length - 3;

                return (
                  <div
                    key={day}
                    className={`min-h-[110px] border-b border-r border-surface-border p-1.5 flex flex-col gap-0.5
                      ${isToday ? "bg-indigo-50/40" : isPast ? "bg-surface-inset/30" : "bg-white"}
                    `}
                  >
                    <div className="flex justify-end mb-0.5 pr-0.5">
                      {isToday ? (
                        <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">
                          {day}
                        </span>
                      ) : (
                        <span className={`text-[11px] font-medium ${isPast ? "text-gray-300" : "text-gray-500"}`}>
                          {day}
                        </span>
                      )}
                    </div>

                    {visible.map(ev => (
                      <CalendarEventChip key={ev.key} ev={ev} isPast={isPast} />
                    ))}

                    {extra > 0 && (
                      <span className="text-[9px] text-gray-400 px-1 pt-0.5">+{extra} more</span>
                    )}
                  </div>
                );
              })}

              {Array.from({ length: trailingPad }).map((_, i) => (
                <div key={`post-${i}`} className="min-h-[110px] border-b border-r border-surface-border bg-surface-inset/50 last:border-r-0" />
              ))}

            </div>
          </div>

        </main>
      </div>
    </div>
  );
}
