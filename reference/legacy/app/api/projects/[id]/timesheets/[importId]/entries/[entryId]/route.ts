import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; importId: string; entryId: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { entryId } = await params;
  const body = await req.json();
  const { milestoneId, serviceId } = body;

  const entry = await prisma.timesheetEntry.update({
    where: { id: entryId },
    data: {
      ...(milestoneId !== undefined && { milestoneId: milestoneId ?? null }),
      ...(serviceId !== undefined && { serviceId: serviceId ?? null }),
    },
    include: {
      service: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(entry);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; importId: string; entryId: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { entryId } = await params;
  await prisma.timesheetEntry.delete({ where: { id: entryId } });
  return NextResponse.json({ success: true });
}
