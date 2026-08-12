import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";
import { createZohoExpense, deleteZohoExpense, getCurrencies, getValidToken } from "@/lib/zoho-books";
import { getUsdRates } from "@/lib/fx";

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function convertCurrency(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount;
  const usd = from === "USD" ? amount : amount / (rates[from] ?? 1);
  return to === "USD" ? usd : usd * (rates[to] ?? 1);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { paidThroughAccountId?: string; vendorId?: string; bankingFee?: number; bankingFeeCurrency?: string };

  const [entry, conn] = await Promise.all([
    prisma.payrollEntry.findUnique({
      where: { id },
      select: {
        id: true, employeeName: true, salary: true, currency: true,
        isPaid: true, zohoExpenseId: true, personId: true,
        bankingFee: true, bankingFeeCurrency: true, bankingFeeExpenseId: true,
        payrollRun: { select: { month: true, year: true, isProcessed: true, fxRateSnapshot: true } },
      },
    }),
    prisma.zohoConnection.findFirst(),
  ]);

  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!conn)  return NextResponse.json({ error: "Zoho Books not connected" }, { status: 400 });
  if (!conn.accountId) return NextResponse.json({ error: "No default expense account set — configure it in Settings → Integrations → Zoho Books" }, { status: 400 });
  if (entry.zohoExpenseId) return NextResponse.json({ error: "Already pushed to Zoho Books" }, { status: 400 });

  const { month, year } = entry.payrollRun ?? {};
  if (!month || !year) return NextResponse.json({ error: "Payroll run has no month/year" }, { status: 400 });

  // FX rates — use locked rates if the run was processed, otherwise live
  let rates: Record<string, number>;
  if (entry.payrollRun?.fxRateSnapshot) {
    try { rates = JSON.parse(entry.payrollRun.fxRateSnapshot); }
    catch { rates = await getUsdRates(); }
  } else {
    rates = await getUsdRates();
  }

  // Per-type account mapping (e.g. { "Salary": "acct_x", "Travel": "acct_y", "Banking Fee": "acct_z" })
  const claimTypeAccounts: Record<string, string> = (() => {
    try { return JSON.parse(conn.claimTypeAccounts ?? "{}"); } catch { return {}; }
  })();

  // Expenses/claims assigned to this payroll month.
  // Exclude banking_fee expenses — they are handled as a dedicated line item below.
  type Claim = { id: string; name: string; expenseType: string | null; amount: number; currency: string; converted: number };
  const claims: Claim[] = [];
  if (entry.personId) {
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd   = new Date(year, month, 1);
    const rawClaims  = await prisma.expense.findMany({
      where: {
        personId:      entry.personId,
        amount:        { not: null },
        expenseType:   { not: "banking_fee" },
        zohoExpenseId: null,
        AND: [
          { OR: [{ claimStatus: null }, { claimStatus: { not: "rejected" } }] },
          { OR: [
            { payrollMonth: month, payrollYear: year },
            { payrollMonth: null, OR: [
              { dueOn: { gte: monthStart, lt: monthEnd } },
              { asanaCreatedAt: { gte: monthStart, lt: monthEnd } },
            ]},
          ]},
        ],
      },
      select: { id: true, name: true, expenseType: true, amount: true, currency: true },
    });
    for (const c of rawClaims) {
      claims.push({
        id:          c.id,
        name:        c.name,
        expenseType: c.expenseType,
        amount:      c.amount!,
        currency:    c.currency,
        converted:   convertCurrency(c.amount!, c.currency, entry.currency, rates),
      });
    }
  }

  // Build line items — salary + claims + optional banking fee
  const salaryAccountId     = claimTypeAccounts["Salary"]      ?? conn.accountId;
  const bankingFeeAccountId = claimTypeAccounts["Banking Fee"] ?? conn.accountId;
  const period = `${MONTH_NAMES[month - 1]} ${year}`;

  // If the user supplied a banking fee in the push request, save it to the entry first
  let effectiveBankingFee         = entry.bankingFee ?? null;
  let effectiveBankingFeeCurrency = entry.bankingFeeCurrency ?? entry.currency;
  let effectiveBankingFeeExpenseId = entry.bankingFeeExpenseId ?? null;

  if (body.bankingFee !== undefined && body.bankingFee > 0 && entry.personId) {
    const feeAmount   = body.bankingFee;
    const feeCurrency = body.bankingFeeCurrency ?? entry.currency;
    const monthEnd    = new Date(year, month, 0);

    if (effectiveBankingFeeExpenseId) {
      await prisma.expense.update({
        where: { id: effectiveBankingFeeExpenseId },
        data:  { amount: feeAmount, currency: feeCurrency },
      });
    } else {
      const feeExpense = await prisma.expense.create({
        data: {
          name:            `Bank Transfer Fee – ${entry.employeeName} – ${period}`,
          amount:          feeAmount,
          amountConfirmed: true,
          currency:        feeCurrency,
          expenseType:     "banking_fee",
          paymentMethod:   "bank_transfer",
          dueOn:           monthEnd,
          notes:           "Transaction cost for payroll bank transfer",
          personId:        entry.personId,
        },
      });
      effectiveBankingFeeExpenseId = feeExpense.id;
    }

    await prisma.payrollEntry.update({
      where: { id },
      data:  { bankingFee: feeAmount, bankingFeeCurrency: feeCurrency, bankingFeeExpenseId: effectiveBankingFeeExpenseId },
    });

    effectiveBankingFee         = feeAmount;
    effectiveBankingFeeCurrency = feeCurrency;
  }

  const lineItems = [
    {
      account_id:  salaryAccountId,
      amount:      entry.salary,
      description: `Basic salary – ${entry.employeeName} – ${period}`,
    },
    ...claims.map(c => {
      const accountId = (c.expenseType && claimTypeAccounts[c.expenseType]) ?? conn.accountId!;
      const convNote  = c.currency !== entry.currency
        ? ` (${c.currency} ${c.amount.toLocaleString()})`
        : "";
      return {
        account_id:  accountId,
        amount:      Math.round(c.converted * 100) / 100,
        description: `${c.name}${convNote}`,
      };
    }),
    ...(effectiveBankingFee && effectiveBankingFee > 0
      ? [{
          account_id:  bankingFeeAccountId,
          amount:      Math.round(convertCurrency(effectiveBankingFee, effectiveBankingFeeCurrency, entry.currency, rates) * 100) / 100,
          description: `Bank transfer fee – ${entry.employeeName} – ${period}${effectiveBankingFeeCurrency !== entry.currency ? ` (${effectiveBankingFeeCurrency} ${effectiveBankingFee.toLocaleString()})` : ""}`,
        }]
      : []),
  ];

  const totalAmount = lineItems.reduce((s, l) => s + l.amount, 0);

  const { accessToken, updated } = await getValidToken(conn);
  if (updated) {
    await prisma.zohoConnection.update({ where: { id: conn.id }, data: updated });
  }

  const date = new Date(year, month, 0).toISOString().slice(0, 10); // last day of month

  const currencies = await getCurrencies(accessToken, conn.organizationId);
  const currencyId = currencies.find(c => c.currency_code === entry.currency)?.currency_id;

  const result = await createZohoExpense(accessToken, conn.organizationId, {
    account_id:              conn.accountId,
    date,
    amount:                  Math.round(totalAmount * 100) / 100,
    currency_id:             currencyId,
    paid_through_account_id: body.paidThroughAccountId,
    vendor_id:               body.vendorId,
    description:             `Payroll – ${entry.employeeName} – ${period}`,
    reference_number:        entry.id,
    line_items:              lineItems,
  });

  if (result.code !== 0) {
    return NextResponse.json({ error: result.message ?? "Zoho Books returned an error" }, { status: 400 });
  }

  const zohoExpenseId = result.expense!.expense_id;

  // Link the Zoho expense ID on the payroll entry
  await prisma.payrollEntry.update({
    where: { id },
    data: { zohoExpenseId },
  });

  // Mark all included expenses (claims + banking fee) with the same Zoho ID
  const expenseIdsToMark = [
    ...claims.map(c => c.id),
    ...(effectiveBankingFeeExpenseId ? [effectiveBankingFeeExpenseId] : []),
  ];
  if (expenseIdsToMark.length > 0) {
    await prisma.expense.updateMany({
      where: { id: { in: expenseIdsToMark } },
      data:  { zohoExpenseId },
    });
  }

  return NextResponse.json({ ok: true, zohoExpenseId });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const { id } = await params;
  const force = req.nextUrl.searchParams.get("force") === "true";

  const [entry, conn] = await Promise.all([
    prisma.payrollEntry.findUnique({
      where: { id },
      select: { id: true, zohoExpenseId: true, bankingFeeExpenseId: true },
    }),
    prisma.zohoConnection.findFirst(),
  ]);

  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!entry.zohoExpenseId) return NextResponse.json({ error: "No Zoho record linked" }, { status: 400 });
  if (!conn) return NextResponse.json({ error: "Zoho not connected" }, { status: 400 });

  if (!force) {
    const { accessToken, updated } = await getValidToken(conn);
    if (updated) await prisma.zohoConnection.update({ where: { id: conn.id }, data: updated });

    const result = await deleteZohoExpense(accessToken, conn.organizationId, entry.zohoExpenseId);
    if (result.code !== 0) {
      return NextResponse.json({ error: result.message ?? "Zoho deletion failed", canForce: true }, { status: 400 });
    }
  }

  await prisma.payrollEntry.update({ where: { id }, data: { zohoExpenseId: null } });

  // Clear zohoExpenseId on all expenses that were linked to this push
  await prisma.expense.updateMany({
    where: { zohoExpenseId: entry.zohoExpenseId },
    data:  { zohoExpenseId: null },
  });

  return NextResponse.json({ ok: true });
}
