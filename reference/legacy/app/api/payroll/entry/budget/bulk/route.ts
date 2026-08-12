import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";

export async function PATCH(req: NextRequest) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const { entryIds, budgetId } = await req.json() as { entryIds: string[]; budgetId: string | null };
  if (!Array.isArray(entryIds) || entryIds.length === 0)
    return NextResponse.json({ error: "entryIds required" }, { status: 400 });

  const { count } = await prisma.payrollEntry.updateMany({
    where: { id: { in: entryIds } },
    data:  { budgetId: budgetId ?? null },
  });

  return NextResponse.json({ ok: true, count });
}
