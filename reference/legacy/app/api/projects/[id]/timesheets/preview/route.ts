import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireRead } from "@/lib/permissions";
import { parseSheet, parseTimesheetRows } from "@/lib/timesheetParser";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const BATCH_SIZE = 200;

const AI_FILTER_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index:   { type: "number" },
          include: { type: "boolean" },
          reason:  { type: "string" },
        },
        required: ["index", "include", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["rows"],
  additionalProperties: false,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRead("projects");
  if (denied) return denied;

  const { id: projectId } = await params;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });

  const month = (formData.get("month") as string | null)?.trim() || null;
  const aiPrompt = (formData.get("aiPrompt") as string | null)?.trim() || null;
  const allMonths = formData.get("allMonths") === "true";

  const buffer = Buffer.from(await file.arrayBuffer());
  let rows: Array<Record<string, unknown>> | null = null;
  try {
    rows = parseSheet(buffer);
  } catch {
    return NextResponse.json(
      { error: "Could not parse file — upload CSV or Excel" },
      { status: 400 },
    );
  }
  if (!rows) return NextResponse.json({ error: "Could not parse file" }, { status: 400 });
  if (rows.length === 0) return NextResponse.json({ error: "File appears to be empty" }, { status: 400 });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      clientName: true,
      billingType: true,
      milestones: { select: { id: true, name: true }, orderBy: { order: "asc" } },
    },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const isPS = project.billingType === "ps";
  const projectNames = [project.name, project.clientName].filter(Boolean) as string[];
  const { parsed, hasProjectCol, hasDateCol } = parseTimesheetRows(rows, projectNames, project.milestones);

  if (parsed.length === 0) {
    return NextResponse.json(
      {
        error:
          "No valid rows found. File needs a column for the person (Employee, Name, User, Member, Assignee…) and one for time (Hours, Duration, Time Spent, Hrs…).",
      },
      { status: 400 },
    );
  }

  // Collect unique months from date columns
  const monthCounts = new Map<string, number>();
  for (const r of parsed) {
    if (r.date) {
      const m = r.date.slice(0, 7);
      monthCounts.set(m, (monthCounts.get(m) ?? 0) + 1);
    }
  }
  const availableMonths: string[] = [...monthCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m]) => m);
  const detectedMonth: string | null = monthCounts.size > 0
    ? [...monthCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  // In allMonths mode suggest every project-matching row regardless of date
  const effectiveMonth = allMonths ? null : (month || detectedMonth);

  // Rule-based suggested flag
  const ruleFiltered = parsed.map(r => {
    const projectMatch = !hasProjectCol || r.matchScore >= 0.5;
    if (isPS) {
      const monthMatch = !effectiveMonth || (!!r.date && r.date.slice(0, 7) === effectiveMonth);
      return { ...r, suggested: projectMatch && monthMatch };
    }
    return {
      ...r,
      suggested: r.suggested && (!effectiveMonth || !hasDateCol || r.date?.slice(0, 7) === effectiveMonth),
    };
  });

  // Person rate matching — include all people so unlinked members can also be matched
  const persons = await prisma.person.findMany({
    select: { id: true, name: true, costPerHour: true, billingRate: true, rateCurrency: true },
  });

  function normN(n: string) {
    return n.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  }
  function nameScore(a: string, b: string): number {
    const na = normN(a), nb = normN(b);
    if (na === nb) return 1;
    const wa = na.split(" ").filter(w => w.length >= 2);
    const wb = nb.split(" ").filter(w => w.length >= 2);
    if (!wa.length || !wb.length) return 0;
    const overlap = wa.filter(w => wb.includes(w)).length;
    return overlap / Math.max(wa.length, wb.length);
  }

  const matchCache = new Map<string, typeof persons[0] | null>();
  function matchPerson(empName: string) {
    if (matchCache.has(empName)) return matchCache.get(empName)!;
    let best: typeof persons[0] | null = null, bestScore = 0;
    for (const p of persons) {
      const s = nameScore(empName, p.name);
      if (s > bestScore && s >= 0.5) { best = p; bestScore = s; }
    }
    matchCache.set(empName, best);
    return best;
  }

  const rowsWithRates = ruleFiltered.map(r => {
    const match = matchPerson(r.employeeName);
    return {
      ...r,
      matchedPersonId: match?.id ?? null,
      matchedPersonName: match?.name ?? null,
      matchedCostPerHour: match?.costPerHour ?? null,
      matchedBillingRate: match?.billingRate ?? null,
      matchedRateCurrency: match?.rateCurrency ?? null,
      hourlyRate: r.hourlyRate ?? match?.costPerHour ?? null,
      aiReason: undefined as string | undefined,
    };
  });

  // AI-powered filtering — runs automatically when a project column is detected,
  // so name variations/abbreviations in the timesheet are handled without user action.
  // A user-typed aiPrompt adds extra instructions on top.
  const runAiFilter = hasProjectCol || !!aiPrompt;
  let aiFilterApplied = false;

  if (runAiFilter) {
    try {
      const projectLabel = `"${project.name}"${project.clientName ? ` (client: ${project.clientName})` : ""}`;

      function rowToText(r: typeof rowsWithRates[0]) {
        return (
          `Row ${r.index}: Employee: ${r.employeeName}` +
          // Always show Project field when a project column exists so the AI can
          // see "(none)" for blank rows — otherwise it can't act on instructions
          // like "discard entries with no project".
          (hasProjectCol ? ` | Project: ${r.projectColValue || "(none)"}` : "") +
          (r.taskName ? ` | Task: ${r.taskName}` : "") +
          (r.date     ? ` | Date: ${r.date}`     : "") +
          (r.role     ? ` | Role: ${r.role}`     : "") +
          (r.notes    ? ` | Notes: ${r.notes}`   : "") +
          ` | Hours: ${r.hoursLogged}`
        );
      }

      async function filterBatch(batch: typeof rowsWithRates) {
        const lines: string[] = [];

        if (hasProjectCol) {
          lines.push(
            `This timesheet covers multiple projects. Include ONLY rows where the "Project" column refers to ${projectLabel}.`,
            `The name in the timesheet may be abbreviated, use a code, or vary slightly from the system name — use judgment to accept reasonable variations.`,
            `Rows with Project: (none) have a blank project column — exclude them unless the user instruction says otherwise.`,
            `Exclude rows that clearly name a different project. When in doubt, exclude.`,
          );
        }

        if (aiPrompt) {
          lines.push(`Additional instruction: "${aiPrompt}"`);
        }

        lines.push(
          ``,
          `Keep each reason to 5 words or fewer.`,
          ``,
          ...batch.map(rowToText),
          ``,
          `Return your decisions for every row listed above.`,
        );

        const response = await anthropic.beta.messages.parse({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 8192,
          output_config: { format: { type: "json_schema", schema: AI_FILTER_SCHEMA } },
          messages: [{ role: "user", content: lines.join("\n") }],
        });
        const result = response.parsed_output as { rows: Array<{ index: number; include: boolean; reason: string }> } | null;
        return result?.rows ?? [];
      }

      const batches: (typeof rowsWithRates)[] = [];
      for (let i = 0; i < rowsWithRates.length; i += BATCH_SIZE) {
        batches.push(rowsWithRates.slice(i, i + BATCH_SIZE));
      }

      const batchResults = await Promise.all(batches.map(filterBatch));
      const byIndex = new Map(batchResults.flat().map(r => [r.index, r]));

      for (const row of rowsWithRates) {
        const ai = byIndex.get(row.index);
        if (ai) {
          row.suggested = ai.include;
          row.aiReason  = ai.reason;
        }
      }

      // Re-enforce month filter — the AI sees all rows and can mark entries from
      // other months as suggested, overriding the earlier month-based rule filter.
      // In single-month mode, clamp suggestions back to the effective month only.
      if (!allMonths && effectiveMonth && hasDateCol) {
        for (const row of rowsWithRates) {
          if (row.suggested && row.date?.slice(0, 7) !== effectiveMonth) {
            row.suggested = false;
          }
        }
      }

      aiFilterApplied = true;
    } catch {
      // AI filter failed — fall back to rule-based suggestions silently
    }
  }

  const suggestedCount = rowsWithRates.filter(r => r.suggested).length;

  return NextResponse.json({
    rows: rowsWithRates,
    hasProjectCol,
    hasDateCol,
    detectedMonth,
    availableMonths,
    allMonths,
    monthFiltered: !!(effectiveMonth && hasDateCol),
    totalRowCount: rowsWithRates.length,
    suggestedCount,
    filename: file.name,
    projectName: project.name,
    clientName: project.clientName ?? null,
    aiFilterApplied,
  });
}
