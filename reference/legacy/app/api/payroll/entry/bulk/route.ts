import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";

export async function DELETE(req: NextRequest) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const { entryIds } = await req.json() as { entryIds: string[] };
  if (!Array.isArray(entryIds) || entryIds.length === 0)
    return NextResponse.json({ error: "entryIds required" }, { status: 400 });

  const entries = await prisma.payrollEntry.findMany({
    where: { id: { in: entryIds } },
    select: { payrollRunId: true },
  });
  const runIds = [...new Set(entries.map(e => e.payrollRunId))];

  await prisma.payrollEntry.deleteMany({ where: { id: { in: entryIds } } });

  await Promise.all(runIds.map(async runId => {
    const agg = await prisma.payrollEntry.aggregate({
      where: { payrollRunId: runId },
      _sum: { salary: true },
    });
    await prisma.payrollRun.update({
      where: { id: runId },
      data: { totalAmount: agg._sum.salary ?? 0 },
    });
  }));

  return NextResponse.json({ ok: true, count: entryIds.length });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const { entryIds, isPaid } = await req.json() as { entryIds: string[]; isPaid: boolean };
  if (!Array.isArray(entryIds) || entryIds.length === 0)
    return NextResponse.json({ error: "entryIds required" }, { status: 400 });

  await prisma.payrollEntry.updateMany({
    where: { id: { in: entryIds } },
    data: { isPaid },
  });

  return NextResponse.json({ ok: true, count: entryIds.length });
}
