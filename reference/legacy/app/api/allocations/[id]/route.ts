import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { id } = await params;
  const { projectId, startDate: startStr, endDate: endStr, allocationPercent } =
    await req.json() as { projectId?: string; startDate: string; endDate: string; allocationPercent: number };

  if (!startStr || !endStr) {
    return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
  }

  const startDate = new Date(startStr);
  const endDate = new Date(endStr);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate < startDate) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  const record = await prisma.projectMemberAllocation.update({
    where: { id },
    data: { ...(projectId ? { projectId } : {}), startDate, endDate, allocationPercent },
    include: { project: { select: { id: true, name: true, status: true, startDate: true, endDate: true } } },
  });

  return NextResponse.json({
    ...record,
    startDate: record.startDate.toISOString(),
    endDate: record.endDate.toISOString(),
    project: {
      ...record.project,
      startDate: record.project.startDate?.toISOString() ?? null,
      endDate: record.project.endDate?.toISOString() ?? null,
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { id } = await params;
  await prisma.projectMemberAllocation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
