import { NextRequest, NextResponse } from "next/server";
import { requireRead } from "@/lib/permissions";
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

type InputRow = {
  index: number;
  employeeName: string;
  projectColValue?: string | null;
  taskName?: string | null;
  date?: string | null;
  role?: string | null;
  notes?: string | null;
  hoursLogged: number;
};

type AiDecision = { index: number; include: boolean; reason: string };

function rowToText(r: InputRow, hasProjectCol: boolean) {
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

async function filterBatch(batch: InputRow[], aiPrompt: string, projectLabel: string, hasProjectCol: boolean): Promise<AiDecision[]> {
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
    ...batch.map(r => rowToText(r, hasProjectCol)),
    ``,
    `Return your decisions for every row listed above.`,
  );

  const prompt = lines.join("\n");

  const response = await anthropic.beta.messages.parse({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8192,
    output_config: { format: { type: "json_schema", schema: AI_FILTER_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  });

  const result = response.parsed_output as { rows: AiDecision[] } | null;
  return result?.rows ?? [];
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRead("projects");
  if (denied) return denied;

  await params;

  const { rows, aiPrompt, projectName, clientName, hasProjectCol } = await req.json() as {
    rows: InputRow[];
    aiPrompt: string;
    projectName?: string;
    clientName?: string | null;
    hasProjectCol?: boolean;
  };

  if (!rows?.length) return NextResponse.json({ error: "rows are required" }, { status: 400 });

  const name = projectName ?? "this project";
  const projectLabel = `"${name}"${clientName ? ` (client: ${clientName})` : ""}`;
  const useProjectCol = !!(hasProjectCol && projectName);

  // Split into batches and run in parallel
  const batches: InputRow[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE));
  }

  try {
    const batchResults = await Promise.all(batches.map(b => filterBatch(b, aiPrompt?.trim() ?? "", projectLabel, useProjectCol)));
    const allDecisions = batchResults.flat();
    return NextResponse.json({ rows: allDecisions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
