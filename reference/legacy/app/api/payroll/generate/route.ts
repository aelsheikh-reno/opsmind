import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { computeProRata } from "@/lib/prorata";

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// POST /api/payroll/generate
// Body: { month: number, year: number }
// Creates a PayrollRun for the given month populated from employee contract PaymentSchedule entries.
// If a run already exists, only adds employees not yet in it (idempotent sync).
export async function POST(req: NextRequest) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const body = await req.json();
  const month: number = parseInt(body.month);
  const year: number = parseInt(body.year);

  if (!month || !year || month < 1 || month > 12) {
    return NextResponse.json({ error: "Valid month (1-12) and year required" }, { status: 400 });
  }

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);

  // Find all contract PaymentSchedule entries for this month
  const schedules = await prisma.paymentSchedule.findMany({
    where: { dueDate: { gte: monthStart, lt: monthEnd } },
    include: {
      document: {
        select: {
          docType: true,
          person: { select: { id: true, name: true } },
        },
      },
    },
  });

  const contractEntries = schedules.filter(
    (s) => s.document.docType === "employee_contract" && s.document.person !== null
  );

  // Also include employees whose contractEnd falls in this month — their contract's
  // PaymentSchedule ends at the last full month, so they have no entry for this month
  // but still worked partial days and must be pro-rated.
  const schedulePersonIds = new Set(contractEntries.map(s => s.document.person!.id));
  const endingPersons = await prisma.person.findMany({
    where: {
      contractEnd: { gte: monthStart, lt: monthEnd },
      id: { notIn: [...schedulePersonIds] },
      OR: [{ exitDate: null }, { exitDate: { gte: monthStart } }],
    },
    select: { id: true, name: true, contractEnd: true, contractStart: true, exitDate: true, salaryComponents: true },
  });

  // For each ending person, pull their most recent PaymentSchedule entry as salary basis
  type EndingEntry = { person: { id: string; name: string }; amount: number; currency: string; contractStart: Date | null; contractEnd: Date | null; exitDate: Date | null; salaryComponents: string | null };
  const endingEntries: EndingEntry[] = [];
  for (const p of endingPersons) {
    const lastSched = await prisma.paymentSchedule.findFirst({
      where: {
        document: { docType: "employee_contract", person: { id: p.id } },
        dueDate: { lt: monthStart },
      },
      orderBy: { dueDate: "desc" },
      select: { amount: true, currency: true },
    });
    if (lastSched) {
      endingEntries.push({
        person: { id: p.id, name: p.name },
        ...lastSched,
        contractStart: p.contractStart,
        contractEnd: p.contractEnd,
        exitDate: p.exitDate,
        salaryComponents: p.salaryComponents,
      });
    }
  }

  if (contractEntries.length === 0 && endingEntries.length === 0) {
    return NextResponse.json(
      { error: "No active employee contracts found for this month" },
      { status: 404 }
    );
  }

  // Fetch exit info for all persons so we can skip/pro-rate as needed
  const personIds = [...new Set(contractEntries.map(s => s.document.person!.id))];
  const exitMap = new Map<string, { exitDate: Date | null; contractStart: Date | null; contractEnd: Date | null; salaryComponents: string | null }>();
  if (personIds.length > 0) {
    const persons = await prisma.person.findMany({
      where: { id: { in: personIds } },
      select: { id: true, exitDate: true, contractStart: true, contractEnd: true, salaryComponents: true },
    });
    persons.forEach(p => exitMap.set(p.id, p));
  }

  // Get or create the PayrollRun for this month
  let run = await prisma.payrollRun.findFirst({ where: { month, year } });
  if (!run) {
    run = await prisma.payrollRun.create({
      data: {
        period: `${MONTH_NAMES[month - 1]} ${year}`,
        month,
        year,
        totalAmount: null,
        currency: contractEntries[0]?.currency ?? endingEntries[0]?.currency ?? "USD",
      },
    });
  }

  // Avoid duplicating employees already in the run
  const existingEntries = await prisma.payrollEntry.findMany({
    where: { payrollRunId: run.id },
    select: { personId: true },
  });
  const existingPersonIds = new Set(existingEntries.map((e) => e.personId).filter(Boolean));

  const toCreate = contractEntries.filter(
    (s) => s.document.person && !existingPersonIds.has(s.document.person.id)
  );

  for (const schedule of toCreate) {
    const person = schedule.document.person!;
    const exit = exitMap.get(person.id);

    // Skip entirely if the employee exited before this payroll month
    if (exit?.exitDate && exit.exitDate < monthStart) continue;

    // Only pass salaryComponents if they're tiered (have periodType) OR their flat sum
    // matches the schedule amount. Flat components that don't match the scheduled amount
    // mean the schedule was computed from a different tier — skip the breakdown to avoid
    // showing all components (e.g. quarterly bonus) on months it doesn't apply.
    let componentsForEntry: string | null = exit?.salaryComponents ?? null;
    if (componentsForEntry) {
      try {
        const parsed = JSON.parse(componentsForEntry) as Array<{ amount: number; periodType?: string }>;
        const hasTiers = parsed.some((c) => c.periodType);
        if (!hasTiers) {
          const flatSum = parsed.reduce((s, c) => s + c.amount, 0);
          if (Math.abs(flatSum - schedule.amount) > 0.01) componentsForEntry = null;
        }
      } catch { componentsForEntry = null; }
    }

    const proRata = computeProRata(
      schedule.amount,
      componentsForEntry,
      month,
      year,
      exit?.contractStart ?? null,
      exit?.contractEnd ?? null,
      exit?.exitDate ?? null,
    );

    await prisma.payrollEntry.create({
      data: {
        payrollRunId: run.id,
        personId: person.id,
        employeeName: person.name,
        salary: proRata.salary,
        currency: schedule.currency,
        note: proRata.note,
        salaryComponents: proRata.components,
      },
    });
  }

  // Process employees whose contract ends mid-month (no schedule entry for this month)
  for (const entry of endingEntries) {
    if (existingPersonIds.has(entry.person.id)) continue;

    let endingComponents: string | null = entry.salaryComponents;
    if (endingComponents) {
      try {
        const parsed = JSON.parse(endingComponents) as Array<{ amount: number; periodType?: string }>;
        const hasTiers = parsed.some((c) => c.periodType);
        if (!hasTiers) {
          const flatSum = parsed.reduce((s, c) => s + c.amount, 0);
          if (Math.abs(flatSum - entry.amount) > 0.01) endingComponents = null;
        }
      } catch { endingComponents = null; }
    }

    const proRata = computeProRata(
      entry.amount,
      endingComponents,
      month,
      year,
      entry.contractStart,
      entry.contractEnd,
      entry.exitDate,
    );

    await prisma.payrollEntry.create({
      data: {
        payrollRunId: run.id,
        personId: entry.person.id,
        employeeName: entry.person.name,
        salary: proRata.salary,
        currency: entry.currency,
        note: proRata.note,
        salaryComponents: proRata.components,
      },
    });
  }

  // Recompute total from all entries (including any pre-existing ones)
  const allEntries = await prisma.payrollEntry.findMany({
    where: { payrollRunId: run.id },
    select: { salary: true },
  });
  const updateData: { totalAmount: number; isProcessed?: boolean } = {
    totalAmount: allEntries.reduce((s, e) => s + e.salary, 0),
  };
  const addedCount = toCreate.length + endingEntries.filter(e => !existingPersonIds.has(e.person.id)).length;
  if (addedCount > 0) updateData.isProcessed = false;
  await prisma.payrollRun.update({ where: { id: run.id }, data: updateData });

  return NextResponse.json({
    success: true,
    runId: run.id,
    added: addedCount,
    total: allEntries.length,
  });
}
