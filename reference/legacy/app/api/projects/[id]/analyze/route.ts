import { NextRequest, NextResponse } from "next/server";
import { requireRead } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getUsdRates } from "@/lib/fx";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

const client = new Anthropic();

function convertCurrency(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount;
  const usd = from === "USD" ? amount : (rates[from] ? amount / rates[from] : amount);
  return to === "USD" ? usd : usd * (rates[to] ?? 1);
}

function fmt(n: number, currency: string) {
  return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// ── GET: return cached insight ────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRead("projects");
  if (denied) return denied;

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { insightText: true, insightAt: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    text: project.insightText ?? null,
    analyzedAt: project.insightAt?.toISOString() ?? null,
  });
}

// ── PATCH: save insight after streaming ───────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRead("projects");
  if (denied) return denied;

  const { id } = await params;
  const { text } = await req.json() as { text: string };

  await prisma.project.update({
    where: { id },
    data: { insightText: text, insightAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}

// ── POST: stream fresh analysis ───────────────────────────────────────────────
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRead("projects");
  if (denied) return denied;

  const { id } = await params;

  const [project, fxRates] = await Promise.all([
    prisma.project.findUnique({
      where: { id },
      include: {
        milestones: { orderBy: { order: "asc" } },
        teamMembers: { where: { hidden: false } },
        timesheets: { include: { entries: true } },
        expenses: true,
        invoices: true,
        services: { include: { activities: true } },
      },
    }),
    getUsdRates(),
  ]);

  if (!project) return new Response("Not found", { status: 404 });

  const currency = project.currency;
  const now = new Date();

  // ── Financial metrics (mirror ProfitabilityPanel logic) ───────────────────
  const rateByName = new Map(
    project.teamMembers.map(m => [m.name.toLowerCase(), m])
  );

  const allEntries = project.timesheets.flatMap(t => t.entries);
  const totalHours = allEntries.reduce((s, e) => s + e.hoursLogged, 0);

  const laborCost = allEntries.reduce((s, e) => {
    const member = rateByName.get(e.employeeName.toLowerCase());
    const rate = member?.costPerHour != null
      ? convertCurrency(member.costPerHour, member.currency, currency, fxRates)
      : (e.hourlyRate ?? 0);
    return s + e.hoursLogged * rate;
  }, 0);

  const expenseCost = project.expenses.reduce((s, e) => s + e.amount, 0);
  const totalCost = laborCost + expenseCost;
  const contractValue = project.contractValue ?? 0;
  const margin = contractValue > 0 && totalCost > 0
    ? ((contractValue - totalCost) / contractValue) * 100
    : null;

  const collected = project.invoices
    .filter(i => i.status === "paid")
    .reduce((s, i) => s + i.amount, 0);
  const invoiced = project.invoices
    .filter(i => i.status !== "draft")
    .reduce((s, i) => s + i.amount, 0);

  const startDate = project.startDate;
  const endDate = project.endDate;
  const daysElapsed = startDate
    ? Math.max(0, Math.ceil((now.getTime() - startDate.getTime()) / 86400000))
    : null;
  const daysLeft = endDate
    ? Math.ceil((endDate.getTime() - now.getTime()) / 86400000)
    : null;
  const totalDuration = (startDate && endDate)
    ? Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000)
    : null;
  const timeElapsedPct = (daysElapsed && totalDuration)
    ? (daysElapsed / totalDuration) * 100
    : null;

  // Weekly burn rate (last 4 weeks if data exists, else total / weeks elapsed)
  const weeksElapsed = daysElapsed ? daysElapsed / 7 : null;
  const weeklyBurn = (weeksElapsed && weeksElapsed > 0 && totalCost > 0)
    ? totalCost / weeksElapsed
    : null;
  const weeksToExhaust = (weeklyBurn && contractValue > totalCost)
    ? (contractValue - totalCost) / weeklyBurn
    : null;

  // Milestones
  const milestones = project.milestones;
  const completedMs = milestones.filter(m => m.completedAt).length;
  const overdueMilestones = milestones.filter(m =>
    !m.completedAt && m.dueDate && new Date(m.dueDate) < now
  );
  const unbilledMilestones = milestones.filter(m =>
    m.completedAt && m.billingAmount && m.billingAmount > 0 &&
    !project.invoices.some(i => i.milestoneId === m.id && i.status !== "draft")
  );

  // Team
  const memberHours = new Map<string, number>();
  for (const e of allEntries) {
    memberHours.set(e.employeeName, (memberHours.get(e.employeeName) ?? 0) + e.hoursLogged);
  }
  const missingRates = Array.from(memberHours.entries())
    .filter(([name, hrs]) => hrs > 0 && !rateByName.get(name.toLowerCase())?.costPerHour)
    .map(([name, hrs]) => `${name} (${Math.round(hrs)}h)`);

  // ── Build context prompt ───────────────────────────────────────────────────
  const lines: string[] = [
    `PROJECT SNAPSHOT — ${now.toDateString()}`,
    `Name: ${project.name}`,
    `Client: ${project.clientName ?? "Not set"}`,
    `Type: ${project.billingType}`,
    `Status: ${project.status}`,
    `Start: ${startDate ? startDate.toDateString() : "Not set"}`,
    `End: ${endDate ? endDate.toDateString() : "Not set"}`,
    daysLeft != null ? `Days remaining: ${daysLeft}` : "",
    timeElapsedPct != null ? `Timeline consumed: ${timeElapsedPct.toFixed(0)}%` : "",
    "",
    "FINANCIALS",
    `Contract value: ${fmt(contractValue, currency)}`,
    `Labor cost: ${fmt(laborCost, currency)} (${Math.round(totalHours)} hrs logged)`,
    `Expenses: ${fmt(expenseCost, currency)}`,
    `Total cost: ${fmt(totalCost, currency)}`,
    contractValue > 0 ? `Remaining budget: ${fmt(contractValue - totalCost, currency)}` : "",
    margin != null ? `Current margin: ${margin.toFixed(1)}%` : "",
    weeklyBurn ? `Weekly burn rate: ${fmt(weeklyBurn, currency)}/week` : "",
    weeksToExhaust != null ? `Budget lasts: ~${Math.round(weeksToExhaust)} more weeks at current burn` : "",
    `Invoiced: ${fmt(invoiced, currency)}`,
    `Collected: ${fmt(collected, currency)}`,
    "",
    "MILESTONES",
    `Total: ${milestones.length}, Completed: ${completedMs}`,
    overdueMilestones.length > 0
      ? `Overdue milestones: ${overdueMilestones.map(m => m.name).join(", ")}`
      : "No overdue milestones",
    unbilledMilestones.length > 0
      ? `Completed but not yet invoiced: ${unbilledMilestones.map(m => `${m.name} (${fmt(m.billingAmount!, currency)})`).join(", ")}`
      : "All completed milestones have invoices",
    "",
    "TEAM",
    `Members with logged hours: ${memberHours.size}`,
    memberHours.size > 0
      ? `Top contributors: ${Array.from(memberHours.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, h]) => `${n} ${Math.round(h)}h`).join(", ")}`
      : "",
    missingRates.length > 0
      ? `Missing cost rates (cost data incomplete): ${missingRates.join(", ")}`
      : "All active members have cost rates configured",
  ].filter(l => l !== "");

  const systemPrompt = `You are a senior project controller and operations advisor for a professional services firm based in the UAE. You analyze project data and give the project owner clear, direct, actionable insights to keep the project healthy and profitable.

Rules:
- Give exactly 4-6 insights. No more, no less.
- Each insight must be a distinct block starting with one of these prefixes on its own line: ⚠️, 🔴, ✅, 💡, 📊
- ⚠️ = warning (approaching a problem), 🔴 = critical (problem now), ✅ = positive (things going well), 💡 = opportunity/action, 📊 = data observation
- After the prefix emoji, write a short bold title (3-7 words), then on the next line write 1-2 sentences of explanation. End with a concrete suggested action when relevant.
- Use the actual project numbers in your explanation (amounts, percentages, days).
- Do not repeat the same insight in different words.
- If margin is above 25% and everything is on track, still find something constructive to say (billing pace, risk prevention, team load).
- Speak directly to the project owner: "you", "your team", not "the project manager".
- Do not add headers, intros, or conclusions — just the insight blocks.
- After the body text of an insight, if there is a direct in-app action the user can take, add ONE action tag on its own line using exactly this format (no extra spaces or text):
  [ACTION:edit_project] — use when the user should edit project settings (missing dates, contract value, billing type)
  [ACTION:create_invoice:AMOUNT] — use when an invoice should be issued; replace AMOUNT with the numeric value only (no currency symbol, no commas) e.g. [ACTION:create_invoice:15000]
  [ACTION:view_milestones] — use when the user should review milestone progress or overdue milestones
  [ACTION:view_team] — use when the user should review team cost rates or utilization
  [ACTION:view_invoices] — use when the user should check invoice or payment status
- Not every insight needs an action tag. Only add one when the action is direct and obvious.`;

  const userMessage = `Analyze this project and give me actionable insights:\n\n${lines.join("\n")}`;

  // ── Stream response ────────────────────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const anthropicStream = await client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        });

        for await (const chunk of anthropicStream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Analysis failed";
        controller.enqueue(encoder.encode(`\n🔴 **Error**\n${msg}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
