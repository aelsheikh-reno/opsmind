import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildExpiryReminderHtml, ExpiryReminderItem } from "@/lib/email";

function daysUntil(date: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}

function fmtAmt(amount: number, currency: string): string {
  const n = Math.round(amount).toLocaleString("en-US");
  return currency === "USD" ? `$${n}` : `${currency} ${n}`;
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export async function GET() {
  try {
    const now    = new Date();
    const cutoff = new Date(now.getTime() + 90 * 86_400_000);
    const items: ExpiryReminderItem[] = [];

    const [expiringDocs, dueInvoices, dueInvoiceSchedules, dueLiabilities, unpaidPayrollRuns] = await Promise.all([
      prisma.document.findMany({
        where: { expiryDate: { gte: now, lte: cutoff }, docType: { not: "invoice" } },
        select: { filename: true, docType: true, parties: true, expiryDate: true },
      }),
      prisma.document.findMany({
        where: { docType: "invoice", isPaid: false, expiryDate: { gte: now, lte: cutoff } },
        select: { filename: true, parties: true, referenceNumber: true, expiryDate: true, amount: true, currency: true },
      }),
      prisma.paymentSchedule.findMany({
        where: { isPaid: false, dueDate: { gte: now, lte: cutoff }, invoiceId: { not: null } },
        select: {
          dueDate: true, amount: true, currency: true, description: true,
          document: { select: { filename: true, parties: true, referenceNumber: true } },
        },
      }),
      prisma.paymentSchedule.findMany({
        where: {
          isPaid: false, dueDate: { gte: now, lte: cutoff }, invoiceId: null,
          document: { docType: { in: ["lease_contract", "client_contract"] } },
        },
        select: {
          dueDate: true, amount: true, currency: true, description: true,
          document: { select: { filename: true, parties: true, docType: true } },
        },
      }),
      prisma.payrollRun.findMany({
        where: { isProcessed: false },
        select: { id: true, period: true, month: true, year: true, totalAmount: true, currency: true },
      }),
    ]);

    for (const doc of expiringDocs) {
      const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
      const party = parties.find(p => p.trim()) ?? "";
      const label = party ? `${doc.filename} · ${party}` : doc.filename;
      const docTypeLabel = doc.docType
        ? doc.docType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
        : "Document";
      items.push({ type: "document", label, detail: `${docTypeLabel} · expires ${fmtDate(doc.expiryDate!)}`, daysLeft: daysUntil(doc.expiryDate!) });
    }

    for (const inv of dueInvoices) {
      const parties: string[] = inv.parties ? JSON.parse(inv.parties) : [];
      const party = parties.find(p => p.trim()) ?? "";
      const label = inv.referenceNumber
        ? (party ? `#${inv.referenceNumber} · ${party}` : `#${inv.referenceNumber}`)
        : (party || inv.filename);
      items.push({
        type: "invoice", label, detail: `Due ${fmtDate(inv.expiryDate!)}`, daysLeft: daysUntil(inv.expiryDate!),
        amount: inv.amount != null && inv.currency ? fmtAmt(inv.amount, inv.currency) : undefined,
      });
    }

    for (const s of dueInvoiceSchedules) {
      const parties: string[] = s.document.parties ? JSON.parse(s.document.parties) : [];
      const party = parties.find(p => p.trim()) ?? "";
      const label = s.document.referenceNumber
        ? (party ? `#${s.document.referenceNumber} · ${party}` : `#${s.document.referenceNumber}`)
        : (party || s.document.filename);
      items.push({
        type: "invoice", label: s.description ? `${label} — ${s.description}` : label,
        detail: `Schedule due ${fmtDate(s.dueDate)}`, daysLeft: daysUntil(s.dueDate),
        amount: fmtAmt(s.amount, s.currency),
      });
    }

    for (const s of dueLiabilities) {
      const parties: string[] = s.document.parties ? JSON.parse(s.document.parties) : [];
      const party = parties.find(p => p.trim()) ?? "";
      const docTypeLabel = s.document.docType === "lease_contract" ? "Lease" : "Contract payment";
      const label = s.description || party || s.document.filename;
      items.push({ type: "liability", label, detail: `${docTypeLabel} · due ${fmtDate(s.dueDate)}`, daysLeft: daysUntil(s.dueDate), amount: fmtAmt(s.amount, s.currency) });
    }

    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    for (const run of unpaidPayrollRuns) {
      if (!run.month || !run.year) continue;
      const dueDate = new Date(run.year, run.month, 0);
      if (dueDate > currentMonthEnd) continue;
      items.push({
        type: "liability", label: `Payroll — ${run.period}`, detail: `Payroll run due ${fmtDate(dueDate)}`,
        daysLeft: daysUntil(dueDate),
        amount: run.totalAmount != null && run.currency ? fmtAmt(run.totalAmount, run.currency) : undefined,
      });
    }

    items.sort((a, b) => a.daysLeft - b.daysLeft);

    if (items.length === 0) {
      return NextResponse.json({ html: null, itemCount: 0 });
    }

    const html = buildExpiryReminderHtml(items);
    return NextResponse.json({ html, itemCount: items.length });
  } catch (err) {
    console.error("[expiry-reminders/preview]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
