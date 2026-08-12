import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireRead, requireWrite } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { auth } from "@/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireRead("projects");
  if (denied) return denied;

  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      milestones: {
        orderBy: { order: "asc" },
        include: { invoices: true },
      },
      timesheets: {
        orderBy: { month: "desc" },
        include: { entries: true },
      },
      expenses: { orderBy: { date: "desc" } },
      invoices: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();

  const session = await auth();
  const auditUser = { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null };

  const before = await prisma.project.findUnique({ where: { id } });

  const project = await prisma.project.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.clientName !== undefined && { clientName: body.clientName?.trim() || null }),
      ...(body.clientId !== undefined && { clientId: body.clientId || null }),
      ...(body.description !== undefined && { description: body.description?.trim() || null }),
      ...(body.contractValue !== undefined && { contractValue: body.contractValue ? parseFloat(body.contractValue) : null }),
      ...(body.currency !== undefined && { currency: body.currency }),
      ...(body.startDate !== undefined && { startDate: body.startDate ? new Date(body.startDate) : null }),
      ...(body.endDate !== undefined && { endDate: body.endDate ? new Date(body.endDate) : null }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.billingType !== undefined && { billingType: body.billingType }),
      ...(body.color !== undefined && { color: body.color || null }),
    },
  });

  if (before) {
    const TRACKED = ["name", "description", "contractValue", "currency", "startDate", "endDate", "billingType", "clientName", "status"] as const;
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of TRACKED) {
      if (body[key] === undefined) continue;
      const from = before[key] instanceof Date ? before[key].toISOString().split("T")[0] : before[key];
      const to   = project[key] instanceof Date ? project[key].toISOString().split("T")[0] : project[key];
      if (String(from) !== String(to ?? "")) changes[key] = { from, to };
    }
    if (Object.keys(changes).length > 0) {
      const onlyStatus = Object.keys(changes).length === 1 && "status" in changes;
      await audit({
        action: onlyStatus ? "project.status_updated" : "project.updated",
        entityType: "project",
        entityId: id,
        entityLabel: project.name,
        details: { changes },
        ...auditUser,
      });
    }
  }

  return NextResponse.json(project);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const session = await auth();
  const auditUser = { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null };

  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, select: { name: true } });
  await prisma.project.delete({ where: { id } });

  await audit({
    action: "project.deleted",
    entityType: "project",
    entityId: id,
    entityLabel: project?.name ?? null,
    ...auditUser,
  });

  return NextResponse.json({ success: true });
}
