import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";
import { redirect } from "next/navigation";
import SidebarWrapper from "@/app/components/SidebarWrapper";
import TopBar from "@/app/components/TopBar";
import AllocationGrid from "./AllocationGrid";
import { PROJECT_COLORS, projectTextColor } from "@/lib/projectColors";

export const dynamic = "force-dynamic";

// Fallback palette for projects with no stored color (assigned by iteration order)
const FALLBACK_PALETTE = PROJECT_COLORS;

function generateMonths(start: string, count: number): string[] {
  const months: string[] = [];
  let [y, m] = start.split("-").map(Number);
  for (let i = 0; i < count; i++) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

function offsetMonth(ym: string, n: number): string {
  let [y, m] = ym.split("-").map(Number);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function fmtShort(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en", { month: "short", year: "numeric" });
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate(); // day 0 of next month = last day of this month
}

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string; all?: string }>;
}) {
  const { offset: offsetStr = "0", all } = await searchParams;
  const monthOffset = parseInt(offsetStr, 10) || 0;
  const showAll = all === "1";

  const session = await auth();
  const perms = resolvePermissions(
    session?.user?.role ?? "viewer",
    session?.user?.permissions ?? null
  );
  if (perms.people === "none") redirect("/");

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const windowStart = offsetMonth(currentMonth, -2 + monthOffset * 6);
  const months = generateMonths(windowStart, 12);

  const [allAllocations, people, projects, timesheetImports, linkedTeamMembers] = await Promise.all([
    prisma.projectMemberAllocation.findMany({
      include: { project: { select: { id: true, name: true, status: true } } },
      orderBy: [{ memberName: "asc" }, { startDate: "asc" }],
    }),
    prisma.person.findMany({
      select: { id: true, name: true, jobTitle: true, employmentType: true, weeklyHours: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: { status: { not: "cancelled" } },
      select: { id: true, name: true, status: true, startDate: true, endDate: true, color: true },
      orderBy: { name: "asc" },
    }),
    prisma.timesheetImport.findMany({
      select: {
        projectId: true,
        month: true,
        entries: { select: { employeeName: true, hoursLogged: true } },
      },
    }),
    prisma.projectTeamMember.findMany({
      where: { personId: { not: null } },
      select: { name: true, person: { select: { name: true } } },
    }),
  ]);

  // When a ProjectTeamMember is linked to a real Person, redirect its allocation key
  // so those bars appear under the linked person's row instead of as "not in directory".
  const memberRedirectMap = new Map<string, string>(); // memberName.lower → person.name.lower
  for (const tm of linkedTeamMembers) {
    if (tm.person) {
      memberRedirectMap.set(tm.name.toLowerCase(), tm.person.name.toLowerCase());
    }
  }

  // Build project lookup for quick color access
  const projectMap = new Map(projects.map(p => [p.id, p]));

  // Assign colors: use stored project.color first, fall back to palette by iteration order
  const projectColorMap = new Map<string, { bar: string; text: string }>();
  let fallbackIdx = 0;
  for (const a of allAllocations) {
    if (!projectColorMap.has(a.projectId)) {
      const storedColor = projectMap.get(a.projectId)?.color;
      if (storedColor) {
        projectColorMap.set(a.projectId, { bar: storedColor, text: projectTextColor(storedColor) });
      } else {
        projectColorMap.set(a.projectId, FALLBACK_PALETTE[fallbackIdx % FALLBACK_PALETTE.length]);
        fallbackIdx++;
      }
    }
  }

  // Build logged-hours map: employeeName (lower) → month → projectId → hours
  const logsMap = new Map<string, Map<string, Map<string, number>>>();
  for (const ts of timesheetImports) {
    for (const entry of ts.entries) {
      const key = entry.employeeName.toLowerCase();
      if (!logsMap.has(key)) logsMap.set(key, new Map());
      const byMonth = logsMap.get(key)!;
      if (!byMonth.has(ts.month)) byMonth.set(ts.month, new Map());
      const byProject = byMonth.get(ts.month)!;
      byProject.set(ts.projectId, (byProject.get(ts.projectId) ?? 0) + entry.hoursLogged);
    }
  }

  // AllocEntry per grid cell — includes day-level positioning
  type AllocEntry = {
    allocationId: string;
    projectId: string;
    projectName: string;
    percent: number;
    barColor: string;
    textColor: string;
    // Day range within the month (1-based, clamped)
    startDay: number;
    endDay: number;
    totalDaysInMonth: number;
    // Full date range of the allocation record
    allocStartISO: string; // "YYYY-MM-DD"
    allocEndISO: string;   // "YYYY-MM-DD"
  };

  // Deduplicate: if the same (projectId, memberName, startDate) appears more than once
  // (can happen when per-month % edits created new rows before the upsert fix), keep the
  // most recently created record only.
  const seenAllocKey = new Map<string, typeof allAllocations[number]>();
  for (const a of allAllocations) {
    const dk = `${a.projectId}||${a.memberName.toLowerCase()}||${a.startDate.toISOString().slice(0, 10)}`;
    const prev = seenAllocKey.get(dk);
    if (!prev || a.createdAt > prev.createdAt) seenAllocKey.set(dk, a);
  }
  const dedupedAllocations = Array.from(seenAllocKey.values());

  // Build member → month → AllocEntry[] by computing overlap per month
  const memberMonthMap = new Map<string, Map<string, AllocEntry[]>>();
  const memberNameCase = new Map<string, string>();

  for (const a of dedupedAllocations) {
    const rawKey = a.memberName.toLowerCase();
    const key = memberRedirectMap.get(rawKey) ?? rawKey;
    // Only store display name for truly unclaimed members (linked ones use the person's name)
    if (!memberRedirectMap.has(rawKey)) memberNameCase.set(key, a.memberName);
    if (!memberMonthMap.has(key)) memberMonthMap.set(key, new Map());
    const byMonth = memberMonthMap.get(key)!;

    const aStart = a.startDate;
    const aEnd = a.endDate;
    const color = projectColorMap.get(a.projectId) ?? FALLBACK_PALETTE[0];
    const allocStartISO = aStart.toISOString().split("T")[0];
    const allocEndISO = aEnd.toISOString().split("T")[0];

    for (const ym of months) {
      const [y, m] = ym.split("-").map(Number);
      const monthStart = new Date(Date.UTC(y, m - 1, 1));
      const monthEnd = new Date(Date.UTC(y, m, 0)); // last day of month

      // Overlap check
      if (aStart > monthEnd || aEnd < monthStart) continue;

      const overlapStart = aStart > monthStart ? aStart : monthStart;
      const overlapEnd = aEnd < monthEnd ? aEnd : monthEnd;
      const totalDays = daysInMonth(y, m);

      if (!byMonth.has(ym)) byMonth.set(ym, []);
      byMonth.get(ym)!.push({
        allocationId: a.id,
        projectId: a.projectId,
        projectName: a.project.name,
        percent: a.allocationPercent,
        barColor: color.bar,
        textColor: color.text,
        startDay: overlapStart.getUTCDate(),
        endDay: overlapEnd.getUTCDate(),
        totalDaysInMonth: totalDays,
        allocStartISO,
        allocEndISO,
      });
    }
  }

  const unclaimedKeys = new Set(memberMonthMap.keys());

  function serializeLogs(lowerName: string): Record<string, Record<string, number>> {
    const byMonth = logsMap.get(lowerName);
    if (!byMonth) return {};
    const result: Record<string, Record<string, number>> = {};
    for (const [month, byProject] of byMonth) {
      result[month] = Object.fromEntries(byProject);
    }
    return result;
  }

  type SerializedRow = {
    key: string;
    displayName: string;
    jobTitle?: string;
    inDirectory: boolean;
    personId?: string;
    weeklyHours: number;
    allocByMonth: Record<string, AllocEntry[]>;
    logsByMonth: Record<string, Record<string, number>>;
  };

  // If nobody in the directory has any allocation or logged hours yet, treat as showAll
  // so the grid shows all people rather than the empty state.
  const anyoneHasActivity = people.some(p => {
    const lk = p.name.toLowerCase();
    const bm = memberMonthMap.get(lk);
    return (bm && bm.size > 0) || logsMap.has(lk);
  });
  const effectiveShowAll = showAll || !anyoneHasActivity;

  const rows: SerializedRow[] = [];

  for (const person of people) {
    const lowerName = person.name.toLowerCase();
    const byMonth = memberMonthMap.get(lowerName);
    unclaimedKeys.delete(lowerName);
    const hasAnyAlloc = byMonth && byMonth.size > 0;
    const hasAnyLogs = logsMap.has(lowerName);
    if (!effectiveShowAll && !hasAnyAlloc && !hasAnyLogs) continue;
    rows.push({
      key: person.id,
      displayName: person.name,
      jobTitle: person.jobTitle ?? undefined,
      inDirectory: true,
      personId: person.id,
      weeklyHours: person.weeklyHours ?? 40,
      allocByMonth: byMonth ? Object.fromEntries(byMonth) : {},
      logsByMonth: serializeLogs(lowerName),
    });
  }

  for (const key of unclaimedKeys) {
    const byMonth = memberMonthMap.get(key)!;
    rows.push({
      key,
      displayName: memberNameCase.get(key) ?? key,
      inDirectory: false,
      weeklyHours: 40,
      allocByMonth: Object.fromEntries(byMonth),
      logsByMonth: serializeLogs(key),
    });
  }

  const noAllocCount = effectiveShowAll
    ? 0
    : people.filter((p) => {
        const lowerName = p.name.toLowerCase();
        const byMonth = memberMonthMap.get(lowerName);
        return (!byMonth || byMonth.size === 0) && !logsMap.has(lowerName);
      }).length;

  const projectLegend = Array.from(projectColorMap.entries()).map(([id, color]) => ({
    id,
    name: allAllocations.find((a) => a.projectId === id)?.project.name ?? id,
    barColor: color.bar,
  }));

  const prevParams = new URLSearchParams({ offset: String(monthOffset - 1), ...(showAll ? { all: "1" } : {}) }).toString();
  const nextParams = new URLSearchParams({ offset: String(monthOffset + 1), ...(showAll ? { all: "1" } : {}) }).toString();
  const allToggleParams = new URLSearchParams({ offset: String(monthOffset), ...(showAll ? {} : { all: "1" }) }).toString();
  const windowLabel = `${fmtShort(months[0])} — ${fmtShort(months[11])}`;

  const serializedProjects = projects.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    startDate: p.startDate ? p.startDate.toISOString() : null,
    endDate: p.endDate ? p.endDate.toISOString() : null,
  }));

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Allocation" }]} />
        <main className="px-4 sm:px-8 py-4 sm:py-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Resource Allocation</h1>
            <p className="text-sm text-gray-500 mt-1">
              Click any employee or cell to edit project assignments. Each bar shows exact days allocated within the month.
            </p>
          </div>

          {rows.length === 0 && !effectiveShowAll ? (
            <div className="bg-white border border-surface-border rounded-xl p-16 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-surface-inset border border-gray-200 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <rect x="2" y="5" width="18" height="14" rx="2" stroke="#9ca3af" strokeWidth="1.5" fill="none" />
                  <path d="M7 5V3m8 2V3" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M2 9h18" stroke="#9ca3af" strokeWidth="1.5" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-700">No allocation records found</p>
              <p className="text-sm text-gray-400 max-w-xs">
                Click an employee row in this grid to assign them to a project with a date range.
              </p>
            </div>
          ) : (
            <AllocationGrid
              rows={rows}
              months={months}
              currentMonth={currentMonth}
              projectLegend={projectLegend}
              projects={serializedProjects}
              prevParams={prevParams}
              nextParams={nextParams}
              windowLabel={windowLabel}
              noAllocCount={noAllocCount}
              showAll={showAll}
              allToggleParams={allToggleParams}
            />
          )}
        </main>
      </div>
    </div>
  );
}
