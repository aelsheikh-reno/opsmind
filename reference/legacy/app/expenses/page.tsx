import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getUsdRates, getRatesCachedAt, getBestMonthRates } from "@/lib/fx";
import SidebarWrapper from "../components/SidebarWrapper";
import TopBar from "../components/TopBar";
import ExpensesClient from "./ExpensesClient";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const isAdmin = session.user?.role === "admin";

  // Retroactive sync: complete expenses belonging to already-paid payroll runs.
  // Calls update per expense ID — same code path as /api/expenses/[id]/status.
  const paidRuns = await prisma.payrollRun.findMany({
    where: { isProcessed: true, month: { not: null }, year: { not: null } },
    select: { month: true, year: true },
  });
  for (const { month, year } of paidRuns) {
    const m = month!;
    const y = year!;
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd   = new Date(y, m, 1);
    const toComplete = await prisma.expense.findMany({
      where: {
        completed: false,
        personId: { not: null },
        AND: [
          { OR: [{ claimStatus: null }, { claimStatus: "approved" }] },
          { OR: [
            { payrollMonth: m, payrollYear: y },
            { payrollMonth: null, OR: [
              { dueOn: { gte: monthStart, lt: monthEnd } },
              { asanaCreatedAt: { gte: monthStart, lt: monthEnd } },
            ]},
          ]},
        ],
      },
      select: { id: true },
    });
    for (const { id } of toComplete) {
      await prisma.expense.update({ where: { id }, data: { completed: true } });
    }
  }

  const [expenses, persons, liveRates, ratesCachedAt, paidRunsForClient, budgets] = await Promise.all([
    prisma.expense.findMany({
      where: { expenseType: { not: "banking_fee" } },
      orderBy: { createdAt: "desc" },
      include: {
        attachments: true,
        person: { select: { id: true, name: true, jobTitle: true } },
        budget: { select: { name: true } },
      },
    }),
    prisma.person.findMany({
      where: { exitDate: null },
      select: { id: true, name: true, jobTitle: true },
      orderBy: { name: "asc" },
    }),
    getUsdRates(),
    getRatesCachedAt(),
    prisma.payrollRun.findMany({
      where: { isProcessed: true, month: { not: null }, year: { not: null } },
      select: { month: true, year: true },
    }),
    prisma.budget.findMany({
      where: { active: true },
      select: { id: true, name: true, category: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Build per-month rates using cached historical rates (stored in Setting table)
  const now = new Date();
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const uniqueMonths = new Set<string>();
  for (const e of expenses) {
    const d = e.dueOn ?? e.asanaCreatedAt;
    if (!d) continue;
    const date = new Date(d);
    uniqueMonths.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }

  // Fetch per-month rates using the same priority as the finance page:
  // locked PayrollRun snapshot → cached historical → fetched historical → live.
  // This ensures both pages always agree on the rate for a given month.
  const monthRates: Record<string, Record<string, number>> = {};
  await Promise.all(
    Array.from(uniqueMonths).map(async (key) => {
      if (key >= nowKey) {
        monthRates[key] = liveRates;
        return;
      }
      const [year, month] = key.split("-").map(Number);
      monthRates[key] = await getBestMonthRates(year, month);
    })
  );

  const totals: Record<string, { total: number; confirmed: number; count: number }> = {};
  for (const e of expenses) {
    if (e.claimStatus === "rejected") continue;
    if (!totals[e.currency]) totals[e.currency] = { total: 0, confirmed: 0, count: 0 };
    totals[e.currency].count++;
    if (e.amount != null) {
      totals[e.currency].total += e.amount;
      if (e.amountConfirmed) totals[e.currency].confirmed += e.amount;
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Claims & Expenses" }]} />
        <main className="px-4 sm:px-8 py-4 sm:py-6">
          <ExpensesClient
            expenses={expenses}
            totals={totals}
            rates={liveRates}
            monthRates={monthRates}
            persons={persons}
            ratesSyncedAt={ratesCachedAt?.toISOString() ?? null}
            isAdmin={isAdmin}
            paidPayrollMonths={paidRunsForClient.map(r => ({ month: r.month!, year: r.year! }))}
            budgets={budgets}
          />
        </main>
      </div>
    </div>
  );
}
