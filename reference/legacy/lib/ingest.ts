import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { validateDocument, extractDocument, generateAlerts } from "@/lib/extract";
import { findPotentialMatches, smartSimilarity, type PotentialNameMatch } from "@/lib/name-match";
import { audit } from "@/lib/audit";
import { computeProRata, type SalaryComponent } from "@/lib/prorata";
import { generateVatPeriods } from "@/lib/vat";
import { getBestMonthRates } from "@/lib/fx";

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "text/plain": "txt",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
};

const MONTH_NAMES = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const MONTH_NAMES_DISPLAY = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function parsePayrollPeriod(period: string): { month: number | null; year: number | null } {
  const lower = period.toLowerCase();
  const yearMatch = period.match(/\d{4}/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (lower.includes(MONTH_NAMES[i])) return { month: i + 1, year };
  }
  const numeric = period.match(/^(\d{1,2})[\/\-](\d{4})$/) ?? period.match(/^(\d{4})[\/\-](\d{1,2})$/);
  if (numeric) {
    const a = parseInt(numeric[1]), b = parseInt(numeric[2]);
    return a > 12 ? { month: b, year: a } : { month: a, year: b };
  }
  return { month: null, year };
}

async function saveFile(docId: string, buffer: Buffer, mimeType: string): Promise<string> {
  const ext = MIME_TO_EXT[mimeType] ?? "bin";
  return uploadFile(`${docId}.${ext}`, buffer, mimeType);
}

async function findSemanticDuplicate(
  docType: string | null | undefined,
  referenceNumber: string | null | undefined,
  parties: string[],
): Promise<{ id: string; filename: string; message: string } | null> {
  if (!docType) return null;
  const skipPartyMatch = ["invoice", "payroll", "invoice_report"].includes(docType);

  if (referenceNumber) {
    const refMatch = await prisma.document.findFirst({
      where: { docType, referenceNumber, status: { not: "failed" } },
      select: { id: true, filename: true },
    });
    if (refMatch) {
      return {
        id: refMatch.id,
        filename: refMatch.filename,
        message: `A ${docType.replace(/_/g, " ")} with reference "${referenceNumber}" already exists — "${refMatch.filename}".`,
      };
    }
  }

  if (!skipPartyMatch && parties.length > 0) {
    const candidates = await prisma.document.findMany({
      where: { docType, status: { not: "failed" }, parties: { not: null } },
      select: { id: true, filename: true, parties: true },
      take: 500,
    });

    for (const candidate of candidates) {
      let candidateParties: string[];
      try { candidateParties = JSON.parse(candidate.parties ?? "[]"); }
      catch { continue; }
      if (candidateParties.length === 0) continue;

      // Require ALL parties in the new doc to have a counterpart in the existing doc.
      // Using `some` would flag any two contracts sharing a company name as duplicates.
      const hasMatch = parties.every(newParty =>
        candidateParties.some(existingParty =>
          smartSimilarity(newParty, existingParty) >= 0.85
        )
      );

      if (hasMatch) {
        return {
          id: candidate.id,
          filename: candidate.filename,
          message: `A similar ${docType.replace(/_/g, " ")} already exists for "${parties[0]}" — "${candidate.filename}".`,
        };
      }
    }
  }

  return null;
}

export type IngestOptions = {
  replaceId?: string | null;
  forceNew?: boolean;
  source?: string;
  previewExtraction?: import("./extract").DocumentExtraction;
};

export type IngestSuccess = {
  type: "success";
  document: {
    id: string;
    filename: string;
    docType: string | null;
    confidence: number | null;
    parties: string[];
    summary: string | null;
    issueDate: string | null;
    expiryDate: string | null;
    renewalDeadline: string | null;
    amount: number | null;
    currency: string | null;
    referenceNumber: string | null;
    notes: string | null;
  };
  alertsCreated: number;
  potentialMatches: PotentialNameMatch[];
  invoicesCreated: number;
  invoicesSkipped: { label: string; existingId: string }[];
  payrollEntriesCreated: number;
  contractPersonId: string | null;
};

