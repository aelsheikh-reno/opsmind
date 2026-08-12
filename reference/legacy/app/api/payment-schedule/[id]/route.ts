import { prisma } from "@/lib/prisma";
import { getUsdRates } from "@/lib/fx";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { requireWrite } from "@/lib/permissions";

type SalaryComponent = { name: string; amount: number; scheduleId?: string };

function parseComponents(json: string | null | undefined): SalaryComponent[] {
  try { return JSON.parse(json ?? "[]"); } catch { return []; }
}

function toUSD(amount: number, currency: string, rates: Record<string, number>): number {
  if (currency === "USD") return amount;
  return amount / (rates[currency] ?? 1);
}

function fromUSD(usd: number, currency: string, rates: Record<string, number>): number {
  if (currency === "USD") return usd;
  return usd * (rates[currency] ?? 1);
}

async function getRates(fxRateSnapshot: string | null | undefined): Promise<Record<string, number>> {
  if (fxRateSnapshot) {
    try {
      const parsed = JSON.parse(fxRateSnapshot);
      if (Object.keys(parsed).length > 1) return parsed; // full snapshot vs single-currency override
    } catch { /* fall through */ }
  }
  return getUsdRates();
}

async function convertToEntryCurrency(
  amount: number,
  fromCurrency: string,
  entryCurrency: string,
  fxRateSnapshot: string | null | undefined,
): Promise<number> {
  if (fromCurrency === entryCurrency) return amount;
  const rates = await getRates(fxRateSnapshot);
  return Math.round(fromUSD(toUSD(amount, fromCurrency, rates), entryCurrency, rates) * 100) / 100;
}

async function syncBonusComponent(
  scheduleId: string,
  personId: string,
  month: number,
  year: number,
  newRawAmount: number,
  newCurrency: string,
  newBaseLabel: string,
) {
  const run = await prisma.payrollRun.findFirst({ where: { month, year } });
  if (!run) return;

  const entry = await prisma.payrollEntry.findFirst({
    where: { payrollRunId: run.id, personId },
    select: {
      id: true, salary: true, currency: true, salaryComponents: true, payrollRunId: true,
      payrollRun: { select: { fxRateSnapshot: true } },
    },
  });
  if (!entry) return;

  const entryCurrency = entry.currency;
  const convertedAmount = await convertToEntryCurrency(
    newRawAmount, newCurrency, entryCurrency, entry.payrollRun?.fxRateSnapshot
  );

  const currencyNote = newCurrency !== entryCurrency
    ? ` (${newCurrency} ${newRawAmount.toLocaleString()})`
    : "";
  const newLabel = newBaseLabel + currencyNote;

  const components = parseComponents(entry.salaryComponents);
  const idx = components.findIndex(c => c.scheduleId === scheduleId);
  const oldComponentAmount = idx >= 0 ? components[idx].amount : 0;

  if (idx >= 0) {
    components[idx] = { ...components[idx], name: newLabel, amount: convertedAmount };
  } else {
    components.push({ name: newLabel, amount: convertedAmount, scheduleId });
  }

  const newSalary = Math.max(0, Math.round((entry.salary - oldComponentAmount + convertedAmount) * 100) / 100);

  await prisma.payrollEntry.update({
    where: { id: entry.id },
    data: { salary: newSalary, salaryComponents: JSON.stringify(components) },
  });

  const agg = await prisma.payrollEntry.aggregate({
    where: { payrollRunId: entry.payrollRunId },
    _sum: { salary: true },
  });
  await prisma.payrollRun.update({
    where: { id: entry.payrollRunId },
    data: { totalAmount: agg._sum.salary ?? 0 },
  });
}

