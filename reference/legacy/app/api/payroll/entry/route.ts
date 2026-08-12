import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { requireWrite } from "@/lib/permissions";

// PATCH /api/payroll/entry?entryId=xxx&paid=true[&bankingFee=50&bankingFeeCurrency=AED]
export async function PATCH(req: NextRequest) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const entryId            = sp.get("entryId");
  const paid               = sp.get("paid") === "true";
  const rawFee             = sp.get("bankingFee");
  const bankingFee         = rawFee !== null && parseFloat(rawFee) > 0 ? parseFloat(rawFee) : null;
  const bankingFeeCurrency = sp.get("bankingFeeCurrency") || null;

  if (!entryId) return NextResponse.json({ error: "entryId required" }, { status: 400 });

  const entry = await prisma.payrollEntry.findUnique({
    where: { id: entryId },
    include: {
      payrollRun: {
        include: { entries: { select: { id: true, isPaid: true } } },
      },
      person: { select: { documentId: true } },
    },
  });

  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Banking fee: create or clear the linked Expense record
  let bankingFeeExpenseId: string | null = entry.bankingFeeExpenseId ?? null;

  if (paid && bankingFee !== null && entry.personId && entry.payrollRun.month && entry.payrollRun.year) {
    const { month, year, period } = entry.payrollRun as { month: number; year: number; period: string | null };
    const monthEnd = new Date(year, month, 0); // last day of payroll month
    const feeExpense = await prisma.expense.create({
      data: {
        name:          `Bank Transfer Fee – ${entry.employeeName} – ${period ?? `${month}/${year}`}`,
        amount:        bankingFee,
        amountConfirmed: true,
        currency:      bankingFeeCurrency ?? entry.currency,
        expenseType:   "banking_fee",
        paymentMethod: "bank_transfer",
        dueOn:         monthEnd,
        notes:         "Transaction cost for payroll bank transfer",
        personId:      entry.personId,
      },
    });
    bankingFeeExpenseId = feeExpense.id;
  } else if (!paid && bankingFeeExpenseId) {
    // Unmark paid: remove the banking fee expense if it hasn't been pushed to Zoho yet
    const feeExpense = await prisma.expense.findUnique({
      where: { id: bankingFeeExpenseId },
      select: { id: true, zohoExpenseId: true },
    });
    if (feeExpense && !feeExpense.zohoExpenseId) {
      await prisma.expense.delete({ where: { id: bankingFeeExpenseId } });
    }
    bankingFeeExpenseId = null;
  }

  await prisma.payrollEntry.update({
    where: { id: entryId },
    data: {
      isPaid: paid,
      ...(paid && bankingFee !== null ? { bankingFee, bankingFeeCurrency: bankingFeeCurrency ?? entry.currency, bankingFeeExpenseId } : {}),
      ...(!paid ? { bankingFee: null, bankingFeeCurrency: null, bankingFeeExpenseId: null } : {}),
    },
  });

  // Auto-complete/un-complete this person's expenses for the payroll month
  if (entry.personId && entry.payrollRun.month !== null && entry.payrollRun.year !== null) {
    const month      = entry.payrollRun.month;
    const year       = entry.payrollRun.year;
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd   = new Date(year, month, 1);

    // Same dual logic as payroll display: explicit payrollMonth assignment OR date-range fallback
    const toUpdate = await prisma.expense.findMany({
      where: {
        personId: entry.personId,
        expenseType: { not: "banking_fee" },
        AND: [
          { OR: [{ claimStatus: null }, { claimStatus: "approved" }] },
          { OR: [
            { payrollMonth: month, payrollYear: year },
            { payrollMonth: null, OR: [
              { dueOn: { gte: monthStart, lt: monthEnd } },
              { asanaCreatedAt: { gte: monthStart, lt: monthEnd } },
            ]},
          ]},
        ],
      },
      select: { id: true },
    });

    for (const { id } of toUpdate) {
      await prisma.expense.update({ where: { id }, data: { completed: paid } });
    }
  }

  // Sync the matching PaymentSchedule for this employee's contract month
  if (entry.payrollRun.month !== null && entry.payrollRun.year !== null && entry.person?.documentId) {
    const monthStart = new Date(entry.payrollRun.year, entry.payrollRun.month - 1, 1);
    const monthEnd   = new Date(entry.payrollRun.year, entry.payrollRun.month, 1);
    await prisma.paymentSchedule.updateMany({
      where: { documentId: entry.person.documentId, dueDate: { gte: monthStart, lt: monthEnd } },
      data: { isPaid: paid },
    });
  }

  // Derive updated paid state for all entries in the run
  const allPaidStates = entry.payrollRun.entries.map(e =>
    e.id === entryId ? paid : e.isPaid
  );
  const allPaid = allPaidStates.every(Boolean);
  const anyPaid = allPaidStates.some(Boolean);

  if (allPaid && !entry.payrollRun.isProcessed) {
    await prisma.payrollRun.update({
      where: { id: entry.payrollRunId },
      data: { isProcessed: true, processedAt: new Date() },
    });
  } else if (!anyPaid && entry.payrollRun.isProcessed) {
    await prisma.payrollRun.update({
      where: { id: entry.payrollRunId },
      data: { isProcessed: false, processedAt: null },
    });
  }

  if (entry.personId) {
    await audit({
      action: paid ? "payroll.paid" : "payroll.unpaid",
      entityType: "person",
      entityId: entry.personId,
      entityLabel: entry.employeeName,
      details: { period: entry.payrollRun.period ?? entry.payrollRun.id, ...(bankingFee ? { bankingFee } : {}) },
    });
  }
  return NextResponse.json({ success: true, allPaid });
}
