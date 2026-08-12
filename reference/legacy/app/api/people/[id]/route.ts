import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { requireWrite } from "@/lib/permissions";
import { syncPayrollForExit } from "@/lib/payrollExitSync";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("people");
  if (denied) return denied;

  const { id } = await params;
  const deletePayroll = req.nextUrl.searchParams.get("deletePayroll") === "true";

  const person = await prisma.person.findUnique({ where: { id }, select: { name: true } });

  if (deletePayroll) {
    await prisma.payrollEntry.deleteMany({ where: { personId: id } });
  }

  await prisma.person.delete({ where: { id } });
  await audit({ action: "employee.deleted", entityType: "person", entityId: id, entityLabel: person?.name ?? id });
  return NextResponse.json({ success: true });
}

// Returns the base (full-month) contract salary for a given person+month from their PaymentSchedule.
// Returns null if no schedule entry exists for that month.
async function getContractSalaryForMonth(personId: string, year: number, month: number): Promise<number | null> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const schedule = await prisma.paymentSchedule.findFirst({
    where: {
      document: { person: { id: personId }, docType: "employee_contract" },
      dueDate: { gte: monthStart, lt: monthEnd },
    },
    select: { amount: true },
  });
  return schedule?.amount ?? null;
}

const MONTH_NAMES_CONTRACT = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// Ensures a PayrollRun and PayrollEntry exist for every month in [contractStart, contractEnd].
// Pro-rates salary for the starting and ending months if they fall mid-month.
// For the ending month: always syncs the unpaid entry so contractEnd changes are reflected.
async function syncPayrollForContract(
  personId: string,
  personName: string,
  salary: number,
  currency: string,
  contractStart: Date,
  contractEnd: Date,
) {
  const startMonth = contractStart.getMonth() + 1;
  const startYear  = contractStart.getFullYear();
  const endMonth   = contractEnd.getMonth() + 1;
  const endYear    = contractEnd.getFullYear();

  const months: { month: number; year: number }[] = [];
  let y = startYear, m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    months.push({ month: m, year: y });
    m++;
    if (m > 12) { m = 1; y++; }
  }

  const runIdMap = new Map<string, string>();
  for (const { month, year } of months) {
    let run = await prisma.payrollRun.findFirst({ where: { month, year } });
    if (!run) {
      run = await prisma.payrollRun.create({
        data: { period: `${MONTH_NAMES_CONTRACT[month - 1]} ${year}`, month, year, totalAmount: null, currency },
      });
    }
    runIdMap.set(`${month}-${year}`, run.id);
  }

  const runsWithNewEntries = new Set<string>();
  for (const { month, year } of months) {
    const runId = runIdMap.get(`${month}-${year}`)!;
    const existing = await prisma.payrollEntry.findFirst({ where: { payrollRunId: runId, personId } });

    // Compute salary for boundary months
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd   = new Date(year, month, 1);

    // Use per-month PaymentSchedule amount when available; fall back to flat salary
    const scheduleEntry = await prisma.paymentSchedule.findFirst({
      where: {
        document: { person: { id: personId }, docType: "employee_contract" },
        dueDate: { gte: monthStart, lt: monthEnd },
      },
      select: { amount: true, currency: true },
    });
    const baseSalaryForMonth = scheduleEntry?.amount ?? salary;
    const baseCurrencyForMonth = scheduleEntry?.currency ?? currency;

    let entrySalary = baseSalaryForMonth;
    let entryNote: string | null = null;

    const isEndingMonth  = year === endYear  && month === endMonth  && contractEnd   >= monthStart && contractEnd   < monthEnd;
    const isStartingMonth = year === startYear && month === startMonth && contractStart > monthStart;

    if (isEndingMonth) {
      const d = contractEnd.getDate();
      entrySalary = Math.round((baseSalaryForMonth / 30) * d * 100) / 100;
      entryNote   = `Pro-rated: ${d}/30 days`;
    } else if (isStartingMonth) {
      const daysInMonth = new Date(year, month, 0).getDate();
      const d = daysInMonth - contractStart.getDate();
      entrySalary = Math.round((baseSalaryForMonth / 30) * d * 100) / 100;
      entryNote   = `Pro-rated: ${d}/30 days`;
    }

    if (!existing) {
      await prisma.payrollEntry.create({
        data: { payrollRunId: runId, personId, employeeName: personName, salary: entrySalary, currency: baseCurrencyForMonth, note: entryNote },
      });
      runsWithNewEntries.add(runId);
    } else if (isEndingMonth && !existing.isPaid) {
      // Contract end date may have changed — always sync the ending month entry so
      // pro-rata reflects the current contractEnd, as long as it hasn't been paid.
      await prisma.payrollEntry.update({
        where: { id: existing.id },
        data: { salary: entrySalary, currency: baseCurrencyForMonth, note: entryNote },
      });
      runsWithNewEntries.add(runId);
    } else if (isStartingMonth && !existing.isPaid) {
      // Renewal overlap: the old contract's pro-rated portion for this month already exists.
      // Add the new contract's starting portion on top so the employee is paid for the full month.
      const oldDays = existing.note?.match(/Pro-rated: (\d+)\/30 days/)?.[1] ?? "?";
      const newDays = entryNote?.match(/Pro-rated: (\d+)\/30 days/)?.[1] ?? "?";
      const combined = Math.round((existing.salary + entrySalary) * 100) / 100;
      await prisma.payrollEntry.update({
        where: { id: existing.id },
        data: { salary: combined, note: `Renewed: ${oldDays}+${newDays}/30 days` },
      });
      runsWithNewEntries.add(runId);
    }
  }

  for (const runId of new Set(runIdMap.values())) {
    const agg = await prisma.payrollEntry.aggregate({ where: { payrollRunId: runId }, _sum: { salary: true } });
    const upd: { totalAmount: number; isProcessed?: boolean } = { totalAmount: agg._sum.salary ?? 0 };
    if (runsWithNewEntries.has(runId)) upd.isProcessed = false;
    await prisma.payrollRun.update({ where: { id: runId }, data: upd });
  }
}

