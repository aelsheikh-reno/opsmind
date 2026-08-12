import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

// PATCH /api/payroll/link
// Body: { employeeName: string; personId: string | null }
// Links or unlinks ALL payroll entries sharing that employee name (case-insensitive trim match)
export async function PATCH(req: NextRequest) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const body = await req.json();
  const employeeName: string = body.employeeName?.trim();
  const personId: string | null = body.personId ?? null;

  if (!employeeName) return NextResponse.json({ error: "employeeName required" }, { status: 400 });

  // Find all entries whose trimmed lower-case name matches
  const entries = await prisma.payrollEntry.findMany({
    where: {},
    select: { id: true, employeeName: true },
  });

  const ids = entries
    .filter(e => e.employeeName.trim().toLowerCase() === employeeName.toLowerCase())
    .map(e => e.id);

  if (ids.length === 0) return NextResponse.json({ updated: 0 });

  await prisma.payrollEntry.updateMany({
    where: { id: { in: ids } },
    data: { personId },
  });

  return NextResponse.json({ success: true, updated: ids.length });
}
