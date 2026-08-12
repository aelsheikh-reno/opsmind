import { NextRequest, NextResponse } from "next/server";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { computeProRata } from "@/lib/prorata";
import { syncPayrollForExit } from "@/lib/payrollExitSync";
import { uploadFile, downloadFile } from "@/lib/storage";

type SalaryComponent = {
  name: string;
  amount: number;
  periodType?: "quarter" | "month" | "year";
  periodIndex?: number; // 1-based
};

type PersonPatch = {
  name?: string;
  jobTitle?: string;
  department?: string;
  nationality?: string;
  salary?: number;
  salaryCurrency?: string;
  salaryComponents?: string;
  contractStart?: Date;
  contractEnd?: Date;
};

// Detect Q1/Q2/Quarter1/Month1/Year1 style period markers in a normalised key,
// plus range notation in the raw key ("months 1-3", "Basic Salary 4-6", "7 to 9").
function detectPeriod(norm: string, raw?: string): { type: "quarter" | "month" | "year" | null; index: number } {
  // Range notation: "1-3" → Q1, "4-6" → Q2, "7-9" → Q3, "10-12" → Q4
  // Checked on the raw key so hyphens are still present (normalization strips them).
  if (raw) {
    const rm = raw.match(/(\d{1,2})\s*(?:[-–]|to)\s*(\d{1,2})/i);
    if (rm) {
      const start = parseInt(rm[1]);
      if (start >= 1  && start <= 3)  return { type: "quarter", index: 1 };
      if (start >= 4  && start <= 6)  return { type: "quarter", index: 2 };
      if (start >= 7  && start <= 9)  return { type: "quarter", index: 3 };
      if (start >= 10 && start <= 12) return { type: "quarter", index: 4 };
    }
  }
  let m: RegExpMatchArray | null;
  if ((m = norm.match(/q([1-4])/)))           return { type: "quarter", index: parseInt(m[1]) };
  if ((m = norm.match(/quarter([1-4])/)))      return { type: "quarter", index: parseInt(m[1]) };
  if ((m = norm.match(/month(\d{1,2})/)))      return { type: "month",   index: parseInt(m[1]) };
  if ((m = norm.match(/year([1-9])/)))         return { type: "year",    index: parseInt(m[1]) };
  return { type: null, index: 0 };
}


