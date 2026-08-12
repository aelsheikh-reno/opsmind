import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireRead } from "@/lib/permissions";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

const client = new Anthropic();

const SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          entryId:     { type: "string" },
          milestoneId: { anyOf: [{ type: "string" }, { type: "null" }] },
          reason:      { type: "string" },
        },
        required: ["entryId", "milestoneId", "reason"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
  },
  required: ["suggestions", "summary"],
  additionalProperties: false,
};

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; importId: string }> },
) {
  const denied = await requireRead("projects");
  if (denied) return denied;

  const { id: projectId, importId } = await params;

  const imp = await prisma.timesheetImport.findUnique({
    where: { id: importId },
    include: {
      entries: {
        select: { id: true, taskName: true, employeeName: true, role: true, milestoneId: true },
      },
    },
  });
  if (!imp || imp.projectId !== projectId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const milestones = await prisma.projectMilestone.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
    select: { id: true, name: true, description: true },
  });
  if (milestones.length === 0) {
    return NextResponse.json({ error: "No milestones defined for this project" }, { status: 400 });
  }

  // Historical task→milestone assignments from all other imports in this project
  const historical = await prisma.timesheetEntry.findMany({
    where: {
      import: { projectId },
      milestoneId: { not: null },
      taskName: { not: null },
      importId: { not: importId },
    },
    select: {
      taskName: true,
      milestone: { select: { name: true } },
    },
    take: 150,
  });

  const milestonesText = milestones
    .map(m => `  • [${m.id}] "${m.name}"${m.description ? ` — ${m.description}` : ""}`)
    .join("\n");

  const historicalText = historical.length > 0
    ? historical.map(h => `  "${h.taskName}" → "${h.milestone?.name}"`).join("\n")
    : "  (none yet)";

  const entriesText = imp.entries
    .map(e =>
      `  ID: ${e.id} | Task: "${e.taskName ?? "(no task name)"}" | Employee: ${e.employeeName}${e.role ? ` | Role: ${e.role}` : ""}`,
    )
    .join("\n");

  const userContextBlock = imp.aiPrompt
    ? `\n## User context (from import instruction)\n  "${imp.aiPrompt}"\n  Use this to resolve ambiguous milestone assignments.\n`
    : "";

  const prompt = `You are assigning timesheet log entries to project milestones.

## Available milestones
${milestonesText}

## Historical assignments (previous entries already mapped — use as reference)
${historicalText}
${userContextBlock}
## Entries to assign
${entriesText}

Rules:
- Match each entry to the milestone whose scope best fits the task name and role.
- Use historical assignments as strong signals — same/similar task mapped before → follow that pattern.
- If no milestone fits, set milestoneId to null.
- reason: max 10 words, no filler.
- summary: 1–2 sentences only.`;

  try {
    const response = await client.beta.messages.parse({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });

    const parsed = response.parsed_output as {
      suggestions: Array<{ entryId: string; milestoneId: string | null; reason: string }>;
      summary: string;
    } | null;

    if (!parsed) {
      return NextResponse.json({ error: "AI returned no output" }, { status: 500 });
    }

    return NextResponse.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[suggest-milestones]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
