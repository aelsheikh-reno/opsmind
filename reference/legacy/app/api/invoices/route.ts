import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { generateAlerts } from "@/lib/extract";
import { requireWrite } from "@/lib/permissions";

export async function GET() {
  const docs = await prisma.document.findMany({
    where: { docType: "invoice", status: "extracted" },
    select: {
      id: true,
      filename: true,
      referenceNumber: true,
      amount: true,
      currency: true,
      issueDate: true,
      parties: true,
      isPaid: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ invoices: docs });
}

export async function POST(req: Request) {
  const denied = await requireWrite("invoices");
  if (denied) return denied;

  const body = await req.json();

  if (!body.vendor?.trim()) {
    return NextResponse.json({ error: "Vendor name is required" }, { status: 400 });
  }

  const issueDate  = body.issueDate  ? new Date(body.issueDate)  : null;
  const expiryDate = body.expiryDate ? new Date(body.expiryDate) : null;

  const doc = await prisma.document.create({
    data: {
      filename:        body.referenceNumber ? `Invoice ${body.referenceNumber}` : `Invoice — ${body.vendor}`,
      mimeType:        "text/plain",
      source:          "manual",
      status:          "extracted",
      docType:         "invoice",
      confidence:      1.0,
      parties:         JSON.stringify([body.vendor.trim()]),
      referenceNumber: body.referenceNumber?.trim() || null,
      issueDate,
      expiryDate,
      amount:          body.amount  != null ? parseFloat(body.amount)  : null,
      currency:        body.currency?.trim() || null,
      notes:           body.notes?.trim()    || null,
      summary:         `Invoice from ${body.vendor.trim()}${body.referenceNumber ? ` (${body.referenceNumber})` : ""}.`,
    },
  });

  const alerts = generateAlerts(doc.id, "invoice", body.expiryDate || null, null, [body.vendor.trim()]);
  if (alerts.length > 0) {
    await prisma.alert.createMany({ data: alerts });
  }

  return NextResponse.json(doc);
}
