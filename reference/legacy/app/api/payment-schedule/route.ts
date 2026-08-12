import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { getUsdRates } from "@/lib/fx";

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

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

async function convertBonus(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  fxRateSnapshot: string | null | undefined,
): Promise<number> {
  if (fromCurrency === toCurrency) return amount;
  let rates: Record<string, number>;
  try { rates = JSON.parse(fxRateSnapshot ?? "{}"); } catch { rates = {}; }
  if (!Object.keys(rates).length) rates = await getUsdRates();
  return fromUSD(toUSD(amount, fromCurrency, rates), toCurrency, rates);
}

export async function POST(req: Request) {
  const denied = await requireWrite("invoices");
  if (denied) return denied;

  const body = await req.json();

  if (!body.documentId || !body.dueDate || body.amount == null) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const dueDate      = new Date(body.dueDate);
  const amount       = parseFloat(body.amount);
  const currency     = body.currency?.trim() || "AED";
  const scheduleType = (body.scheduleType?.trim() || "salary") as "salary" | "bonus";

  const entry = await prisma.paymentSchedule.create({
    data: {
      documentId: body.documentId,
      dueDate,
      amount,
      currency,
      description: body.description?.trim() || null,
      scheduleType,
    },
    include: {
      document: {
        select: { docType: true, person: { select: { id: true, name: true } } },
      },
    },
  });

  if (entry.document.docType === "employee_contract" && entry.document.person) {
    const { id: personId, name: personName } = entry.document.person;
    const month = dueDate.getMonth() + 1;
    const year  = dueDate.getFullYear();

    if (scheduleType === "salary") {
      // Create payroll run + entry if they don't exist yet
      let run = await prisma.payrollRun.findFirst({ where: { month, year } });
      if (!run) {
        run = await prisma.payrollRun.create({
          data: {
            period: `${MONTH_NAMES[month - 1]} ${year}`,
            month,
            year,
            totalAmount: amount,
            currency,
          },
        });
      }

      const existing = await prisma.payrollEntry.findFirst({
        where: { payrollRunId: run.id, personId },
      });

      if (!existing) {
        await prisma.payrollEntry.create({
          data: { payrollRunId: run.id, personId, employeeName: personName, salary: amount, currency },
        });

        const agg = await prisma.payrollEntry.aggregate({
          where: { payrollRunId: run.id },
          _sum: { salary: true },
        });
        await prisma.payrollRun.update({
          where: { id: run.id },
          data: { totalAmount: agg._sum.salary ?? 0, isProcessed: false },
        });
      }
    } else {
      // Bonus: add as a salary component on the existing payroll entry for this month
      const run = await prisma.payrollRun.findFirst({ where: { month, year } });
      if (!run) {
        return NextResponse.json({
          error: "No payroll run found for this month. Add the base salary payment first.",
        }, { status: 400 });
      }

      const payrollEntry = await prisma.payrollEntry.findFirst({
        where: { payrollRunId: run.id, personId },
        select: {
          id: true, salary: true, currency: true, salaryComponents: true, payrollRunId: true,
          payrollRun: { select: { fxRateSnapshot: true } },
        },
      });
      if (!payrollEntry) {
        return NextResponse.json({
          error: "No payroll entry found for this person in this month. Add the base salary payment first.",
        }, { status: 400 });
      }

      const entryCurrency = payrollEntry.currency;

      // Convert bonus to the payroll entry's currency
      const convertedAmount = Math.round(
        (await convertBonus(amount, currency, entryCurrency, payrollEntry.payrollRun?.fxRateSnapshot)) * 100
      ) / 100;

      const components = parseComponents(payrollEntry.salaryComponents);

      // If no components yet, seed the base salary as the first component
      if (components.length === 0) {
        components.push({ name: "Base Salary", amount: payrollEntry.salary });
      }

      const baseLabel = body.description?.trim() || "Bonus";
      const currencyNote = currency !== entryCurrency
        ? ` (${currency} ${amount.toLocaleString()})`
        : "";
      const label = baseLabel + currencyNote;

      components.push({ name: label, amount: convertedAmount, scheduleId: entry.id });

      await prisma.payrollEntry.update({
        where: { id: payrollEntry.id },
        data: {
          salary: Math.round((payrollEntry.salary + convertedAmount) * 100) / 100,
          salaryComponents: JSON.stringify(components),
        },
      });

      const agg = await prisma.payrollEntry.aggregate({
        where: { payrollRunId: payrollEntry.payrollRunId },
        _sum: { salary: true },
      });
      await prisma.payrollRun.update({
        where: { id: payrollEntry.payrollRunId },
        data: { totalAmount: agg._sum.salary ?? 0 },
      });
    }
  }

  return NextResponse.json(entry);
}
