import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/audit";

// DELETE /api/payroll/staff
// Body: { employeeName: string; personId: string | null; removeFromPayroll: boolean }
// Removes a staff member. If removeFromPayroll, deletes all their payroll entries and
// recomputes run totals. If personId is set, deletes the Person profile too.
export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const employeeName: string = body.employeeName?.trim();
  const personId: string | null = body.personId ?? null;
  const removeFromPayroll: boolean = body.removeFromPayroll ?? false;

  if (!employeeName) {
    return NextResponse.json({ error: "employeeName required" }, { status: 400 });
  }

  if (removeFromPayroll) {
    // Find all matching entries to know which runs need totals recomputed
    const entries = await prisma.payrollEntry.findMany({
      where: {},
      select: { id: true, employeeName: true, payrollRunId: true },
    });
    const matching = entries.filter(
      (e) => e.employeeName.trim().toLowerCase() === employeeName.toLowerCase()
    );
    const affectedRunIds = [...new Set(matching.map((e) => e.payrollRunId))];
    const matchingIds = matching.map((e) => e.id);

    if (matchingIds.length > 0) {
      await prisma.payrollEntry.deleteMany({ where: { id: { in: matchingIds } } });

      // Recompute totals for affected runs
      for (const runId of affectedRunIds) {
        const agg = await prisma.payrollEntry.aggregate({
          where: { payrollRunId: runId },
          _sum: { salary: true },
        });
        await prisma.payrollRun.update({
          where: { id: runId },
          data: { totalAmount: agg._sum.salary ?? 0 },
        });
      }
    }
  } else if (personId) {
    // Keep entries but unlink the person profile
    await prisma.payrollEntry.updateMany({
      where: { personId },
      data: { personId: null },
    });
  }

  // Delete the Person profile if provided
  if (personId) {
    await prisma.person.delete({ where: { id: personId } }).catch(() => null);
  }

  await audit({ action: "employee.deleted", entityType: "person", entityId: personId ?? undefined, entityLabel: employeeName, details: { removeFromPayroll } });
  return NextResponse.json({ success: true });
}
