import { NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const { employeeNames, budgetId } = await req.json();

  if (!Array.isArray(employeeNames) || employeeNames.length === 0) {
    return NextResponse.json({ error: "employeeNames required" }, { status: 400 });
  }

  const isRemoving = !budgetId;

  // When assigning: only touch past and current month runs — don't speculatively set future months.
  // When removing: clear all entries for this person regardless of run date,
  //   so stale assignments on any future-month entries are also wiped.
  const now = new Date();
  const nowMonth = now.getMonth() + 1;
  const nowYear  = now.getFullYear();

  const { count } = await prisma.payrollEntry.updateMany({
    where: {
      employeeName: { in: employeeNames },
      ...(!isRemoving && {
        payrollRun: {
          OR: [
            { year: { lt: nowYear } },
            { year: nowYear, month: { lte: nowMonth } },
          ],
        },
      }),
    },
    data: { budgetId: budgetId || null },
  });

  return NextResponse.json({ updated: count });
}
