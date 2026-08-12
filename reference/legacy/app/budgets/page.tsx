import { prisma } from "@/lib/prisma";
import { getUsdRates } from "@/lib/fx";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { resolvePermissions } from "@/lib/permissions";
import SidebarWrapper from "../components/SidebarWrapper";
import TopBar from "../components/TopBar";
import BudgetsClient from "./BudgetsClient";

export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = resolvePermissions(session.user.role, session.user.permissions);
  if (perms.finances === "none") redirect("/");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serialiseExp = (e: any) => ({
    ...e,
    dueOn:     e.dueOn     ? new Date(e.dueOn).toISOString()     : null,
    createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : null,
  });

  const [budgetsRaw, fxRates, unassignedExpenses] = await Promise.all([
    prisma.budget.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        expenses: {
          select: {
            id: true, name: true, amount: true, currency: true,
            expenseType: true, dueOn: true, completed: true,
            claimStatus: true, submitterEmail: true, personId: true,
            asanaTaskGid: true, createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    getUsdRates(),
    prisma.expense.findMany({
      where: { budgetId: null },
      select: {
        id: true, name: true, amount: true, currency: true,
        expenseType: true, dueOn: true, completed: true,
        claimStatus: true, submitterEmail: true, personId: true,
        asanaTaskGid: true, createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);

  // Fetch payroll entries per budget separately — guarded so a missing schema
  // column (production DB not yet migrated) doesn't crash the whole page.
  type PayrollEntryRow = { id: string; employeeName: string; salary: number; currency: string; isPaid: boolean; payrollRun: { month: number | null; year: number | null } };
  let payrollEntriesByBudget = new Map<string, PayrollEntryRow[]>();
  try {
    const entries = await prisma.payrollEntry.findMany({
      where: { budgetId: { not: null } },
      select: {
        id: true, employeeName: true, salary: true, currency: true,
        isPaid: true, budgetId: true,
        payrollRun: { select: { month: true, year: true } },
      },
      orderBy: { payrollRun: { year: "desc" } },
    });
    for (const e of entries) {
      if (!e.budgetId) continue;
      const list = payrollEntriesByBudget.get(e.budgetId) ?? [];
      list.push(e);
      payrollEntriesByBudget.set(e.budgetId, list);
    }
  } catch {
    // budgetId column not yet in DB — payroll section hidden until migrated
  }

  const serialisedBudgets = budgetsRaw.map(b => ({
    ...b,
    startDate: b.startDate ? b.startDate.toISOString() : null,
    endDate:   b.endDate   ? b.endDate.toISOString()   : null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    expenses:  b.expenses.map(serialiseExp),
    payrollEntries: payrollEntriesByBudget.get(b.id) ?? [],
  }));

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Budgets" }]} />
        <main className="flex-1">
          <BudgetsClient
            initialBudgets={serialisedBudgets}
            initialUnassigned={unassignedExpenses.map(serialiseExp)}
            fxRates={fxRates}
          />
        </main>
      </div>
    </div>
  );
}
