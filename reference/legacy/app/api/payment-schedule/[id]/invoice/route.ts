import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("invoices");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();

  const entry = await prisma.paymentSchedule.findUnique({
    where: { id },
    include: { document: { select: { docType: true } } },
  });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const invoiceId: string | null = body.invoiceId ?? null;
  const isClient = entry.document.docType === "client_contract" || entry.document.docType === "purchase_order";

  // Validate the target invoice exists
  let invoiceIsPaid = false;
  if (invoiceId) {
    const invoice = await prisma.document.findUnique({
      where: { id: invoiceId, docType: "invoice" },
      select: { isPaid: true },
    });
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    invoiceIsPaid = invoice.isPaid;
  }

  // For vendor contracts: sync isPaid from the invoice (link) or reset to false (unlink).
  // Lease contracts manage their own isPaid through the component toggle.
  const syncedIsPaid = isClient ? (invoiceId ? invoiceIsPaid : false) : entry.isPaid;

  const updated = await prisma.paymentSchedule.update({
    where: { id },
    data: { invoiceId, isPaid: syncedIsPaid },
    include: {
      invoice: {
        select: { id: true, filename: true, referenceNumber: true },
      },
    },
  });

  return NextResponse.json({
    invoiceId: updated.invoiceId,
    invoice: updated.invoice,
    isPaid: updated.isPaid,
  });
}
