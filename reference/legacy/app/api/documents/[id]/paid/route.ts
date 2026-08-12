import { prisma } from "@/lib/prisma";
import { getUsdRates } from "@/lib/fx";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { requireWrite } from "@/lib/permissions";
import { auth } from "@/auth";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const [denied, session] = await Promise.all([requireWrite("invoices"), auth()]);
  if (denied) return denied;
  const auditUser = { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null };

  const { id } = await params;
  const doc = await prisma.document.findUnique({ where: { id }, select: { filename: true, isPaid: true, docType: true, paidAt: true } });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Try to parse an optional body
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body → toggle */ }

  // ── Paid-date-only update (no status toggle) ──────────────────────────────
  if ("paidAt" in body) {
    const newPaidAt = body.paidAt ? new Date(body.paidAt as string) : null;
    await prisma.document.update({ where: { id }, data: { paidAt: newPaidAt } });
    await audit({
      action: "document.paid_date_updated",
      entityType: "document",
      entityId: id,
      entityLabel: doc.filename,
      details: {
        from: doc.paidAt ? doc.paidAt.toISOString().split("T")[0] : null,
        to: newPaidAt ? newPaidAt.toISOString().split("T")[0] : null,
      },
      ...auditUser,
    });
    return NextResponse.json({ paidAt: newPaidAt?.toISOString() ?? null });
  }

  // ── Toggle paid / unpaid ──────────────────────────────────────────────────
  const markingPaid = !doc.isPaid;
  let fxData: { paidAt: Date | null; fxRateSnapshot: string | null } = { paidAt: null, fxRateSnapshot: null };

  if (markingPaid) {
    const rates = await getUsdRates();
    fxData = { paidAt: new Date(), fxRateSnapshot: JSON.stringify(rates) };
  }

  const updated = await prisma.document.update({
    where: { id },
    data: { isPaid: markingPaid, ...fxData },
  });

  // When an invoice is toggled, sync isPaid to any client_contract or purchase_order
  // payment schedules that reference this invoice.
  const closedPOs: { id: string; filename: string }[] = [];

  if (doc.docType === "invoice") {
    await prisma.paymentSchedule.updateMany({
      where: {
        invoiceId: id,
        document: { docType: { in: ["client_contract", "purchase_order"] } },
      },
      data: {
        isPaid: updated.isPaid,
        ...(markingPaid ? fxData : { paidAt: null, fxRateSnapshot: null }),
      },
    });

    // If marking paid: check if all PO schedules are now fully paid → auto-close the PO
    if (markingPaid) {
      const affectedPOs = await prisma.paymentSchedule.findMany({
        where: { invoiceId: id, document: { docType: "purchase_order" } },
        select: { documentId: true },
        distinct: ["documentId"],
      });

      for (const { documentId: poId } of affectedPOs) {
        const unpaidCount = await prisma.paymentSchedule.count({
          where: { documentId: poId, isPaid: false },
        });
        if (unpaidCount === 0) {
          const po = await prisma.document.update({
            where: { id: poId },
            data: { status: "closed" },
            select: { id: true, filename: true },
          });
          closedPOs.push(po);
          await audit({
            action: "document.status_changed",
            entityType: "document",
            entityId: poId,
            entityLabel: po.filename,
            details: { from: "open", to: "closed", reason: "All invoices paid" },
            ...auditUser,
          });
        }
      }
    }
  }

  await audit({
    action: markingPaid ? "document.paid" : "document.unpaid",
    entityType: "document",
    entityId: id,
    entityLabel: doc.filename,
    details: markingPaid && fxData.paidAt
      ? { paidAt: fxData.paidAt.toISOString().split("T")[0] }
      : undefined,
    ...auditUser,
  });

  return NextResponse.json({ isPaid: updated.isPaid, closedPOs });
}