async function removeBonusComponent(
  scheduleId: string,
  personId: string,
  month: number,
  year: number,
) {
  const run = await prisma.payrollRun.findFirst({ where: { month, year } });
  if (!run) return;

  const entry = await prisma.payrollEntry.findFirst({
    where: { payrollRunId: run.id, personId },
    select: { id: true, salary: true, salaryComponents: true, payrollRunId: true },
  });
  if (!entry) return;

  const components = parseComponents(entry.salaryComponents);
  const removed = components.find(c => c.scheduleId === scheduleId);
  if (!removed) return;

  const newComponents = components.filter(c => c.scheduleId !== scheduleId);

  // Collapse back to plain salary if only the auto-seeded "Base Salary" component remains
  const finalComponents =
    newComponents.length === 1 && !newComponents[0].scheduleId
      ? []
      : newComponents;

  const newSalary = Math.max(0, Math.round((entry.salary - removed.amount) * 100) / 100);

  await prisma.payrollEntry.update({
    where: { id: entry.id },
    data: { salary: newSalary, salaryComponents: JSON.stringify(finalComponents) },
  });

  const agg = await prisma.payrollEntry.aggregate({
    where: { payrollRunId: entry.payrollRunId },
    _sum: { salary: true },
  });
  await prisma.payrollRun.update({
    where: { id: entry.payrollRunId },
    data: { totalAmount: agg._sum.salary ?? 0 },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("invoices");
  if (denied) return denied;

  const { id } = await params;

  let body: Record<string, unknown> | null = null;
  try { body = await req.json(); } catch { /* no body = paid toggle */ }

  // ── Rate override ──────────────────────────────────────────────────────────
  if (body && "fxRate" in body) {
    const { fxRate, currency } = body as { fxRate: number | null; currency?: string };
    let fxRateSnapshot: string | null = null;
    if (fxRate !== null && fxRate !== undefined && currency) {
      fxRateSnapshot = JSON.stringify({ [currency]: fxRate });
    }
    await prisma.paymentSchedule.update({ where: { id }, data: { fxRateSnapshot } });
    return NextResponse.json({ ok: true, fxRateSnapshot });
  }

  // ── Paid toggle ────────────────────────────────────────────────────────────
  const entry = await prisma.paymentSchedule.findUnique({
    where: { id },
    include: { document: { select: { id: true, filename: true } } },
  });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const markingPaid = !entry.isPaid;
  let fxData: { paidAt: Date | null; fxRateSnapshot: string | null } = { paidAt: null, fxRateSnapshot: null };

  if (markingPaid) {
    const rates = await getUsdRates();
    fxData = { paidAt: new Date(), fxRateSnapshot: JSON.stringify(rates) };
  }

  const updated = await prisma.paymentSchedule.update({
    where: { id },
    data: { isPaid: markingPaid, ...fxData },
  });

  await audit({
    action: markingPaid ? "document.paid" : "document.unpaid",
    entityType: "document",
    entityId: entry.document?.id ?? null,
    entityLabel: entry.document?.filename ?? null,
    details: entry.dueDate ? { dueDate: entry.dueDate.toISOString().split("T")[0] } : undefined,
  });

  return NextResponse.json({ isPaid: updated.isPaid });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("invoices");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();

  const newAmount      = parseFloat(body.amount);
  const newCurrency    = body.currency?.trim() || "AED";
  const newDueDate     = new Date(body.dueDate);
  const newDescription = body.description?.trim() || null;

  const old = await prisma.paymentSchedule.findUnique({
    where: { id },
    select: { dueDate: true, scheduleType: true, amount: true, description: true },
  });
  if (!old) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.paymentSchedule.update({
    where: { id },
    data: {
      dueDate: newDueDate,
      amount: newAmount,
      currency: newCurrency,
      description: newDescription,
    },
    include: {
      document: {
        select: { docType: true, person: { select: { id: true } } },
      },
    },
  });

  if (updated.document.docType === "employee_contract" && updated.document.person) {
    const personId = updated.document.person.id;
    const month = old.dueDate.getMonth() + 1;
    const year  = old.dueDate.getFullYear();

    if (old.scheduleType === "salary" || !old.scheduleType) {
      // Salary: update the PayrollEntry salary directly
      const run = await prisma.payrollRun.findFirst({ where: { month, year } });
      if (run) {
        const entry = await prisma.payrollEntry.findFirst({
          where: { payrollRunId: run.id, personId },
          select: { id: true, payrollRunId: true },
        });
        if (entry) {
          await prisma.payrollEntry.update({
            where: { id: entry.id },
            data: { salary: newAmount, currency: newCurrency },
          });
          const agg = await prisma.payrollEntry.aggregate({
            where: { payrollRunId: entry.payrollRunId },
            _sum: { salary: true },
          });
          await prisma.payrollRun.update({
            where: { id: entry.payrollRunId },
            data: { totalAmount: agg._sum.salary ?? 0 },
          });
        }
      }
    } else {
      // Bonus: re-convert and update the salary component
      const baseLabel = newDescription || "Bonus";
      await syncBonusComponent(id, personId, month, year, newAmount, newCurrency, baseLabel);
    }
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("invoices");
  if (denied) return denied;

  const { id } = await params;

  const entry = await prisma.paymentSchedule.findUnique({
    where: { id },
    select: {
      scheduleType: true,
      dueDate: true,
      document: {
        select: { docType: true, person: { select: { id: true } } },
      },
    },
  });

  await prisma.paymentSchedule.delete({ where: { id } });

  if (
    entry?.document.docType === "employee_contract" &&
    entry.document.person &&
    entry.scheduleType !== "salary"
  ) {
    const month = entry.dueDate.getMonth() + 1;
    const year  = entry.dueDate.getFullYear();
    await removeBonusComponent(id, entry.document.person.id, month, year);
  }

  return NextResponse.json({ ok: true });
}
