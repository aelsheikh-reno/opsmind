import { NextRequest, NextResponse } from "next/server";
import { requireAnyRecordsWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { generateAlerts } from "@/lib/extract";

type SaveItem = {
  filename: string;
  filePath: string;
  fileHash: string;
  mimeType: string;
  extraction: {
    docType: string;
    confidence: number;
    parties: string[];
    summary: string;
    referenceNumber: string | null;
    issueDate: string | null;
    expiryDate: string | null;
    amount: number | null;
    currency: string | null;
    vatAmount: number | null;
    issuingCountry: string | null;
    notes: string | null;
    isPaid: boolean | null;
    paidDate: string | null;
  };
};

async function autoAssignEntity(docId: string, parties: string[], issuingCountry: string | null) {
  const [taxCfgs, vatCfgs] = await Promise.all([
    prisma.taxConfig.findMany({ where: { active: true, companyName: { not: null } }, select: { companyName: true, country: true, currency: true } }),
    prisma.vatConfig.findMany({ where: { active: true, companyName: { not: null } }, select: { companyName: true, country: true, currency: true } }),
  ]);

  const options = new Map<string, { name: string; country: string; currency: string | null }>();
  for (const c of [...taxCfgs, ...vatCfgs]) {
    if (!c.companyName) continue;
    const key = `${c.companyName.trim().toLowerCase()}|${c.country.trim().toLowerCase()}`;
    if (!options.has(key)) options.set(key, { name: c.companyName.trim(), country: c.country.trim(), currency: c.currency ?? null });
  }

  let matched: { name: string; country: string; currency: string | null } | null = null;

  for (const opt of options.values()) {
    if (parties.some(p =>
      p.toLowerCase().includes(opt.name.toLowerCase()) ||
      opt.name.toLowerCase().includes(p.toLowerCase())
    )) {
      matched = opt;
      break;
    }
  }

  if (!matched && issuingCountry) {
    const byCountry = Array.from(options.values()).filter(
      o => o.country.toLowerCase() === issuingCountry.toLowerCase()
    );
    if (byCountry.length === 1) matched = byCountry[0];
  }

  if (matched) {
    let entity = await prisma.legalEntity.findFirst({ where: { name: matched.name, country: matched.country } });
    if (!entity) entity = await prisma.legalEntity.create({ data: matched });
    await prisma.document.update({ where: { id: docId }, data: { legalEntityId: entity.id } });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAnyRecordsWrite();
  if (denied) return denied;

  let items: SaveItem[];
  try {
    const body = await request.json();
    items = body.items;
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "No items to save" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const documentIds: string[] = [];

  for (const item of items) {
    const { filename, filePath, fileHash, mimeType, extraction } = item;
    const x = extraction;

    const issueDate    = x.issueDate  ? new Date(x.issueDate)  : null;
    const expiryDate   = x.expiryDate ? new Date(x.expiryDate) : null;
    let renewalDeadline: Date | null = null;
    if (expiryDate) {
      renewalDeadline = new Date(expiryDate);
      renewalDeadline.setDate(renewalDeadline.getDate() - 90);
    }

    const invoiceAlreadyPaid = x.docType === "invoice" && x.isPaid === true;

    const doc = await prisma.document.create({
      data: {
        filename,
        mimeType,
        fileHash,
        filePath,
        source: "upload",
        status: "extracted",
        docType: x.docType as never,
        confidence: x.confidence,
        parties: JSON.stringify(x.parties ?? []),
        summary: x.summary,
        issueDate,
        expiryDate,
        renewalDeadline,
        amount: x.amount,
        vatAmount: x.vatAmount,
        currency: x.currency,
        issuingCountry: x.issuingCountry || null,
        referenceNumber: x.referenceNumber,
        notes: x.notes,
        ...(invoiceAlreadyPaid && {
          isPaid: true,
          paidAt: x.paidDate ? new Date(x.paidDate) : null,
        }),
      },
    });

    documentIds.push(doc.id);

    // Auto-assign legal entity
    if (x.docType === "invoice") {
      await autoAssignEntity(doc.id, x.parties ?? [], x.issuingCountry ?? null);
    }

    // Generate alerts (renewal, overdue, due-soon)
    if (expiryDate || renewalDeadline) {
      const alerts = generateAlerts(doc.id, x.docType, x.expiryDate, x.issueDate ?? null, x.parties ?? []);
      if (alerts.length > 0) {
        await prisma.alert.createMany({ data: alerts, skipDuplicates: true });
      }
    }
  }

  return NextResponse.json({ created: documentIds.length, documentIds });
}
