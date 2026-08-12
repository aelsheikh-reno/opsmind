import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { generateAlerts } from "@/lib/extract";
import { audit } from "@/lib/audit";
import { getBestMonthRates } from "@/lib/fx";

interface ScheduleEntry {
  dueDate: string;
  amount: number;
  currency: string;
  description?: string;
}

export async function POST(request: NextRequest) {
  const denied = await requireWrite("contracts");
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    docType,
    filename,
    parties: partiesRaw,
    referenceNumber,
    issueDate,
    expiryDate,
    renewalDeadline,
    amount,
    currency,
    paymentTerms,
    notes,
    summary,
    // employee_contract extras
    employeeName,
    jobTitle,
    department,
    nationality,
    employmentType,
    weeklyHours,
    payslipInContractCurrency,
    // payment schedule
    paymentSchedule: scheduleRaw,
  } = body;

  if (!docType || typeof docType !== "string") {
    return NextResponse.json({ error: "docType is required" }, { status: 400 });
  }
  if (!filename || typeof filename !== "string" || !filename.trim()) {
    return NextResponse.json({ error: "filename is required" }, { status: 400 });
  }

  const parties: string[] = Array.isArray(partiesRaw)
    ? (partiesRaw as string[]).map((p) => String(p).trim()).filter(Boolean)
    : [];

  const schedule: ScheduleEntry[] = Array.isArray(scheduleRaw)
    ? (scheduleRaw as ScheduleEntry[]).filter((e) => e.dueDate && e.amount)
    : [];

  const doc = await prisma.document.create({
    data: {
      filename: filename.trim(),
      mimeType: "application/manual",
      source: "manual",
      status: "manual",
      docType,
      confidence: 1.0,
      parties: parties.length ? JSON.stringify(parties) : null,
      referenceNumber: typeof referenceNumber === "string" ? referenceNumber.trim() || null : null,
      issueDate: typeof issueDate === "string" && issueDate ? new Date(issueDate) : null,
      expiryDate: typeof expiryDate === "string" && expiryDate ? new Date(expiryDate) : null,
      renewalDeadline: typeof renewalDeadline === "string" && renewalDeadline ? new Date(renewalDeadline) : null,
      amount: typeof amount === "number" ? amount : null,
      currency: typeof currency === "string" ? currency || null : null,
      paymentTerms: typeof paymentTerms === "string" ? paymentTerms.trim() || null : null,
      notes: typeof notes === "string" ? notes.trim() || null : null,
      summary: typeof summary === "string" ? summary.trim() || null : null,
    },
  });

  // Create Person for employee contracts
  let createdPerson: { id: string } | null = null;
  if (docType === "employee_contract" && typeof employeeName === "string" && employeeName.trim()) {
    // Use first schedule entry's amount as salary if no top-level amount given
    const salaryFromSchedule = schedule.length > 0 ? Number(schedule[0].amount) : null;
    const currencyFromSchedule = schedule.length > 0 ? schedule[0].currency : null;
    createdPerson = await prisma.person.create({
      data: {
        name: employeeName.trim(),
        jobTitle: typeof jobTitle === "string" ? jobTitle.trim() || null : null,
        department: typeof department === "string" ? department.trim() || null : null,
        nationality: typeof nationality === "string" ? nationality.trim() || null : null,
        salary: typeof amount === "number" ? amount : salaryFromSchedule,
        salaryCurrency: typeof currency === "string" ? currency || null : (currencyFromSchedule ?? null),
        contractStart: typeof issueDate === "string" && issueDate ? new Date(issueDate) : null,
        contractEnd: typeof expiryDate === "string" && expiryDate ? new Date(expiryDate) : null,
        employmentType: typeof employmentType === "string" ? employmentType : "fulltime",
        weeklyHours: typeof weeklyHours === "number" ? weeklyHours : 40,
        payslipInContractCurrency: typeof payslipInContractCurrency === "boolean" ? payslipInContractCurrency : false,
        documentId: doc.id,
      },
    });

    // Re-link any historical payroll entries that were unlinked (personId: null) matching by name
    await prisma.payrollEntry.updateMany({
      where: { personId: null, employeeName: { equals: employeeName.trim(), mode: "insensitive" } },
      data:  { personId: createdPerson.id },
    });
  }

  // Create alerts
  const alertData = generateAlerts(
    doc.id,
    docType,
    typeof expiryDate === "string" && expiryDate ? expiryDate : null,
    typeof renewalDeadline === "string" && renewalDeadline ? renewalDeadline : null,
    parties,
  );
  if (alertData.length > 0) {
    await prisma.alert.createMany({ data: alertData });
  }

  // Create payment schedule
  if (schedule.length > 0) {
    const now = new Date();

    // Pre-fetch per-month rates for non-USD entries (deduped by year+month)
    const monthRateCache = new Map<string, Record<string, number>>();
    for (const e of schedule) {
      if (e.currency === "USD") continue;
      const d = new Date(e.dueDate);
      const mk = `${d.getFullYear()}_${d.getMonth() + 1}`;
      if (!monthRateCache.has(mk)) {
        monthRateCache.set(mk, await getBestMonthRates(d.getFullYear(), d.getMonth() + 1));
      }
    }

    await prisma.paymentSchedule.createMany({
      data: schedule.map((e) => {
        const d = new Date(e.dueDate);
        const mk = `${d.getFullYear()}_${d.getMonth() + 1}`;
        const rates = e.currency !== "USD" ? monthRateCache.get(mk) : undefined;
        return {
          documentId: doc.id,
          dueDate: d,
          amount: Number(e.amount),
          currency: e.currency,
          description: e.description?.trim() || null,
          ...(rates ? { fxRateSnapshot: JSON.stringify(rates) } : {}),
        };
      }),
    });

    // Payment-due alerts 7 days before each upcoming installment
    const paymentAlerts = schedule
      .map((e) => {
        const due = new Date(e.dueDate);
        const reminder = new Date(due);
        reminder.setDate(reminder.getDate() - 7);
        if (reminder <= now) return null;
        return {
          documentId: doc.id,
          type: "payment_due",
          dueDate: reminder,
          message: `Payment due ${e.dueDate}: ${e.currency} ${Number(e.amount).toLocaleString()}${e.description ? ` — ${e.description}` : ""}`,
        };
      })
      .filter(Boolean) as { documentId: string; type: string; dueDate: Date; message: string }[];

    if (paymentAlerts.length > 0) {
      await prisma.alert.createMany({ data: paymentAlerts });
    }
  }

  // Create PayrollRun + PayrollEntry records for employment contract schedule
  if (docType === "employee_contract" && createdPerson && schedule.length > 0) {
    const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const affectedRunIds = new Set<string>();
    const empName = (typeof employeeName === "string" ? employeeName.trim() : "") || "";

    for (const entry of schedule) {
      const d = new Date(entry.dueDate);
      const month = d.getMonth() + 1;
      const year  = d.getFullYear();

      let run = await prisma.payrollRun.findFirst({ where: { month, year } });
      if (!run) {
        run = await prisma.payrollRun.create({
          data: {
            period:      `${MONTHS[month - 1]} ${year}`,
            month,
            year,
            totalAmount: null,
            currency:    entry.currency,
          },
        });
      }
      if (run.isProcessed) continue;

      const existing = await prisma.payrollEntry.findFirst({
        where: { payrollRunId: run.id, personId: createdPerson.id },
      });
      if (existing) continue;

      await prisma.payrollEntry.create({
        data: {
          payrollRunId: run.id,
          personId:     createdPerson.id,
          employeeName: empName,
          salary:       Number(entry.amount),
          currency:     entry.currency,
          note:         entry.description?.trim() || null,
        },
      });
      affectedRunIds.add(run.id);
    }

    for (const runId of affectedRunIds) {
      const agg = await prisma.payrollEntry.aggregate({ where: { payrollRunId: runId }, _sum: { salary: true } });
      await prisma.payrollRun.update({ where: { id: runId }, data: { totalAmount: agg._sum.salary ?? 0 } });
    }
  }

  await audit({
    action: "document.uploaded",
    entityType: "document",
    entityId: doc.id,
    entityLabel: filename.trim(),
    details: { docType, source: "manual" },
  });

  return NextResponse.json({ id: doc.id });
}
