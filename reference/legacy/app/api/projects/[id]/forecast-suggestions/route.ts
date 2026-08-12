import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getUsdRates } from "@/lib/fx";

function toUSD(amount: number, from: string, rates: Record<string, number>): number {
  if (!amount || from === "USD") return amount;
  return amount / (rates[from] ?? 1);
}

function genMonths(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ey, em] = to.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en", { month: "short", year: "2-digit" });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  const [project, fxRates] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      include: {
        teamMembers: { where: { hidden: false } },
        timesheets: { include: { entries: true } },
        milestones: { select: { completedAt: true } },
      },
    }),
    getUsdRates(),
  ]);

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!project.endDate) return NextResponse.json({ error: "Project has no end date" }, { status: 400 });

  const allocations = await prisma.projectMemberAllocation.findMany({ where: { projectId } });

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const endMonth = project.endDate.toISOString().slice(0, 7);
  const remainingMonths = genMonths(currentMonth, endMonth);

  const activeMembers = project.teamMembers.filter(m => (m.costPerHour ?? 0) > 0);

  // Build a name→member map covering both team member name and linked person name
  // so timesheet entries imported under a different display name still resolve.
  const memberByName = new Map<string, typeof activeMembers[number]>();
  for (const m of activeMembers) {
    memberByName.set(m.name.toLowerCase(), m);
  }
  // Also index by linked person name (requires a separate query)
  const personsLinked = await prisma.projectTeamMember.findMany({
    where: { projectId, personId: { not: null } },
    include: { person: { select: { name: true } } },
  });
  for (const tm of personsLinked) {
    if (tm.person) {
      const mem = memberByName.get(tm.name.toLowerCase());
      if (mem) memberByName.set(tm.person.name.toLowerCase(), mem);
    }
  }

  // Compute actual spend to date using cost rate (not billing rate from timesheets)
  let actualSpendUSD = 0;
  for (const ts of project.timesheets) {
    for (const e of ts.entries) {
      const mem = memberByName.get(e.employeeName.toLowerCase());
      const rate = mem?.costPerHour ?? e.hourlyRate ?? 0;
      const cur = mem?.currency || e.currency || "USD";
      actualSpendUSD += toUSD(e.hoursLogged * rate, cur, fxRates);
    }
  }

  const budgetUSD = project.contractValue != null
    ? toUSD(project.contractValue, project.currency, fxRates)
    : null;
  const budgetRemaining = budgetUSD != null ? budgetUSD - actualSpendUSD : null;

  const donePct = project.milestones.length > 0
    ? Math.round(project.milestones.filter(m => m.completedAt != null).length / project.milestones.length * 100)
    : null;

  // Current allocations per member per remaining month
  const currentAllocSummary = activeMembers.map(m => {
    const memberAllocs = allocations
      .filter(a => a.memberName.toLowerCase() === m.name.toLowerCase())
      .filter(a => {
        const startM = a.startDate.toISOString().slice(0, 7);
        const endM = a.endDate.toISOString().slice(0, 7);
        return remainingMonths.some(mo => mo >= startM && mo <= endM);
      });

    const byMonth = remainingMonths.map(mo => {
      const hit = memberAllocs.find(a =>
        mo >= a.startDate.toISOString().slice(0, 7) &&
        mo <= a.endDate.toISOString().slice(0, 7)
      );
      return { month: monthLabel(mo), ym: mo, current: hit?.allocationPercent ?? null };
    });

    const costPerHourUSD = toUSD(m.costPerHour ?? 0, m.currency, fxRates);
    return { name: m.name, costPerHourUSD: Math.round(costPerHourUSD), byMonth };
  });

  const client = new Anthropic();

  // Compute the cost of each member's suggested allocation at different percentages
  // so the AI can reason about budget impact concretely.
  const budgetRemainingUSD = budgetRemaining ?? null;
  const costPerMonthAt100 = activeMembers.map(m => ({
    name: m.name,
    costAt100: Math.round(toUSD((m.costPerHour ?? 0) * 160, m.currency, fxRates)),
  }));

  const systemPrompt = `You are a project cost controller giving allocation advice.
Your job is to recommend the MOST REALISTIC allocation percentages possible given the hard budget constraint.
Each team member works 160 hours/month at 100% allocation.
Cost = (allocationPercent / 100) × 160h × costPerHour.
Be honest: if the budget is already exhausted or will be exceeded no matter what, say so clearly.
Return ONLY valid JSON — no explanation outside the JSON.`;

  const userPrompt = `Project financial state:
- End date: ${monthLabel(endMonth)} (${remainingMonths.length} months left: ${remainingMonths.map(monthLabel).join(", ")})
- Actual spend to date (at cost rates): $${Math.round(actualSpendUSD).toLocaleString()} USD
${budgetUSD != null
  ? `- Contract budget: $${Math.round(budgetUSD).toLocaleString()} USD
- Budget remaining for ALL future months combined: $${Math.round(budgetRemainingUSD ?? 0).toLocaleString()} USD${(budgetRemainingUSD ?? 0) <= 0 ? " ← BUDGET IS ALREADY EXHAUSTED" : ""}`
  : "- No fixed budget set"}
${donePct != null ? `- Milestone progress: ${donePct}% of milestones completed` : "- No milestones tracked"}

Team member cost rates:
${costPerMonthAt100.map(m => `- ${m.name}: $${m.costAt100}/month at 100%`).join("\n")}

Current allocations for remaining months:
${JSON.stringify(currentAllocSummary, null, 2)}

Rules you MUST follow:
1. Total projected cost of your suggestions must NOT exceed the budget remaining (if a budget exists).
   If it is impossible to allocate any hours without exceeding the budget, set allocationPercent to 0 and explain why in overall_reasoning.
2. If the budget is already exhausted (remaining ≤ 0), set all allocations to 0 and set cost_warning to true.
3. Be honest about trade-offs: if low allocation will likely delay the project, say so.
4. overall_reasoning must mention: the budget remaining, what the suggestions will cost in total, and the impact on project completion.
5. cost_warning must be true whenever suggested allocations exceed the remaining budget OR the budget is already gone.

Return this exact JSON structure:
{
  "overall_reasoning": "string",
  "cost_warning": false,
  "suggestions": [
    {
      "memberName": "string",
      "months": [
        { "ym": "YYYY-MM", "allocationPercent": number }
      ]
    }
  ]
}`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt,
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ error: "AI returned no valid JSON" }, { status: 500 });

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json(parsed);
  } catch (e) {
    console.error("forecast-suggestions error", e);
    return NextResponse.json({ error: "AI request failed" }, { status: 500 });
  }
}
