import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";

const WINDOWS = [90, 30, 7, 1];
const TEMPLATE = "ops_reminder";

function daysUntil(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function fmt(date: Date) {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const isTest = url.searchParams.get("test") === "true";

  const phoneSetting = await prisma.setting.findUnique({ where: { key: "whatsappPhone" } });
  if (!phoneSetting?.value) {
    return NextResponse.json({ skipped: true, reason: "no whatsappPhone configured" });
  }
  const phone = phoneSetting.value;

  const [contracts, leases, invoices] = await Promise.all([
    prisma.document.findMany({
      where: { docType: { in: ["employee_contract", "client_contract"] } },
      select: { id: true, filename: true, parties: true, referenceNumber: true, renewalDeadline: true, expiryDate: true },
    }),
    prisma.document.findMany({
      where: { docType: "lease_contract" },
      select: { id: true, filename: true, parties: true, referenceNumber: true, renewalDeadline: true, expiryDate: true },
    }),
    prisma.document.findMany({
      where: { docType: "invoice", isPaid: false },
      select: { id: true, filename: true, parties: true, referenceNumber: true, expiryDate: true, amount: true, currency: true },
    }),
  ]);

  type DocEntry = {
    id: string;
    filename: string;
    parties: string | null;
    referenceNumber: string | null;
    targetDate: Date;
    kind: "contract" | "lease" | "invoice";
  };

  const docs: DocEntry[] = [];

  for (const d of contracts) {
    const date = d.renewalDeadline ?? d.expiryDate;
    if (date) docs.push({ id: d.id, filename: d.filename, parties: d.parties, referenceNumber: d.referenceNumber, targetDate: date, kind: "contract" });
  }
  for (const d of leases) {
    const date = d.renewalDeadline ?? d.expiryDate;
    if (date) docs.push({ id: d.id, filename: d.filename, parties: d.parties, referenceNumber: d.referenceNumber, targetDate: date, kind: "lease" });
  }
  for (const d of invoices) {
    if (d.expiryDate) docs.push({ id: d.id, filename: d.filename, parties: d.parties, referenceNumber: d.referenceNumber, targetDate: d.expiryDate, kind: "invoice" });
  }

  // In test mode: pick the nearest upcoming document and send once (no DB record)
  if (isTest) {
    const upcoming = docs
      .map(d => ({ ...d, days: daysUntil(d.targetDate) }))
      .filter(d => d.days >= 1 && d.days <= 90)
      .sort((a, b) => a.days - b.days);

    if (upcoming.length === 0) {
      return NextResponse.json({ skipped: true, reason: "no documents expiring within 90 days" });
    }

    const doc = upcoming[0];
    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
    const name = parties[0] ?? doc.referenceNumber ?? doc.filename;
    const variables = [doc.kind, name, String(doc.days), fmt(doc.targetDate)];

    try {
      await sendWhatsAppTemplate(phone, TEMPLATE, variables);
      return NextResponse.json({ ok: true, test: true, sent: { kind: doc.kind, name, days: doc.days, date: fmt(doc.targetDate) } });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // Normal mode: exact window matches only
  let sent = 0;
  let skipped = 0;

  for (const doc of docs) {
    const days = daysUntil(doc.targetDate);
    if (!WINDOWS.includes(days)) continue;

    const exists = await prisma.whatsappReminder.findUnique({
      where: { documentId_daysWindow_targetDate: { documentId: doc.id, daysWindow: days, targetDate: doc.targetDate } },
    });
    if (exists) { skipped++; continue; }

    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
    const name = parties[0] ?? doc.referenceNumber ?? doc.filename;
    const variables = [doc.kind, name, String(days), fmt(doc.targetDate)];

    try {
      await sendWhatsAppTemplate(phone, TEMPLATE, variables);
      await prisma.whatsappReminder.create({
        data: { documentId: doc.id, daysWindow: days, targetDate: doc.targetDate },
      });
      sent++;
    } catch (err) {
      console.error(`[whatsapp-reminders] failed for ${doc.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, sent, skipped });
}