export type IngestResult =
  | { type: "duplicate"; existingDocumentId: string; message: string }
  | { type: "unsupported"; mimeType: string }
  | { type: "rejected"; reason: string }
  | { type: "extraction_failed"; message: string }
  | { type: "api_key_error" }
  | IngestSuccess
  | { type: "error"; message: string };

export async function processDocument(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const { replaceId = null, forceNew = false, source = "upload", previewExtraction } = opts;

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return { type: "unsupported", mimeType };
  }

  const fileHash = createHash("sha256").update(buffer).digest("hex");

  if (!previewExtraction) {
    if (!replaceId && !forceNew) {
      // Mark any stale "processing" documents (stuck for > 30 min) as failed so they don't block re-uploads
      const staleThreshold = new Date(Date.now() - 30 * 60 * 1000);
      await prisma.document.updateMany({
        where: { fileHash, status: "processing", createdAt: { lt: staleThreshold } },
        data: { status: "failed" },
      });

      const hashMatch = await prisma.document.findFirst({
        where: { fileHash, status: { not: "failed" } },
        select: { id: true, filename: true, source: true },
      });
      if (hashMatch) {
        const sourceNote = hashMatch.source === "google-drive" ? " (synced from Google Drive)" : "";
        return {
          type: "duplicate",
          existingDocumentId: hashMatch.id,
          message: `This exact file has already been uploaded as "${hashMatch.filename}"${sourceNote}.`,
        };
      }
    }

    const validation = await validateDocument(buffer, mimeType, filename);
    if (!validation.valid) {
      return { type: "rejected", reason: validation.reason ?? "Document rejected" };
    }
  }

  let extraction: NonNullable<Awaited<ReturnType<typeof extractDocument>>>;

  if (previewExtraction) {
    extraction = previewExtraction;
  } else {
    try {
      const result = await extractDocument(buffer, mimeType, filename);
      if (!result) return { type: "extraction_failed", message: "Could not parse document" };
      extraction = result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("api_key") || message.includes("authentication") || message.includes("401") || message.includes("API key")) {
        return { type: "api_key_error" };
      }
      return { type: "extraction_failed", message };
    }

    if (!replaceId && !forceNew) {
      const dupMatch = await findSemanticDuplicate(
        extraction.docType,
        extraction.referenceNumber,
        extraction.parties ?? [],
      );
      if (dupMatch) {
        return { type: "duplicate", existingDocumentId: dupMatch.id, message: dupMatch.message };
      }
    }
  }

  const doc = replaceId
    ? await prisma.document.update({
        where: { id: replaceId },
        data: { filename, mimeType, fileHash, status: "processing" },
        select: { id: true, mimeType: true, filename: true },
      })
    : await prisma.document.create({
        data: { filename, mimeType, source, status: "processing", fileHash },
      });

  let filePath: string | null = null;
  try {
    filePath = await saveFile(doc.id, buffer, mimeType);
    await prisma.document.update({ where: { id: doc.id }, data: { filePath } });
  } catch (err) {
    if (!replaceId) {
      await prisma.document.update({ where: { id: doc.id }, data: { status: "failed" } });
    }
    console.error("File save error:", err);
    return { type: "error", message: `File storage failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  try {
    const issueDate = extraction.issueDate ? new Date(extraction.issueDate) : null;
    const expiryDate = extraction.expiryDate ? new Date(extraction.expiryDate) : null;
    let renewalDeadline = extraction.renewalDeadline ? new Date(extraction.renewalDeadline) : null;

    if (expiryDate && !renewalDeadline) {
      renewalDeadline = new Date(expiryDate);
      renewalDeadline.setDate(renewalDeadline.getDate() - 90);
    }

    const invoiceAlreadyPaid = extraction.docType === "invoice" && extraction.isPaid === true;

    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: {
        status: "extracted",
        docType: extraction.docType,
        confidence: extraction.confidence,
        parties: JSON.stringify(extraction.parties),
        summary: extraction.summary,
        issueDate,
        expiryDate,
        renewalDeadline,
        amount: extraction.amount,
        vatAmount: extraction.vatAmount,
        currency: extraction.currency,
        issuingCountry: extraction.issuingCountry || null,
        referenceNumber: extraction.referenceNumber,
        paymentTerms: extraction.paymentTerms,
        notes: extraction.notes,
        ...(invoiceAlreadyPaid && {
          isPaid: true,
          paidAt: extraction.paidDate ? new Date(extraction.paidDate) : null,
        }),
      },
    });

    // Auto-assign legal entity from TaxConfig/VatConfig (source of truth)
    if (extraction.docType === "invoice" && !updated.legalEntityId) {
      const [taxCfgs, vatCfgs] = await Promise.all([
        prisma.taxConfig.findMany({ where: { active: true, companyName: { not: null } }, select: { companyName: true, country: true, currency: true } }),
        prisma.vatConfig.findMany({ where: { active: true, companyName: { not: null } }, select: { companyName: true, country: true, currency: true } }),
      ]);

      // Deduplicate by (companyName, country)
      const options = new Map<string, { name: string; country: string; currency: string | null }>();
      for (const c of [...taxCfgs, ...vatCfgs]) {
        if (!c.companyName) continue;
        const key = `${c.companyName.trim().toLowerCase()}|${c.country.trim().toLowerCase()}`;
        if (!options.has(key)) options.set(key, { name: c.companyName.trim(), country: c.country.trim(), currency: c.currency ?? null });
      }

      let matched: { name: string; country: string; currency: string | null } | null = null;

      // 1. Match by company name appearing in invoice parties
      const parties: string[] = extraction.parties ?? [];
      for (const opt of options.values()) {
        if (parties.some(p =>
          p.toLowerCase().includes(opt.name.toLowerCase()) ||
          opt.name.toLowerCase().includes(p.toLowerCase())
        )) {
          matched = opt;
          break;
        }
      }

      // 2. Fall back to issuingCountry — only if exactly one entity for that country
      if (!matched && extraction.issuingCountry) {
        const byCountry = Array.from(options.values()).filter(
          o => o.country.toLowerCase() === extraction.issuingCountry!.toLowerCase()
        );
        if (byCountry.length === 1) matched = byCountry[0];
      }

      if (matched) {
        let entity = await prisma.legalEntity.findFirst({ where: { name: matched.name, country: matched.country } });
        if (!entity) entity = await prisma.legalEntity.create({ data: matched });
        await prisma.document.update({ where: { id: updated.id }, data: { legalEntityId: entity.id } });
      }
    }

    // If this invoice (with a VAT/amount value) falls into a VAT period that's already
    // been marked as paid, unmark it so the user can recalculate before re-filing.
    if (
      extraction.docType === "invoice" &&
      (extraction.vatAmount || extraction.amount) &&
      extraction.currency
    ) {
      const effectiveDate = issueDate ?? updated.createdAt;
      const countryClause = extraction.issuingCountry
        ? { OR: [{ currency: extraction.currency ?? undefined }, { country: { equals: extraction.issuingCountry, mode: "insensitive" as const } }] }
        : { currency: extraction.currency ?? undefined };
      const vatConfigs = await prisma.vatConfig.findMany({
        where: { active: true, ...countryClause },
        include: { payments: { where: { paidAmount: { not: null } } } },
      });
      for (const config of vatConfigs) {
        const periods = generateVatPeriods(
          config.startDate,
          config.frequencyMonths,
          config.anchorMonth,
          config.filingDeadlineDays,
          config.periodsAhead,
        );
        for (const period of periods) {
          if (effectiveDate >= period.periodStart && effectiveDate <= period.periodEnd) {
            const payment = config.payments.find(
              (p) => p.periodStart.getTime() === period.periodStart.getTime()
            );
            if (payment) {
              await prisma.vatPayment.update({
                where: { id: payment.id },
                data: { paidAmount: null, paidAt: null },
              });
            }
            break;
          }
        }
      }
    }

    if (replaceId) {
      await prisma.alert.deleteMany({ where: { documentId: doc.id } });
    }

    const alertData = generateAlerts(
      doc.id,
      extraction.docType,
      extraction.expiryDate,
      renewalDeadline?.toISOString().split("T")[0] ?? null,
      extraction.parties,
    );

    if (alertData.length > 0) {
      await prisma.alert.createMany({ data: alertData });
    }

    if (!replaceId && extraction.paymentSchedule && extraction.paymentSchedule.length > 0) {
      const now = new Date();

      // Drop entries with invalid dates or missing amounts — the AI occasionally
      // returns placeholder strings ("TBD", "") that would cause Prisma to throw.
      const validSchedule = extraction.paymentSchedule.filter(p => {
        const d = new Date(p.dueDate);
        return !isNaN(d.getTime()) && p.amount > 0 && p.currency?.trim();
      });

      if (validSchedule.length > 0) {
        // Pre-fetch per-month rates for non-USD entries (deduped by year+month)
        const monthRateCache = new Map<string, Record<string, number>>();
        for (const p of validSchedule) {
          if (p.currency === "USD") continue;
          const d = new Date(p.dueDate);
          const mk = `${d.getFullYear()}_${d.getMonth() + 1}`;
          if (!monthRateCache.has(mk)) {
            monthRateCache.set(mk, await getBestMonthRates(d.getFullYear(), d.getMonth() + 1));
          }
        }

        await prisma.paymentSchedule.createMany({
          data: validSchedule.map((p) => {
            const d = new Date(p.dueDate);
            const mk = `${d.getFullYear()}_${d.getMonth() + 1}`;
            const rates = p.currency !== "USD" ? monthRateCache.get(mk) : undefined;
            return {
              documentId: doc.id,
              dueDate: d,
              amount: p.amount,
              currency: p.currency,
              description: p.description,
              ...(rates ? { fxRateSnapshot: JSON.stringify(rates) } : {}),
            };
          }),
        });

        const paymentAlerts = validSchedule
          .map((p) => {
            const due = new Date(p.dueDate);
            const reminderDate = new Date(due);
            reminderDate.setDate(reminderDate.getDate() - 7);
            if (reminderDate <= now) return null;
            return {
              documentId: doc.id,
              type: "payment_due",
              dueDate: reminderDate,
              message: `Payment due ${p.dueDate}: ${p.currency} ${p.amount.toLocaleString()} — ${p.description}`,
            };
          })
          .filter(Boolean) as { documentId: string; type: string; dueDate: Date; message: string }[];

        if (paymentAlerts.length > 0) {
          await prisma.alert.createMany({ data: paymentAlerts });
        }
      }
    }

    const potentialMatches: PotentialNameMatch[] = [];
    let contractPersonId: string | null = null;

    if (!replaceId && extraction.docType === "payroll" && extraction.payrollEmployees && extraction.payrollEmployees.length > 0) {
      const defaultCurrency = extraction.currency ?? "AED";
      const allPersons = await prisma.person.findMany();

      const fallbackPeriod = extraction.payrollPeriod ?? "Unknown period";
      const groups = new Map<string, typeof extraction.payrollEmployees>();
      for (const emp of extraction.payrollEmployees) {
        if (!emp.name || !emp.salary) continue;
        const periodKey = emp.month || fallbackPeriod;
        if (!groups.has(periodKey)) groups.set(periodKey, []);
        groups.get(periodKey)!.push(emp);
      }

      for (const [period, employees] of groups) {
        const { month, year } = parsePayrollPeriod(period);

        if (month !== null && year !== null) {
          const existing = await prisma.payrollRun.findFirst({ where: { month, year } });
          if (existing) await prisma.payrollRun.delete({ where: { id: existing.id } });
        }

        const payrollRun = await prisma.payrollRun.create({
          data: {
            period, month, year,
            documentId: groups.size === 1 ? doc.id : null,
            totalAmount: null,
            currency: defaultCurrency,
          },
        });

        let computedTotal = 0;

        for (const emp of employees) {
          computedTotal += emp.salary;

          const normalizedEmp = emp.name.toLowerCase().trim();
          let person = allPersons.find((p) => p.name.toLowerCase().trim() === normalizedEmp) ?? null;

          if (person) {
            await prisma.person.update({
              where: { id: person.id },
              data: { salary: emp.salary, salaryCurrency: emp.currency || defaultCurrency },
            });
          } else {
            person = await prisma.person.create({
              data: {
                name: emp.name,
                salary: emp.salary,
                salaryCurrency: emp.currency || defaultCurrency,
              },
            });
            allPersons.push(person);
            const preExisting = allPersons.filter((p) => p.id !== person!.id);
            potentialMatches.push(...findPotentialMatches(person.id, emp.name, preExisting));
          }

          await prisma.payrollEntry.create({
            data: {
              payrollRunId: payrollRun.id,
              personId: person.id,
              employeeName: emp.name,
              salary: emp.salary,
              currency: emp.currency || defaultCurrency,
            },
          });

          if (month !== null && year !== null && person.documentId) {
            const monthStart = new Date(year, month - 1, 1);
            const monthEnd = new Date(year, month, 1);
            await prisma.paymentSchedule.updateMany({
              where: {
                documentId: person.documentId,
                dueDate: { gte: monthStart, lt: monthEnd },
                isPaid: false,
              },
              data: { isPaid: true },
            });
          }
        }

        await prisma.payrollRun.update({
          where: { id: payrollRun.id },
          data: { totalAmount: computedTotal },
        });
      }

      if (groups.size > 1) {
        const firstRun = await prisma.payrollRun.findFirst({
          where: { documentId: null },
          orderBy: { createdAt: "asc" },
        });
        if (firstRun) {
          await prisma.payrollRun.update({ where: { id: firstRun.id }, data: { documentId: doc.id } });
        }
      }
    }

    let invoicesCreated = 0;
    const invoicesSkipped: { label: string; existingId: string }[] = [];
    if (!replaceId && extraction.docType === "invoice_report" && extraction.invoices && extraction.invoices.length > 0) {
      const now = new Date();
      for (const inv of extraction.invoices) {
        const invRefNum    = inv.referenceNumber || null;
        const invIssueDate = inv.issueDate ? new Date(inv.issueDate) : null;
        const invDueDate   = inv.expiryDate ? new Date(inv.expiryDate) : null;
        const invAmount    = inv.amount || null;
        const invCurrency  = inv.currency || null;
        const invSummary   = inv.summary || null;
        const invNotes     = inv.notes || null;

        if (invRefNum) {
          const existing = await prisma.document.findFirst({
            where: { docType: "invoice", referenceNumber: invRefNum },
            select: { id: true },
          });
          if (existing) {
            const party = (inv.parties ?? [])[0] ?? null;
            const label = party ? `#${invRefNum} · ${party}` : `#${invRefNum}`;
            invoicesSkipped.push({ label, existingId: existing.id });
            continue;
          }
        }

        const invDoc = await prisma.document.create({
          data: {
            filename: invRefNum
              ? `Invoice ${invRefNum}`
              : `Invoice — ${(inv.parties ?? [])[0] ?? "Unknown"}${inv.issueDate ? ` (${inv.issueDate})` : ""}`,
            mimeType: doc.mimeType,
            source: "extracted",
            status: "extracted",
            docType: "invoice",
            confidence: extraction.confidence,
            parties: JSON.stringify(inv.parties ?? []),
            summary: invSummary,
            issueDate: invIssueDate,
            expiryDate: invDueDate,
            amount: invAmount,
            currency: invCurrency,
            referenceNumber: invRefNum,
            notes: invNotes,
            filePath: filePath,
            isPaid: inv.isPaid ?? undefined,
            paidAt: (inv.isPaid && inv.paidDate) ? new Date(inv.paidDate) : null,
          },
        });

        const invAlerts = generateAlerts(invDoc.id, "invoice", inv.expiryDate || null, null, inv.parties ?? []);
        if (invAlerts.length > 0) {
          await prisma.alert.createMany({ data: invAlerts });
        }

        if (invDueDate && invDueDate < now) {
          await prisma.alert.create({
            data: {
              documentId: invDoc.id,
              type: "overdue",
              dueDate: now,
              message: `Invoice overdue${invRefNum ? ` #${invRefNum}` : ""}${(inv.parties ?? [])[0] ? ` — ${(inv.parties ?? [])[0]}` : ""}: ${invCurrency ?? ""} ${invAmount?.toLocaleString() ?? ""}`,
            },
          });
        }

        invoicesCreated++;
      }
    }

    // Build a tiered SalaryComponent[] from a payment schedule.
    // Groups consecutive months with the same amount into periods; when amounts vary,
    // tags components with periodType + periodIndex so prorata can resolve tiers.
    function buildSalaryComponents(
      schedule: { dueDate: string; amount: number; currency: string }[],
      contractStart: Date | null,
    ): { salary: number; currency: string; salaryComponents: string | null } {
      if (!schedule || schedule.length === 0) return { salary: 0, currency: "", salaryComponents: null };

      const sorted = [...schedule].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
      const currency = sorted[0].currency;
      const firstAmount = sorted[0].amount;

      // Check if all amounts are the same → flat salary, no tiers needed
      const allSame = sorted.every((p) => p.amount === firstAmount);
      if (allSame) {
        return { salary: firstAmount, currency, salaryComponents: null };
      }

      // Detect tier boundaries: group consecutive months with the same amount
      const tiers: { amount: number; count: number }[] = [];
      for (const p of sorted) {
        const last = tiers[tiers.length - 1];
        if (last && last.amount === p.amount) {
          last.count++;
        } else {
          tiers.push({ amount: p.amount, count: 1 });
        }
      }

      // Determine period type from typical tier length
      const avgLen = tiers.reduce((s, t) => s + t.count, 0) / tiers.length;
      let periodType: "quarter" | "month" | "year";
      if (avgLen >= 10) periodType = "year";
      else if (avgLen >= 2) periodType = "quarter";
      else periodType = "month";

      const comps: SalaryComponent[] = tiers.map((t, i) => ({
        name: `Salary (${periodType} ${i + 1})`,
        amount: t.amount,
        periodType,
        periodIndex: i + 1,
      }));

      return {
        salary: tiers[0].amount,
        currency,
        salaryComponents: JSON.stringify(comps),
      };
    }

    let payrollEntriesCreated = 0;
    if (!replaceId && extraction.docType === "employee_contract") {
      const personName = extraction.employeeName ?? extraction.parties.find((p) => p) ?? "Unknown";

      // Derive tiered salary components before upserting the person
      const { salary: contractSalary, currency: contractCurrency, salaryComponents } =
        buildSalaryComponents(extraction.paymentSchedule ?? [], issueDate);

      const contractPerson = await prisma.person.upsert({
        where: { documentId: doc.id },
        create: {
          name: personName,
          jobTitle: extraction.jobTitle,
          department: extraction.department || null,
          nationality: extraction.nationality || null,
          contractStart: issueDate,
          contractEnd: expiryDate,
          documentId: doc.id,
          salary: contractSalary || null,
          salaryCurrency: contractCurrency || null,
          salaryComponents: salaryComponents,
        },
        update: {
          name: personName,
          jobTitle: extraction.jobTitle,
          department: extraction.department || null,
          nationality: extraction.nationality || null,
          contractStart: issueDate,
          contractEnd: expiryDate,
          salary: contractSalary || null,
          salaryCurrency: contractCurrency || null,
          salaryComponents: salaryComponents,
        },
      });
      contractPersonId = contractPerson.id;

      const validContractSchedule = (extraction.paymentSchedule ?? []).filter(p => {
        const d = new Date(p.dueDate);
        return !isNaN(d.getTime()) && p.amount > 0 && p.currency?.trim();
      });

      if (validContractSchedule.length > 0) {
        const monthMap = new Map<string, { month: number; year: number; amount: number; currency: string }>();
        for (const payment of validContractSchedule) {
          const d = new Date(payment.dueDate);
          const month = d.getMonth() + 1;
          const year = d.getFullYear();
          const key = `${month}-${year}`;
          if (!monthMap.has(key)) {
            monthMap.set(key, { month, year, amount: payment.amount, currency: payment.currency });
          }
        }

        const runIdMap = new Map<string, string>();
        for (const [key, { month, year, currency }] of monthMap) {
          let run = await prisma.payrollRun.findFirst({ where: { month, year } });
          if (!run) {
            run = await prisma.payrollRun.create({
              data: {
                period: `${MONTH_NAMES_DISPLAY[month - 1]} ${year}`,
                month,
                year,
                totalAmount: null,
                currency,
              },
            });
          }
          runIdMap.set(key, run.id);
        }

        const runsWithNewEntries = new Set<string>();
        for (const [key, { month, year, amount, currency }] of monthMap) {
          const runId = runIdMap.get(key)!;
          const existing = await prisma.payrollEntry.findFirst({
            where: { payrollRunId: runId, personId: contractPerson.id },
          });
          if (!existing) {
            // Use computeProRata so partial first/last months and tiered schedules are handled correctly.
            // For file-uploaded contracts we pass the per-month amount as the base salary; the stored
            // salaryComponents (if tiered) lets computeProRata resolve the correct tier.
            const proRata = computeProRata(
              amount,
              salaryComponents,
              month,
              year,
              issueDate,
              expiryDate,
              null,
            );
            await prisma.payrollEntry.create({
              data: {
                payrollRunId: runId,
                personId: contractPerson.id,
                employeeName: contractPerson.name,
                salary: proRata.salary,
                currency,
                note: proRata.note,
                salaryComponents: proRata.components,
              },
            });
            payrollEntriesCreated++;
            runsWithNewEntries.add(runId);
          }
        }

        for (const runId of new Set(runIdMap.values())) {
          const agg = await prisma.payrollEntry.aggregate({
            where: { payrollRunId: runId },
            _sum: { salary: true },
          });
          const updateData: { totalAmount: number; isProcessed?: boolean } = { totalAmount: agg._sum.salary ?? 0 };
          if (runsWithNewEntries.has(runId)) updateData.isProcessed = false;
          await prisma.payrollRun.update({ where: { id: runId }, data: updateData });
        }
      }

      const others = await prisma.person.findMany({ where: { id: { not: contractPerson.id } } });
      potentialMatches.push(...findPotentialMatches(contractPerson.id, personName, others));
    }

    const enrichedMatches = await Promise.all(
      potentialMatches.map(async (m) => {
        const [np, ep] = await Promise.all([
          prisma.person.findUnique({ where: { id: m.newPersonId }, select: { documentId: true, jobTitle: true, salary: true, salaryCurrency: true } }),
          prisma.person.findUnique({ where: { id: m.existingPersonId }, select: { documentId: true, jobTitle: true, salary: true, salaryCurrency: true } }),
        ]);
        return {
          ...m,
          newSource: (np?.documentId ? "contract" : "payroll") as "contract" | "payroll",
          existingSource: (ep?.documentId ? "contract" : "payroll") as "contract" | "payroll",
          newJobTitle: np?.jobTitle ?? null,
          existingJobTitle: ep?.jobTitle ?? null,
          newSalary: np?.salary ?? null,
          newSalaryCurrency: np?.salaryCurrency ?? null,
          existingSalary: ep?.salary ?? null,
          existingSalaryCurrency: ep?.salaryCurrency ?? null,
        };
      })
    );

    await audit({ action: "document.uploaded", entityType: "document", entityId: updated.id, entityLabel: updated.filename, details: { docType: updated.docType, parties: extraction.parties, source } });

    return {
      type: "success",
      document: {
        id: updated.id,
        filename: updated.filename,
        docType: updated.docType,
        confidence: updated.confidence,
        parties: extraction.parties,
        summary: updated.summary,
        issueDate: updated.issueDate?.toISOString().split("T")[0] ?? null,
        expiryDate: updated.expiryDate?.toISOString().split("T")[0] ?? null,
        renewalDeadline: updated.renewalDeadline?.toISOString().split("T")[0] ?? null,
        amount: updated.amount,
        currency: updated.currency,
        referenceNumber: updated.referenceNumber,
        notes: updated.notes,
      },
      alertsCreated: alertData.length,
      potentialMatches: enrichedMatches,
      invoicesCreated,
      invoicesSkipped,
      payrollEntriesCreated,
      contractPersonId,
    };
  } catch (err) {
    if (!replaceId) {
      await prisma.document.update({ where: { id: doc.id }, data: { status: "failed" } });
    }
    console.error("Post-extraction error:", err);
    return { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