// Map filled form fields back to Person record fields using the same keyword logic as autoFill.
function extractPersonUpdates(fields: Record<string, string>): PersonPatch {
  const patch: PersonPatch = {};
  const components: SalaryComponent[] = [];

  for (const [key, raw] of Object.entries(fields)) {
    const value = raw.trim();
    if (!value) continue;
    const norm = key.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (norm.includes("name") && !norm.includes("company") && !norm.includes("employer") && !norm.includes("entity") && !norm.includes("organization")) {
      patch.name = value;
    } else if (norm.includes("title") || norm.includes("position") || norm.includes("designation") || norm === "role" || norm === "post") {
      patch.jobTitle = value;
    } else if (norm.includes("department") || norm.includes("dept") || norm.includes("division") || norm.includes("section")) {
      patch.department = value;
    } else if (norm.includes("nationality") || norm.includes("citizenship") || norm.includes("citizen")) {
      patch.nationality = value;
    } else if (norm.includes("currency") || norm === "curr" || key === "__currency__") {
      patch.salaryCurrency = value;
    } else if (
      norm.includes("salary") || norm.includes("wage") || norm.includes("remuneration") ||
      norm.includes("compensation") || norm.includes("allowance") || norm.includes("amount") ||
      norm === "basic" || norm === "pay"
    ) {
      const num = parseFloat(value.replace(/[^0-9.]/g, ""));
      if (!isNaN(num)) {
        const label = key.replace(/[_/]/g, " ").replace(/\s+/g, " ").trim();
        const { type, index } = detectPeriod(norm, key);
        components.push({ name: label, amount: num, ...(type ? { periodType: type, periodIndex: index } : {}) });
      }
    } else if (norm.includes("startdate") || norm.includes("joiningdate") || norm.includes("commencement") || norm.includes("effectivedate") || norm === "start" || norm === "joining" || norm === "from") {
      const d = new Date(value);
      if (!isNaN(d.getTime())) patch.contractStart = d;
    } else if (norm.includes("enddate") || norm.includes("expirydate") || norm.includes("expiry") || norm.includes("termination") || norm === "end" || norm === "until" || norm === "to") {
      const d = new Date(value);
      if (!isNaN(d.getTime())) patch.contractEnd = d;
    }
  }

  if (components.length > 0) {
    const hasTiers = components.some((c) => c.periodType);
    if (hasTiers) {
      // Store the full schedule; set the base salary to period-1's total only
      const tier1 = components.filter((c) => !c.periodType || (c.periodIndex ?? 1) === 1);
      patch.salary = tier1.reduce((s, c) => s + c.amount, 0);
    } else {
      patch.salary = components.reduce((s, c) => s + c.amount, 0);
    }
    patch.salaryComponents = JSON.stringify(components);
  }

  return patch;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  type ConfirmedRow = { dueDate: string; amount: number; currency: string; description: string };
  const { templateId, fields, personName, linkToPersonId, previewOnly, confirmedSchedule } = await req.json() as {
    templateId: string;
    fields: Record<string, string>;
    personName?: string;
    linkToPersonId?: string | null;
    previewOnly?: boolean;
    confirmedSchedule?: ConfirmedRow[];
  };

  // ── Preview mode: compute schedule rows and return — no DB writes ──
  if (previewOnly) {
    const patch    = extractPersonUpdates(fields);
    let salary     = patch.salary ?? null;
    let currency   = patch.salaryCurrency ?? fields["__currency__"] ?? "";
    let start      = patch.contractStart ?? null;
    let end        = patch.contractEnd ?? null;
    let comps      = patch.salaryComponents ?? null;

    if (linkToPersonId && (!salary || !start)) {
      const existing = await prisma.person.findUnique({
        where:  { id: linkToPersonId },
        select: { salary: true, salaryCurrency: true, contractStart: true, contractEnd: true, salaryComponents: true },
      });
      if (existing) {
        salary   = salary   ?? existing.salary   ?? null;
        currency = currency || (existing.salaryCurrency ?? "");
        start    = start    ?? existing.contractStart  ?? null;
        end      = end      ?? existing.contractEnd    ?? null;
        comps    = comps    ?? existing.salaryComponents ?? null;
      }
    }

    const rows: ConfirmedRow[] = [];
    if (salary && start) {
      const horizon = end ?? new Date(start.getFullYear() + 1, start.getMonth(), 1);
      let cursor    = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cursor <= horizon) {
        const m = cursor.getMonth() + 1;
        const y = cursor.getFullYear();
        const pr = computeProRata(salary, comps, m, y, start, end, null);
        rows.push({ dueDate: `${y}-${String(m).padStart(2, "0")}-01`, amount: pr.salary, currency, description: pr.note ?? "Monthly salary" });
        cursor = new Date(y, cursor.getMonth() + 1, 1);
      }
    }
    return NextResponse.json({ schedule: rows });
  }

  const template = await prisma.contractTemplate.findUnique({ where: { id: templateId } });
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const buffer = await downloadFile(template.filePath);

  let docxBuffer: Buffer;
  try {
    const zip = new PizZip(buffer);
    const doc = new Docxtemplater(zip, {
      delimiters: { start: "{{", end: "}}" },
      paragraphLoop: true,
      linebreaks: true,
    });
    const templateFields = Object.fromEntries(Object.entries(fields).filter(([k]) => !k.startsWith("__")));
    doc.render(templateFields);
    docxBuffer = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Generation failed: ${msg}` }, { status: 422 });
  }

  if (linkToPersonId) {
    const personPatch = extractPersonUpdates(fields);

    // Fetch existing person fields so we can fall back if the template didn't fill salary/dates
    const existingPerson = await prisma.person.findUnique({
      where: { id: linkToPersonId },
      select: { salary: true, salaryCurrency: true, contractStart: true, contractEnd: true, documentId: true },
    });

    const filename = `${personName ?? "Employee"} Contract.docx`;
    const savedDoc = await prisma.document.create({
      data: {
        filename,
        source: "manual",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        status: "manual",
        docType: "employee_contract",
      },
    });
    const filePath = await uploadFile(`${savedDoc.id}.docx`, docxBuffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    await prisma.document.update({ where: { id: savedDoc.id }, data: { filePath } });

    // 1. Remove all PaymentSchedule entries from the old contract (fully replaced by new one)
    if (existingPerson?.documentId) {
      await prisma.paymentSchedule.deleteMany({
        where: { documentId: existingPerson.documentId },
      });
    }

    // 1b. Delete unpaid payroll entries for this person from unprocessed runs
    // for the current month onwards — they'll be regenerated from the new schedule.
    const now = new Date();
    await prisma.payrollEntry.deleteMany({
      where: {
        personId: linkToPersonId,
        isPaid: false,
        payrollRun: {
          isProcessed: false,
          OR: [
            { year: { gt: now.getFullYear() } },
            { year: now.getFullYear(), month: { gte: now.getMonth() + 1 } },
          ],
        },
      },
    });

    await prisma.person.update({
      where: { id: linkToPersonId },
      data: { documentId: savedDoc.id, ...personPatch },
    });

    // Fetch canonical name for matching name-only payroll entries
    const personRecord = await prisma.person.findUnique({
      where: { id: linkToPersonId },
      select: { name: true },
    });
    const canonicalName = personRecord?.name ?? personName ?? "";

    const salary = personPatch.salary ?? existingPerson?.salary;
    const currency = personPatch.salaryCurrency ?? existingPerson?.salaryCurrency ?? "";
    const start = personPatch.contractStart ?? existingPerson?.contractStart;
    const end = personPatch.contractEnd ?? existingPerson?.contractEnd;

    // 2. Create monthly PaymentSchedule entries — use user-confirmed schedule if provided
    if (confirmedSchedule && confirmedSchedule.length > 0) {
      await prisma.paymentSchedule.createMany({
        data: confirmedSchedule.map((row) => ({
          documentId:  savedDoc.id,
          dueDate:     new Date(row.dueDate),
          amount:      row.amount,
          currency:    row.currency,
          description: row.description,
        })),
      });
    } else if (salary && start) {
      const horizon = end ?? new Date(start.getFullYear() + 1, start.getMonth(), 1);
      const scheduleRows: { documentId: string; dueDate: Date; amount: number; currency: string; description: string }[] = [];
      let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cursor <= horizon) {
        const m = cursor.getMonth() + 1;
        const y = cursor.getFullYear();
        const proRata = computeProRata(salary, personPatch.salaryComponents ?? null, m, y, start, end ?? null, null);
        scheduleRows.push({
          documentId: savedDoc.id,
          dueDate: new Date(cursor),
          amount: proRata.salary,
          currency,
          description: proRata.note ?? "Monthly salary",
        });
        cursor = new Date(y, cursor.getMonth() + 1, 1);
      }
      if (scheduleRows.length > 0) {
        await prisma.paymentSchedule.createMany({ data: scheduleRows });
      }
    }

    // 2.5. Delete unpaid payroll entries beyond new contract end date
    if (end) {
      const endYear = end.getFullYear();
      const endMonth = end.getMonth() + 1;
      const unpaidWithRun = await prisma.payrollEntry.findMany({
        where: { personId: linkToPersonId, isPaid: false },
        select: {
          id: true,
          payrollRunId: true,
          payrollRun: { select: { month: true, year: true } },
        },
      });
      const beyondEnd = unpaidWithRun.filter((e) => {
        const { year, month } = e.payrollRun;
        if (!year || !month) return false;
        return year > endYear || (year === endYear && month > endMonth);
      });
      if (beyondEnd.length > 0) {
        const beyondRunIds = new Set(beyondEnd.map((e) => e.payrollRunId));
        await prisma.payrollEntry.deleteMany({ where: { id: { in: beyondEnd.map((e) => e.id) } } });
        for (const runId of beyondRunIds) {
          const agg = await prisma.payrollEntry.aggregate({ where: { payrollRunId: runId }, _sum: { salary: true } });
          await prisma.payrollRun.update({ where: { id: runId }, data: { totalAmount: agg._sum.salary ?? 0 } });
        }
      }
    }

    // 3. Create/update payroll entries for every month in the contract.
    // Read back the salary-type schedule entries that were just saved for this document.
    // This is the authoritative source — it always creates PayrollRun records for months
    // that don't exist yet (fixing the previous Path B bug where only existing runs were updated).
    const PAYROLL_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const personForRun = await prisma.person.findUnique({
      where: { id: linkToPersonId },
      select: { name: true, exitDate: true },
    });

    if (personForRun) {
      const savedSchedule = await prisma.paymentSchedule.findMany({
        where: { documentId: savedDoc.id, scheduleType: "salary" },
        orderBy: { dueDate: "asc" },
      });

      const affectedRunIds = new Set<string>();

      for (const schedRow of savedSchedule) {
        const rowMonth = schedRow.dueDate.getMonth() + 1;
        const rowYear  = schedRow.dueDate.getFullYear();

        // Skip months after exit date
        const monthStart = new Date(rowYear, rowMonth - 1, 1);
        if (personForRun.exitDate && personForRun.exitDate < monthStart) continue;

        let run = await prisma.payrollRun.findFirst({ where: { month: rowMonth, year: rowYear } });
        if (!run) {
          run = await prisma.payrollRun.create({
            data: {
              period:      `${PAYROLL_MONTHS[rowMonth - 1]} ${rowYear}`,
              month:       rowMonth,
              year:        rowYear,
              totalAmount: null,
              currency:    schedRow.currency,
            },
          });
        }
        if (run.isProcessed) continue;

        await prisma.payrollEntry.deleteMany({
          where: {
            payrollRunId: run.id,
            isPaid:       false,
            OR: [
              { personId: linkToPersonId },
              { personId: null, employeeName: { equals: canonicalName, mode: "insensitive" } },
            ],
          },
        });

        const noteVal = schedRow.description && schedRow.description !== "Monthly salary"
          ? schedRow.description
          : null;

        await prisma.payrollEntry.create({
          data: {
            payrollRunId: run.id,
            personId:     linkToPersonId,
            employeeName: personForRun.name,
            salary:       schedRow.amount,
            currency:     schedRow.currency,
            note:         noteVal,
          },
        });

        affectedRunIds.add(run.id);
      }

      for (const runId of affectedRunIds) {
        const agg = await prisma.payrollEntry.aggregate({ where: { payrollRunId: runId }, _sum: { salary: true } });
        await prisma.payrollRun.update({ where: { id: runId }, data: { totalAmount: agg._sum.salary ?? 0 } });
      }

      // The loop above writes the exit month's entry as the raw schedule amount —
      // pro-rate it against the previous month's full payroll here so contract
      // generation/renewal never overwrites the exit-month calculation with an
      // un-prorated figure.
      if (personForRun.exitDate) {
        await syncPayrollForExit(linkToPersonId, personForRun.exitDate);
      }
    }

    // 4. Update document record with contract metadata
    const docMeta: {
      issueDate?: Date;
      expiryDate?: Date | null;
      renewalDeadline?: Date | null;
      amount?: number;
      currency?: string;
    } = { issueDate: new Date() };
    if (end !== undefined) docMeta.expiryDate = end ?? null;
    if (end) {
      const renewal = new Date(end);
      renewal.setDate(renewal.getDate() - 30);
      docMeta.renewalDeadline = renewal;
    }
    if (salary) docMeta.amount = salary;
    if (currency) docMeta.currency = currency;
    await prisma.document.update({ where: { id: savedDoc.id }, data: docMeta });

    const auditDetails = {
      templateName: template.name,
      personName: personName ?? null,
    };
    const auditUser = {
      userId: session.user?.id ?? null,
      userName: session.user?.name ?? null,
    };
    // Log against the document (shows on records detail page)
    await audit({
      action: "contract.generated",
      entityType: "document",
      entityId: savedDoc.id,
      entityLabel: filename,
      details: auditDetails,
      ...auditUser,
    });
    // Log against the person (shows on people detail page)
    await audit({
      action: "contract.generated",
      entityType: "person",
      entityId: linkToPersonId,
      entityLabel: personName ?? null,
      details: auditDetails,
      ...auditUser,
    });
  }

  return new NextResponse(docxBuffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${personName ?? "Employee"} Contract.docx"`,
    },
  });
}
