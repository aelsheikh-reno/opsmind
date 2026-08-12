import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

// GET /api/allocations?memberName=John+Smith
export async function GET(req: NextRequest) {
  const memberName = req.nextUrl.searchParams.get("memberName");
  if (!memberName) return NextResponse.json({ error: "memberName required" }, { status: 400 });

  // A person may have a different display name across projects (e.g. "Mohammed Rahmy" vs
  // "Mohamed Tawfiq Rahmy"). Look up all linked project team member names so allocations
  // stored under any of those names are returned.
  const linkedTeamMembers = await prisma.projectTeamMember.findMany({
    where: { person: { name: { equals: memberName, mode: "insensitive" } } },
    select: { name: true },
  });
  const allNames = [memberName, ...linkedTeamMembers.map((tm) => tm.name)];

  const allocations = await prisma.projectMemberAllocation.findMany({
    where: {
      OR: allNames.map((n) => ({ memberName: { equals: n, mode: "insensitive" as const } })),
    },
    include: {
      project: { select: { id: true, name: true, status: true, startDate: true, endDate: true } },
    },
    orderBy: [{ startDate: "desc" }],
  });

  // Serialize dates to ISO strings
  return NextResponse.json(
    allocations.map((a) => ({
      ...a,
      startDate: a.startDate.toISOString(),
      endDate: a.endDate.toISOString(),
      project: {
        ...a.project,
        startDate: a.project.startDate?.toISOString() ?? null,
        endDate: a.project.endDate?.toISOString() ?? null,
      },
    }))
  );
}

// POST /api/allocations
// Creates one allocation record covering the full date range
export async function POST(req: NextRequest) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { projectId, memberName, startDate: startStr, endDate: endStr, allocationPercent } =
    await req.json() as {
      projectId: string;
      memberName: string;
      startDate: string; // "YYYY-MM-DD"
      endDate: string;   // "YYYY-MM-DD"
      allocationPercent: number;
    };

  if (!projectId || !memberName || !startStr || !endStr) {
    return NextResponse.json(
      { error: "projectId, memberName, startDate, endDate are required" },
      { status: 400 }
    );
  }

  const startDate = new Date(startStr);
  const endDate = new Date(endStr);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }
  if (endDate < startDate) {
    return NextResponse.json({ error: "endDate must be >= startDate" }, { status: 400 });
  }

  // Resolve to the canonical team member name for this project, so allocations saved from
  // either the drawer (person name) or project detail (team member name) share the same row.
  const linkedByPerson = await prisma.projectTeamMember.findFirst({
    where: { projectId, person: { name: { equals: memberName, mode: "insensitive" } } },
    select: { name: true },
  });
  const linkedByTeamMember = await prisma.projectTeamMember.findFirst({
    where: { projectId, name: { equals: memberName, mode: "insensitive" } },
    include: { person: { select: { name: true } } },
  });
  // Prefer team member name; fall back to memberName if no link found
  const canonicalName = linkedByPerson?.name ?? linkedByTeamMember?.name ?? memberName;
  const personName = linkedByTeamMember?.person?.name;
  const aliasNames = [...new Set([canonicalName, memberName, ...(personName ? [personName] : [])])];

  // Match on BOTH startDate AND endDate so a per-month override (Jul–Jul) never
  // clobbers a spanning record (Jul–Oct) that starts on the same day.
  const allExisting = await prisma.projectMemberAllocation.findMany({
    where: {
      projectId,
      startDate,
      endDate,
      OR: aliasNames.map((n) => ({ memberName: { equals: n, mode: "insensitive" as const } })),
    },
    orderBy: { createdAt: "desc" },
  });

  let record;
  if (allExisting.length > 0) {
    // Update the most recent match (normalise memberName to canonical), delete stale duplicates
    record = await prisma.projectMemberAllocation.update({
      where: { id: allExisting[0].id },
      data: { memberName: canonicalName, endDate, allocationPercent },
    });
    if (allExisting.length > 1) {
      await prisma.projectMemberAllocation.deleteMany({
        where: { id: { in: allExisting.slice(1).map((r) => r.id) } },
      });
    }
  } else {
    record = await prisma.projectMemberAllocation.create({
      data: { projectId, memberName: canonicalName, startDate, endDate, allocationPercent },
    });
  }

  return NextResponse.json({
    ...record,
    startDate: record.startDate.toISOString(),
    endDate: record.endDate.toISOString(),
  });
}
