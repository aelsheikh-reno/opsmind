import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  // Build a map: personName.lower → teamMemberName, so allocations saved under
  // a person's name (via the Resource Allocation page) resolve to the team member
  // name that ProjectDetailClient's getAlloc() uses for lookups.
  const teamMembers = await prisma.projectTeamMember.findMany({
    where: { projectId, personId: { not: null } },
    include: { person: { select: { name: true } } },
  });
  const personToTeamMember = new Map<string, string>();
  for (const tm of teamMembers) {
    if (tm.person) personToTeamMember.set(tm.person.name.toLowerCase(), tm.name);
  }

  const allocations = await prisma.projectMemberAllocation.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }],
  });

  // Normalise names, then deduplicate: if the same member+month was stored under
  // multiple name aliases (e.g. "Mohammed Rahmy" and "Mohamed Tawfiq Rahmy"),
  // keep only the most recently created record for each (normalizedName, startMonth).
  const normalized = allocations.map((a) => ({
    ...a,
    memberName: personToTeamMember.get(a.memberName.toLowerCase()) ?? a.memberName,
    startDate: a.startDate.toISOString(),
    endDate: a.endDate.toISOString(),
  }));

  const seen = new Set<string>();
  const deduped = normalized.filter((a) => {
    // Key includes both start AND end month so a spanning record (Jul–Oct) and a
    // per-month override (Jul–Jul) can coexist — they cover different date ranges.
    // Dedup only removes exact duplicate (same name + same start + same end).
    const key = `${a.memberName.toLowerCase()}||${a.startDate.slice(0, 7)}||${a.endDate.slice(0, 7)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json(deduped);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { id: projectId } = await params;
  const { memberName, startDate: startStr, endDate: endStr, allocationPercent } =
    await req.json() as {
      memberName: string;
      startDate: string;
      endDate: string;
      allocationPercent: number;
    };

  if (!memberName || !startStr || !endStr) {
    return NextResponse.json(
      { error: "memberName, startDate, and endDate are required" },
      { status: 400 }
    );
  }

  const startDate = new Date(startStr);
  const endDate = new Date(endStr);

  // Resolve aliases so both the project detail (team member name) and drawer (person name)
  // always save to the same row under the team member's canonical name.
  const linkedByPerson = await prisma.projectTeamMember.findFirst({
    where: { projectId, person: { name: { equals: memberName, mode: "insensitive" } } },
    select: { name: true },
  });
  const linkedByTeamMember = await prisma.projectTeamMember.findFirst({
    where: { projectId, name: { equals: memberName, mode: "insensitive" } },
    include: { person: { select: { name: true } } },
  });
  const canonicalName = linkedByPerson?.name ?? linkedByTeamMember?.name ?? memberName;
  const personName = linkedByTeamMember?.person?.name;
  const aliasNames = [...new Set([canonicalName, memberName, ...(personName ? [personName] : [])])];

  // Match on BOTH startDate AND endDate so a per-month override (Jul–Jul) never
  // touches a spanning record (Jul–Oct) that happens to share the same start date.
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
    // Update the most recent match (renaming memberName to canonical), delete stale duplicates
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
