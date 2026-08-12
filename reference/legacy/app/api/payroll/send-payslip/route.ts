import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";
import { sendPayslipEmail } from "@/lib/email";
import { getUsdRates } from "@/lib/fx";

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function toUSD(amount: number, currency: string, rates: Record<string, number>): number {
  if (currency === "USD") return amount;
  const rate = rates[currency];
  return rate ? amount / rate : amount;
}

export async function POST(req: NextRequest) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  let entryId: string;
  let contractCurrency = false;
  try {
    const body = await req.json() as { entryId: string; contractCurrency?: boolean };
    entryId = body.entryId;
    contractCurrency = body.contractCurrency === true;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    return await handleSend(entryId, contractCurrency);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[send-payslip]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleSend(entryId: string, contractCurrency = false) {

  const [ccSetting, entitySetting] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "payslipCcEmails" } }),
    prisma.setting.findUnique({ where: { key: "entityName" } }),
  ]);
  const cc = ccSetting?.value ? ccSetting.value.split(",").map(s => s.trim()).filter(Boolean) : [];
  const companyName = entitySetting?.value?.trim() || null;

  const entry = await prisma.payrollEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      salary: true,
      currency: true,
      isPaid: true,
      salaryComponents: true,
      person: { select: { id: true, name: true, email: true, jobTitle: true } },
      payrollRun: { select: { month: true, year: true, isProcessed: true, fxRateSnapshot: true } },
    },
  });

  if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  if (!entry.person?.email) return NextResponse.json({ error: "No email address on file for this person" }, { status: 400 });

  const { month, year } = entry.payrollRun ?? {};
  if (!month || !year) return NextResponse.json({ error: "Payroll run has no month/year" }, { status: 400 });

  let rates: Record<string, number>;
  if (entry.payrollRun?.fxRateSnapshot) {
    try { rates = JSON.parse(entry.payrollRun.fxRateSnapshot); }
    catch { rates = await getUsdRates(); }
  } else {
    rates = await getUsdRates();
  }

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 1);

  // Claims for this payroll month — explicit assignment takes priority over date
  const allClaims = await prisma.expense.findMany({
    where: {
      personId:    entry.person.id,
      amount:      { not: null },
      expenseType: { not: "banking_fee" },
      OR: [{ claimStatus: null }, { claimStatus: "approved" }],
    },
    select: { id: true, name: true, amount: true, currency: true, completed: true, dueOn: true, asanaCreatedAt: true, createdAt: true, payrollMonth: true, payrollYear: true },
    orderBy: { createdAt: "asc" },
  });

  const monthClaims = allClaims.filter(e => {
    if (e.payrollMonth != null && e.payrollYear != null) {
      return e.payrollMonth === month && e.payrollYear === year;
    }
    const d = e.dueOn ?? e.asanaCreatedAt ?? e.createdAt;
    return d >= monthStart && d < monthEnd;
  });

  const expenses = monthClaims.map(e => ({
    name:      e.name,
    amount:    e.amount!,
    currency:  e.currency,
    amountUsd: toUSD(e.amount!, e.currency, rates),
  }));

  const components: { name: string; amount: number }[] = (() => {
    try { return JSON.parse(entry.salaryComponents ?? "[]"); } catch { return []; }
  })();

  const fxRate   = entry.currency !== "USD" ? (rates[entry.currency] ?? null) : null;
  const usdEquiv = toUSD(entry.salary, entry.currency, rates);
  const totalUsd = usdEquiv + expenses.reduce((s, e) => s + e.amountUsd, 0);
  const period   = `${MONTH_NAMES[month - 1]} ${year}`;

  await sendPayslipEmail({
    to:                   entry.person.email,
    cc:                   cc.length > 0 ? cc : undefined,
    employeeName:         entry.person.name,
    jobTitle:             entry.person.jobTitle,
    period,
    currency:             entry.currency,
    salary:               entry.salary,
    components,
    expenses,
    fxRate,
    usdEquiv,
    totalUsd,
    isPaid:               entry.isPaid,
    companyName,
    showInContractCurrency: contractCurrency,
  });

  const updated = await prisma.payrollEntry.update({
    where: { id: entryId },
    data:  { payslipSentCount: { increment: 1 } },
    select: { payslipSentCount: true },
  });

  return NextResponse.json({ ok: true, payslipSentCount: updated.payslipSentCount });
}
