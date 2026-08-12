import { NextRequest, NextResponse } from "next/server";
import { requireRead } from "@/lib/permissions";
import { getExitMonthBaseSalary } from "@/lib/payrollExitSync";

// GET /api/people/[id]/exit-preview?exitDate=YYYY-MM-DD
// Read-only preview of the full-month salary the exit-month pro-ration would use —
// the previous month's payroll entry, per UAE Labour Law standard (÷ 30 days).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRead("payroll");
  if (denied) return denied;

  const { id } = await params;
  const exitDateStr = req.nextUrl.searchParams.get("exitDate");
  if (!exitDateStr) return NextResponse.json({ error: "exitDate is required" }, { status: 400 });

  const exitDate = new Date(exitDateStr);
  if (isNaN(exitDate.getTime())) return NextResponse.json({ error: "Invalid exitDate" }, { status: 400 });

  const base = await getExitMonthBaseSalary(id, exitDate);
  return NextResponse.json({ base });
}
