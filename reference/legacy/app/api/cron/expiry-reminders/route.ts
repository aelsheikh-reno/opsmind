import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendExpiryReminderEmail, ExpiryReminderItem } from "@/lib/email";
import { getUsdRates, toUSD } from "@/lib/fx";

export const maxDuration = 60;

const FALLBACK_EMAIL = process.env.NOTIFY_EMAIL ?? "";

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

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const url        = new URL(req.url);
  const windowDays = Math.min(parseInt(url.searchParams.get("days") ?? "90") || 90, 90);

  // ?to= overrides recipients for test runs
  const toOverride = url.searchParams.get("to");

  // Build recipient list: DB active recipients, fall back to NOTIFY_EMAIL env var
  const dbRecipients = await prisma.notificationRecipient.findMany({
    where: { active: true },
    select: { email: true },
  });
  const recipientList: string[] = toOverride
    ? [toOverride]
    : dbRecipients.length > 0
      ? dbRecipients.map(r => r.email)
      : FALLBACK_EMAIL
        ? [FALLBACK_EMAIL]
        : [];

  if (recipientList.length === 0) {
    return NextResponse.json({ error: "No notification recipients configured. Add recipients in Settings → Notifications." }, { status: 500 });
  }

  try {
    const rates = await getUsdRates();
    const now   = new Date();
    const cutoff = new Date(now.getTime() + windowDays * 86_400_000);

    const items: ExpiryReminderItem[] = [];

    // ── 1. Documents expiring soon (non-invoice) ──────────────────────────
    const expiringDocs = await prisma.document.findMany({
      where: {
        expiryDate: { gte: now, lte: cutoff },
        docType: { not: "invoice" },
      },
      select: { filename: true, docType: true, parties: true, expiryDate: true },
    });

    for (const doc of expiringDocs) {
      const days = daysUntil(doc.expiryDate!);
      const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
      const party = parties.find(p => p.trim()) ?? "";
      const label = party ? `${doc.filename} · ${party}` : doc.filename;
      const docTypeLabel = doc.docType
        ? doc.docType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
        : "Document";
      items.push({
        type: "document",
        label,
        detail: `${docTypeLabel} · expires ${fmtDate(doc.expiryDate!)}`,
        daysLeft: days,
      });
    }

    // ── 2. Unpaid invoices due soon ───────────────────────────────────────
    const dueInvoices = await prisma.document.findMany({
      where: {
        docType: "invoice",
        isPaid: false,
        expiryDate: { gte: now, lte: cutoff },
      },
      select: { filename: true, parties: true, referenceNumber: true, expiryDate: true, amount: true, currency: true },
    });

    for (const inv of dueInvoices) {
      const days = daysUntil(inv.expiryDate!);
      const parties: string[] = inv.parties ? JSON.parse(inv.parties) : [];
      const party = parties.find(p => p.trim()) ?? "";
      const label = inv.referenceNumber
        ? (party ? `#${inv.referenceNumber} · ${party}` : `#${inv.referenceNumber}`)
        : (party || inv.filename);
      items.push({
        type: "invoice",
        label,
        detail: `Due ${fmtDate(inv.expiryDate!)}`,
        daysLeft: days,
        amount: inv.amount != null && inv.currency ? fmtAmt(inv.amount, inv.currency) : undefined,
      });
    }

    // ── 3. Unpaid invoice payment schedules due soon ──────────────────────
    const dueInvoiceSchedules = await prisma.paymentSchedule.findMany({
      where: {
        isPaid: false,
        dueDate: { gte: now, lte: cutoff },
        invoiceId: { not: null },
      },
      select: {
        dueDate: true, amount: true, currency: true, description: true,
        document: { select: { filename: true, parties: true, referenceNumber: true } },
      },
    });

    for (const s of dueInvoiceSchedules) {
      const days = daysUntil(s.dueDate);
      const parties: string[] = s.document.parties ? JSON.parse(s.document.parties) : [];
      const party = parties.find(p => p.trim()) ?? "";
      const label = s.document.referenceNumber
        ? (party ? `#${s.document.referenceNumber} · ${party}` : `#${s.document.referenceNumber}`)
        : (party || s.document.filename);
      items.push({
        type: "invoice",
        label: s.description ? `${label} — ${s.description}` : label,
        detail: `Schedule due ${fmtDate(s.dueDate)}`,
        daysLeft: days,
        amount: fmtAmt(s.amount, s.currency),
      });
    }

    // ── 4. Unpaid liabilities due soon (leases + client contracts) ────────
    const dueLiabilities = await prisma.paymentSchedule.findMany({
      where: {
        isPaid: false,
        dueDate: { gte: now, lte: cutoff },
        invoiceId: null,
        document: { docType: { in: ["lease_contract", "client_contract"] } },
      },
      select: {
        dueDate: true, amount: true, currency: true, description: true,
        document: { select: { filename: true, parties: true, docType: true } },
      },
    });

    for (const s of dueLiabilities) {
      const days = daysUntil(s.dueDate);
      const parties: string[] = s.document.parties ? JSON.parse(s.document.parties) : [];
      const party = parties.find(p => p.trim()) ?? "";
      const docTypeLabel = s.document.docType === "lease_contract" ? "Lease" : "Contract payment";
      const label = s.description || party || s.document.filename;
      items.push({
        type: "liability",
        label,
        detail: `${docTypeLabel} · due ${fmtDate(s.dueDate)}`,
        daysLeft: days,
        amount: fmtAmt(s.amount, s.currency),
      });
    }

    // ── 5. Overdue + current-month unpaid payroll runs only ───────────────
    // Overdue = last day of run's month is before today
    // Current = run's month matches today's month/year
    // Future months are excluded — notify only when money is actually owed.
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const unpaidPayrollRuns = await prisma.payrollRun.findMany({
      where: { isProcessed: false },
      select: { id: true, period: true, month: true, year: true, totalAmount: true, currency: true },
    });

    for (const run of unpaidPayrollRuns) {
      if (!run.month || !run.year) continue;
      const dueDate = new Date(run.year, run.month, 0); // last day of the run's month
      if (dueDate > currentMonthEnd) continue; // skip future months
      const days = daysUntil(dueDate);
      items.push({
        type: "liability",
        label: `Payroll — ${run.period}`,
        detail: `Payroll run due ${fmtDate(dueDate)}`,
        daysLeft: days,
        amount: run.totalAmount != null && run.currency ? fmtAmt(run.totalAmount, run.currency) : undefined,
      });
    }

    // Sort by urgency
    items.sort((a, b) => a.daysLeft - b.daysLeft);

    if (items.length === 0) {
      return NextResponse.json({ ok: true, sent: false, reason: `nothing due in next ${windowDays} days` });
    }

    await Promise.all(recipientList.map(to => sendExpiryReminderEmail(to, items)));
    return NextResponse.json({ ok: true, sent: true, itemCount: items.length, recipients: recipientList, windowDays });
  } catch (err) {
    console.error("[cron/expiry-reminders]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