// PATCH /api/people/[id]
// Body: any subset of { name, jobTitle, department, nationality, email, contractStart, contractEnd, salary, salaryCurrency, exitDate, exitReason }
// When salary/currency change, propagates new values to all unpaid PayrollEntry rows.
// When exitDate changes, immediately syncs payroll: pro-rates exit month, removes future months.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("people");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();

  const person = await prisma.person.findUnique({
    where: { id },
    select: { name: true, jobTitle: true, department: true, nationality: true, email: true, contractStart: true, contractEnd: true, salary: true, salaryCurrency: true, costPerHour: true, billingRate: true, rateCurrency: true, exitDate: true, exitReason: true, employmentType: true, weeklyHours: true },
  });
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  const profileChanges: Record<string, { from: unknown; to: unknown }> = {};

  // String fields
  const strFields: Array<keyof typeof person> = ["name", "jobTitle", "department", "nationality", "email", "exitReason"];
  for (const field of strFields) {
    if (field in body) {
      const newVal = body[field] != null ? String(body[field]).trim() || null : null;
      const curVal = person[field] as string | null;
      if (newVal !== curVal) {
        data[field] = newVal;
        profileChanges[field] = { from: curVal, to: newVal };
      }
    }
  }

  // Name is required
  if ("name" in data && !data.name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Date fields
  for (const field of ["contractStart", "contractEnd", "exitDate"] as const) {
    if (field in body) {
      const newDate = body[field] ? new Date(body[field]) : null;
      const curDate = person[field] as Date | null;
      const newIso = newDate?.toISOString().split("T")[0] ?? null;
      const curIso = curDate?.toISOString().split("T")[0] ?? null;
      if (newIso !== curIso) {
        data[field] = newDate;
        profileChanges[field] = { from: curIso, to: newIso };
      }
    }
  }

  // Labor rates (costPerHour, billingRate, rateCurrency) — track changes for audit
  const rateChanges: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of ["costPerHour", "billingRate"] as const) {
    if (field in body) {
      const val = body[field] != null && body[field] !== "" ? parseFloat(body[field]) : null;
      const newVal = val != null && !isNaN(val) ? val : null;
      data[field] = newVal;
      if (newVal !== person[field]) rateChanges[field] = { from: person[field], to: newVal };
    }
  }
  if ("rateCurrency" in body) {
    const newCurr = body.rateCurrency?.trim() || null;
    data.rateCurrency = newCurr;
    if (newCurr !== person.rateCurrency) rateChanges.rateCurrency = { from: person.rateCurrency, to: newCurr };
  }

  // Employment type + weekly hours
  if ("employmentType" in body) {
    data.employmentType = body.employmentType === "parttime" ? "parttime" : "fulltime";
  }
  if ("weeklyHours" in body) {
    const wh = body.weeklyHours != null && body.weeklyHours !== "" ? parseFloat(body.weeklyHours) : null;
    if (wh !== null && !isNaN(wh) && wh > 0) data.weeklyHours = wh;
  }

  // Payslip currency preference
  if ("payslipInContractCurrency" in body) {
    data.payslipInContractCurrency = body.payslipInContractCurrency === true;
  }

  // Salary
  let newSalary: number | null | undefined;
  let newCurrency: string | null | undefined;
  if ("salary" in body) {
    newSalary = body.salary != null ? parseFloat(body.salary) : null;
    if (newSalary !== null && (isNaN(newSalary) || newSalary < 0)) {
      return NextResponse.json({ error: "Valid salary required" }, { status: 400 });
    }
  }
  if ("salaryCurrency" in body) {
    newCurrency = body.salaryCurrency ?? null;
  }

  const salaryChanged = newSalary !== undefined && newSalary !== person.salary;
  const currencyChanged = newCurrency !== undefined && newCurrency !== person.salaryCurrency;

  if (salaryChanged) data.salary = newSalary;
  if (currencyChanged) data.salaryCurrency = newCurrency;

  // Sync payroll whenever exitDate is explicitly sent, even if the value didn't change.
  // This lets re-saving an existing exit date fix stale payroll entries retroactively.
  const exitDateInBody = "exitDate" in body;

  if (Object.keys(data).length === 0) {
    const syncStart  = person.contractStart;
    const syncEnd    = person.contractEnd;
    const syncSalary = person.salary;
    const syncCur    = person.salaryCurrency ?? "AED";
    if (syncStart && syncEnd && syncSalary != null) {
      await syncPayrollForContract(id, person.name, syncSalary, syncCur, syncStart, syncEnd);
    }
    // Re-apply exit constraints after contract sync — sync may recreate post-exit entries.
    if (person.exitDate) {
      await syncPayrollForExit(id, person.exitDate);
    }
    return NextResponse.json({ success: true });
  }

  await prisma.person.update({ where: { id }, data });

  // Propagate name change to all payroll entries across all months
  if ("name" in data && data.name) {
    await prisma.payrollEntry.updateMany({
      where: { personId: id },
      data: { employeeName: data.name as string },
    });
  }

  if (exitDateInBody) {
    const effectiveExit = ("exitDate" in data) ? (data.exitDate as Date | null) : person.exitDate;
    await syncPayrollForExit(id, effectiveExit);
  }

  // Propagate salary changes to unpaid payroll entries.
  // Skip when a PaymentSchedule exists — per-month schedule amounts are the source of truth.
  if (salaryChanged || currencyChanged) {
    const effectiveSalary = salaryChanged ? newSalary : person.salary;
    const effectiveCurrency = (currencyChanged ? newCurrency : person.salaryCurrency) ?? "AED";
    if (effectiveSalary != null) {
      const scheduleCount = await prisma.paymentSchedule.count({
        where: { document: { person: { id }, docType: "employee_contract" } },
      });
      if (scheduleCount === 0) {
        const affected = await prisma.payrollEntry.findMany({
          where: { personId: id, isPaid: false },
          select: { payrollRunId: true },
          distinct: ["payrollRunId"],
        });
        await prisma.payrollEntry.updateMany({
          where: { personId: id, isPaid: false },
          data: { salary: effectiveSalary, currency: effectiveCurrency },
        });
        for (const { payrollRunId } of affected) {
          const agg = await prisma.payrollEntry.aggregate({ where: { payrollRunId }, _sum: { salary: true } });
          await prisma.payrollRun.update({ where: { id: payrollRunId }, data: { totalAmount: agg._sum.salary ?? 0 } });
        }
      }
    }
    const entityLabel = (data.name as string | undefined) ?? person.name;
    await audit({ action: "employee.salary_updated", entityType: "person", entityId: id, entityLabel, details: { from: person.salary, fromCurrency: person.salaryCurrency, to: newSalary ?? person.salary, toCurrency: newCurrency ?? person.salaryCurrency } });
  }

  // Log labor rate changes
  if (Object.keys(rateChanges).length > 0) {
    const entityLabel = (data.name as string | undefined) ?? person.name;
    await audit({ action: "employee.rate_updated", entityType: "person", entityId: id, entityLabel, details: { changes: rateChanges } });
  }

  // Log non-salary field changes
  const nonSalaryChanges = Object.fromEntries(Object.entries(profileChanges).filter(([k]) => k !== "salary" && k !== "salaryCurrency"));
  if (Object.keys(nonSalaryChanges).length > 0) {
    const entityLabel = (data.name as string | undefined) ?? person.name;
    await audit({ action: "employee.updated", entityType: "person", entityId: id, entityLabel, details: { changes: nonSalaryChanges } });
  }

  // Fill in any missing payroll entries for the full contract period whenever
  // contract dates or salary are touched. This fixes records created by older
  // code that only generated entries for the current year.
  const effectiveContractStart = ("contractStart" in data ? data.contractStart as Date | null : person.contractStart);
  const effectiveContractEnd   = ("contractEnd"   in data ? data.contractEnd   as Date | null : person.contractEnd);
  const effectiveSalaryForSync = salaryChanged ? newSalary : person.salary;
  const effectiveCurrencyForSync = (currencyChanged ? newCurrency : person.salaryCurrency) ?? "AED";
  const effectiveName = (data.name as string | undefined) ?? person.name;

  if (effectiveContractStart && effectiveContractEnd && effectiveSalaryForSync != null) {
    await syncPayrollForContract(
      id,
      effectiveName,
      effectiveSalaryForSync,
      effectiveCurrencyForSync,
      effectiveContractStart,
      effectiveContractEnd,
    );
    // Re-apply exit constraints — contract sync iterates to contractEnd and may
    // recreate entries for months after the exit date. Always run after sync.
    const currentExitDate = "exitDate" in data ? (data.exitDate as Date | null) : person.exitDate;
    if (currentExitDate) {
      await syncPayrollForExit(id, currentExitDate);
    }
  }

  return NextResponse.json({ success: true });
}
