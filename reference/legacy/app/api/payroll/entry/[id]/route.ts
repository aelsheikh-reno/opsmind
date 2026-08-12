import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

// DELETE /api/payroll/entry/[id]  — remove entry and recompute run total
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const { id } = await params;

  const entry = await prisma.payrollEntry.findUnique({
    where: { id },
    select: { payrollRunId: true },
  });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.payrollEntry.delete({ where: { id } });

  // Recompute run total
  const agg = await prisma.payrollEntry.aggregate({
    where: { payrollRunId: entry.payrollRunId },
    _sum: { salary: true },
  });
  await prisma.payrollRun.update({
    where: { id: entry.payrollRunId },
    data: { totalAmount: agg._sum.salary ?? 0 },
  });

  return NextResponse.json({ ok: true });
}

// PATCH /api/payroll/entry/[id]  — link or unlink a person profile
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();
  const personId: string | null = body.personId ?? null;

  const entry = await prisma.payrollEntry.findUnique({ where: { id } });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.payrollEntry.update({
    where: { id },
    data: { personId },
  });

  return NextResponse.json({ success: true });
}
