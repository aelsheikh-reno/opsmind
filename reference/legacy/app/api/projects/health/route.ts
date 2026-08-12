import { NextResponse } from "next/server";
import { requireRead } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getUsdRates } from "@/lib/fx";

export const dynamic = "force-dynamic";

export type ProjectHealthEntry = {
  id: string;
  name: string;
  clientName: string | null;
  color: string | null;
  health: "at_risk" | "profitable";
  tags: string[];
  budgetBurnPct: number | null;
};

function convertToProjectCurrency(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number {
  if (from === to) return amount;
  const usd = from === "USD" ? amount : (rates[from] ? amount / rates[from] : amount);
  return to === "USD" ? usd : usd * (rates[to] ?? 1);
}

export async function GET() {
  const denied = await requireRead("projects");
  if (denied) return denied;

  const now = new Date();
  const [projects, fxRates] = await Promise.all([
    prisma.project.findMany({
      where: { status: "active" },
      select: {
        id: true, name: true, clientName: true, color: true,
        billingType: true, contractValue: true, currency: true, endDate: true,
        milestones: { select: { id: true, completedAt: true } },
        expenses:   { select: { amount: true } },
        teamMembers: {
          where: { hidden: false },
          select: { name: true, costPerHour: true, currency: true },
        },
        timesheets: {
          select: {
            entries: { select: { employeeName: true, hoursLogged: true, hourlyRate: true } },
          },
        },
        invoices: { select: { amount: true, status: true } },
      },
    }),
    getUsdRates(),
  ]);

  const results: ProjectHealthEntry[] = [];

  for (const p of projects) {
    const projectCurrency = p.currency;

    // Build rate lookup by member name (same logic as ProjectDetailClient)
    const rateByName = new Map(p.teamMembers.map(m => [m.name.toLowerCase(), m]));

    // Labor cost: prefer team member costPerHour (configured), fall back to entry rate
    const allEntries = p.timesheets.flatMap(t => t.entries);
    const labor = allEntries.reduce((s, e) => {
      const member = rateByName.get(e.employeeName.toLowerCase());
      let rate: number;
      if (member?.costPerHour != null) {
        rate = convertToProjectCurrency(member.costPerHour, member.currency, projectCurrency, fxRates);
      } else {
        rate = e.hourlyRate ?? 0;
      }
      return s + e.hoursLogged * rate;
    }, 0);

    const expenses  = p.expenses.reduce((s, e) => s + e.amount, 0);
    const totalCost = labor + expenses;

    const collected = p.invoices
      .filter(i => i.status === "paid")
      .reduce((s, i) => s + i.amount, 0);

    const contractValue = p.contractValue ?? 0;

    const overBudget = contractValue > 0 && totalCost > 0 && totalCost > contractValue;
    const overdue    = p.endDate != null && p.endDate < now;

    const daysLeft    = p.endDate
      ? Math.ceil((p.endDate.getTime() - now.getTime()) / 86400000)
      : null;
    const completedMs = p.milestones.filter(m => m.completedAt).length;
    const totalMs     = p.milestones.length;
    const stalledMs   =
      p.billingType === "milestone" &&
      totalMs > 0 &&
      completedMs / totalMs < 0.5 &&
      daysLeft != null && daysLeft >= 0 && daysLeft <= 60;

    const budgetBurnPct = contractValue > 0 && totalCost > 0
      ? Math.min(100, Math.round((totalCost / contractValue) * 100))
      : null;

    const isAtRisk = overdue || overBudget || stalledMs;

    if (isAtRisk) {
      const tags: string[] = [];
      if (overdue)    tags.push("Past end date");
      if (overBudget) tags.push("Over budget");
      if (stalledMs)  tags.push(`${completedMs}/${totalMs} milestones — ${daysLeft}d left`);
      results.push({ id: p.id, name: p.name, clientName: p.clientName, color: p.color, health: "at_risk", tags, budgetBurnPct });
      continue;
    }

    // Margin / profitability — requires tracked costs and a contract value
    const underBudget  = contractValue > 0 && totalCost > 0 && totalCost < contractValue;
    const cashPositive = collected > 0 && collected > totalCost;
    if (underBudget || cashPositive) {
      const margin = contractValue > 0 && totalCost > 0
        ? Math.round((1 - totalCost / contractValue) * 100)
        : null;

      // Margin below 15% → still "at risk" (low margin warning)
      const lowMargin = margin != null && margin < 15;
      if (lowMargin) {
        const tags = [`${margin}% margin · At risk`];
        results.push({ id: p.id, name: p.name, clientName: p.clientName, color: p.color, health: "at_risk", tags, budgetBurnPct });
      } else {
        const tags: string[] = [];
        if (margin != null) tags.push(`${margin}% margin`);
        else if (cashPositive) tags.push("Cash positive");
        results.push({ id: p.id, name: p.name, clientName: p.clientName, color: p.color, health: "profitable", tags, budgetBurnPct });
      }
    }
  }

  return NextResponse.json({ projects: results });
}
