import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";

export async function PATCH(req: NextRequest) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const { entryId, budgetId } = await req.json() as { entryId: string; budgetId: string | null };
  if (!entryId) return NextResponse.json({ error: "entryId required" }, { status: 400 });

  await prisma.payrollEntry.update({
    where: { id: entryId },
    data:  { budgetId: budgetId ?? null },
  });

  return NextResponse.json({ ok: true });
}
