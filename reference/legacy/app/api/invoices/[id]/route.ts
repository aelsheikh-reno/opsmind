import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("invoices");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();

  if (!body.vendor?.trim()) {
    return NextResponse.json({ error: "Vendor name is required" }, { status: 400 });
  }

  const issueDate  = body.issueDate  ? new Date(body.issueDate)  : null;
  const expiryDate = body.expiryDate ? new Date(body.expiryDate) : null;

  const doc = await prisma.document.update({
    where: { id },
    data: {
      filename:        body.referenceNumber?.trim()
        ? `Invoice ${body.referenceNumber.trim()}`
        : `Invoice — ${body.vendor.trim()}`,
      parties:         JSON.stringify([body.vendor.trim()]),
      referenceNumber: body.referenceNumber?.trim() || null,
      issueDate,
      expiryDate,
      amount:          body.amount != null && body.amount !== "" ? parseFloat(body.amount) : null,
      currency:        body.currency?.trim() || null,
      notes:           body.notes?.trim()    || null,
      summary:         `Invoice from ${body.vendor.trim()}${body.referenceNumber?.trim() ? ` (${body.referenceNumber.trim()})` : ""}.`,
    },
  });

  return NextResponse.json({ success: true, documentId: doc.id });
}
