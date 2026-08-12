import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { requireRead, requireWrite } from "@/lib/permissions";

export async function GET() {
  const denied = await requireRead("people");
  if (denied) return denied;
  const people = await prisma.person.findMany({
    select: { id: true, name: true, jobTitle: true, salary: true, salaryCurrency: true },
    orderBy: { name: "asc" },
  });

  // Payroll-only employees: entries with no linked Person, deduplicated by name
  const payrollEntries = await prisma.payrollEntry.findMany({
    where: { personId: null },
    select: { employeeName: true, salary: true, currency: true },
  });
  const personNames = new Set(people.map((p) => p.name.toLowerCase()));
  const payrollOnlyMap = new Map<string, { name: string; salary: number | null; currency: string | null }>();
  for (const e of payrollEntries) {
    const key = e.employeeName.toLowerCase();
    if (!payrollOnlyMap.has(key) && !personNames.has(key)) {
      payrollOnlyMap.set(key, { name: e.employeeName, salary: e.salary, currency: e.currency });
    }
  }
  const payrollOnly = Array.from(payrollOnlyMap.values()).map((e) => ({
    id: null as string | null,
    name: e.name,
    jobTitle: null as string | null,
    salary: e.salary,
    salaryCurrency: e.currency,
    payrollOnly: true,
  }));

  return NextResponse.json({
    people: [
      ...people.map((p) => ({ ...p, payrollOnly: false })),
      ...payrollOnly,
    ],
  });
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export async function POST(req: NextRequest) {
  const denied = await requireWrite("people");
  if (denied) return denied;

  const body = await req.json();

  const name  = body.name?.trim();
  const email = body.email?.trim();
  if (!name)  return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });

  const salary         = body.salary != null && body.salary !== "" ? parseFloat(body.salary) : null;
  const salaryCurrency = body.salaryCurrency?.trim() || "AED";
  const contractStart  = body.contractStart ? new Date(body.contractStart) : null;
  const contractEnd    = body.contractEnd   ? new Date(body.contractEnd)   : null;

  const employmentType = body.employmentType === "parttime" ? "parttime" : "fulltime";
  const weeklyHours    = body.weeklyHours != null && body.weeklyHours !== "" ? parseFloat(body.weeklyHours) : (employmentType === "fulltime" ? 40 : 20);

  const person = await prisma.person.create({
    data: {
      name,
      email,
      jobTitle:    body.jobTitle?.trim()    || null,
      department:  body.department?.trim()  || null,
      nationality: body.nationality?.trim() || null,
      contractStart,
      contractEnd,
      salary,
      salaryCurrency,
      employmentType,
      weeklyHours,
    },
  });

  // Auto-populate payroll runs for every month in the contract period
  if (salary !== null && contractStart) {
    const end = contractEnd ?? contractStart; // if no end date, only create for start month

    // Enumerate months from contractStart to contractEnd inclusive
    const startMonth = contractStart.getMonth() + 1;
    const startYear  = contractStart.getFullYear();
    const endMonth   = end.getMonth() + 1;
    const endYear    = end.getFullYear();

    const months: { month: number; year: number }[] = [];
    let y = startYear, m = startMonth;
    while (y < endYear || (y === endYear && m <= endMonth)) {
      months.push({ month: m, year: y });
      m++;
      if (m > 12) { m = 1; y++; }
    }

    const runIdMap = new Map<string, string>();

    for (const { month, year } of months) {
      const key = `${month}-${year}`;
      let run = await prisma.payrollRun.findFirst({ where: { month, year } });
      if (!run) {
        run = await prisma.payrollRun.create({
          data: {
            period: `${MONTH_NAMES[month - 1]} ${year}`,
            month, year,
            totalAmount: null,
            currency: salaryCurrency,
          },
        });
      }
      runIdMap.set(key, run.id);
    }

    // Add PayrollEntry for each month where this person isn't already present
    const runsWithNewEntries = new Set<string>();
    for (const { month, year } of months) {
      const runId = runIdMap.get(`${month}-${year}`)!;
      const existing = await prisma.payrollEntry.findFirst({
        where: { payrollRunId: runId, personId: person.id },
      });
      if (!existing) {
        await prisma.payrollEntry.create({
          data: {
            payrollRunId: runId,
            personId:     person.id,
            employeeName: name,
            salary,
            currency:     salaryCurrency,
          },
        });
        runsWithNewEntries.add(runId);
      }
    }

    // Recompute totals; reset isProcessed on runs that received new entries
    for (const runId of new Set(runIdMap.values())) {
      const agg = await prisma.payrollEntry.aggregate({
        where: { payrollRunId: runId },
        _sum: { salary: true },
      });
      const updateData: { totalAmount: number; isProcessed?: boolean } = {
        totalAmount: agg._sum.salary ?? 0,
      };
      if (runsWithNewEntries.has(runId)) updateData.isProcessed = false;
      await prisma.payrollRun.update({ where: { id: runId }, data: updateData });
    }
  }

  // Link any existing payroll-only entries (personId=null) that match this name
  await prisma.payrollEntry.updateMany({
    where: { personId: null, employeeName: { equals: name, mode: "insensitive" } },
    data:  { personId: person.id },
  });

  await audit({ action: "employee.created", entityType: "person", entityId: person.id, entityLabel: person.name, details: { jobTitle: person.jobTitle, salary: person.salary, currency: person.salaryCurrency } });
  return NextResponse.json(person, { status: 201 });
}
