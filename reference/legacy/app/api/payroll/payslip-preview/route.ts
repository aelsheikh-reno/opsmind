import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";
import { buildPayslipHtml } from "@/lib/email";
import { getUsdRates } from "@/lib/fx";

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function toUSD(amount: number, currency: string, rates: Record<string, number>): number {
  if (currency === "USD") return amount;
  const rate = rates[currency];
  return rate ? amount / rate : amount;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = resolvePermissions(session.user.role, session.user.permissions ?? null);
  if (perms.payroll === "none") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = req.nextUrl;
  const entryId = searchParams.get("entryId");
  const contractCurrency = searchParams.get("contractCurrency") === "true";
  if (!entryId) return NextResponse.json({ error: "Missing entryId" }, { status: 400 });

  try {
    const [ccSetting, entitySetting] = await Promise.all([
      prisma.setting.findUnique({ where: { key: "payslipCcEmails" } }),
      prisma.setting.findUnique({ where: { key: "entityName" } }),
    ]);
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
        payrollRun: { select: { month: true, year: true, fxRateSnapshot: true } },
      },
    });

    if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

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

    const allClaims = entry.person ? await prisma.expense.findMany({
      where: {
        personId:    entry.person.id,
        amount:      { not: null },
        expenseType: { not: "banking_fee" },
        OR: [{ claimStatus: null }, { claimStatus: "approved" }],
      },
      select: { id: true, name: true, amount: true, currency: true, completed: true, dueOn: true, asanaCreatedAt: true, createdAt: true, payrollMonth: true, payrollYear: true },
      orderBy: { createdAt: "asc" },
    }) : [];

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

    const html = buildPayslipHtml({
      employeeName:         entry.person?.name ?? "Employee",
      jobTitle:             entry.person?.jobTitle,
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

    return NextResponse.json({ html });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[payslip-preview]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
