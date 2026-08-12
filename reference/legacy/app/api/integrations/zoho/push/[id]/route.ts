import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";
import { createZohoExpense, getCurrencies, getValidToken } from "@/lib/zoho-books";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { paidThroughAccountId?: string };
  const paidThroughAccountId = body.paidThroughAccountId;

  const [expense, conn] = await Promise.all([
    prisma.expense.findUnique({
      where: { id },
      select: {
        id: true, name: true, amount: true, currency: true,
        dueOn: true, asanaCreatedAt: true, notes: true,
        zohoExpenseId: true, expenseType: true, submitterEmail: true,
        person: { select: { name: true } },
      },
    }),
    prisma.zohoConnection.findFirst(),
  ]);

  console.log("[zoho/push] expense:", expense?.id, "zohoExpenseId:", expense?.zohoExpenseId, "amount:", expense?.amount, "orgId:", conn?.organizationId, "accountId:", conn?.accountId);

  if (!expense) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!conn)    return NextResponse.json({ error: "Zoho Books not connected" }, { status: 400 });
  if (!conn.accountId) return NextResponse.json({ error: "No default expense account set — configure it in Integrations → Zoho Books" }, { status: 400 });
  if (expense.zohoExpenseId) return NextResponse.json({ error: "Already pushed to Zoho Books" }, { status: 400 });
  if (expense.expenseType === "banking_fee") return NextResponse.json({ error: "Banking fees are pushed as part of the payroll expense, not separately" }, { status: 400 });
  if (!expense.amount) return NextResponse.json({ error: "Expense has no amount" }, { status: 400 });

  const { accessToken, updated } = await getValidToken(conn);
  if (updated) {
    await prisma.zohoConnection.update({ where: { id: conn.id }, data: updated });
  }

  const date = (expense.dueOn ?? expense.asanaCreatedAt ?? new Date()).toISOString().slice(0, 10);

  // Pick account: per-type mapping first, fall back to default
  const typeMapping: Record<string, string> = (() => {
    try { return JSON.parse(conn.claimTypeAccounts ?? "{}"); } catch { return {}; }
  })();
  const accountId = (expense.expenseType && typeMapping[expense.expenseType]) || conn.accountId;

  // Clean description: expense name + claimant
  const claimant = expense.person?.name ?? expense.submitterEmail ?? null;
  const description = claimant
    ? `${expense.name} — ${claimant}`
    : expense.name;

  // Resolve currency_id from ISO code — Zoho ignores currency_code on expenses
  const currencies = await getCurrencies(accessToken, conn.organizationId);
  const currencyId = currencies.find(c => c.currency_code === expense.currency)?.currency_id;

  const result = await createZohoExpense(accessToken, conn.organizationId, {
    account_id:              accountId,
    date,
    amount:                  expense.amount,
    currency_id:             currencyId,
    paid_through_account_id: paidThroughAccountId,
    description,
    reference_number:        expense.id,
  });

  console.log("[zoho/push] orgId:", conn.organizationId, "accountId:", conn.accountId);
  console.log("[zoho/push] result:", JSON.stringify(result));
  if (result.code !== 0) {
    return NextResponse.json({ error: result.message ?? "Zoho Books returned an error" }, { status: 400 });
  }

  await prisma.expense.update({
    where: { id },
    data: { zohoExpenseId: result.expense!.expense_id },
  });

  return NextResponse.json({ ok: true, zohoExpenseId: result.expense!.expense_id });
}
