import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRead } from "@/lib/permissions";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

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

const BATCH_SIZE = 200;

async function getAsanaToken(): Promise<string> {
  const setting = await prisma.setting.findUnique({ where: { key: "asanaAccessToken" } });
  return setting?.value || process.env.ASANA_ACCESS_TOKEN || "";
}

type AsanaTask = { gid: string; name: string; assignee: { name: string } | null };
type AsanaTimeEntry = { gid: string; duration_minutes: number; entered_on: string; created_by: { name: string } };

async function fetchAllPages<T>(url: URL, token: string): Promise<T[]> {
  const items: T[] = [];
  let offset: string | undefined;
  do {
    if (offset) url.searchParams.set("offset", offset); else url.searchParams.delete("offset");
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { message?: string };
      throw new Error(err.message ?? `Asana API error ${res.status}`);
    }
    const data = await res.json() as { data: T[]; next_page?: { offset: string } };
    items.push(...(data.data ?? []));
    offset = data.next_page?.offset;
  } while (offset);
  return items;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRead("projects");
  if (denied) return denied;

  const { id: projectId } = await params;
  const { asanaProjectGid, month, aiPrompt } = await req.json() as { asanaProjectGid: string; month?: string; aiPrompt?: string };

  if (!asanaProjectGid) return NextResponse.json({ error: "asanaProjectGid is required" }, { status: 400 });

  const token = await getAsanaToken();
  if (!token) return NextResponse.json({ error: "Asana not configured — add your access token in Settings" }, { status: 400 });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true, clientName: true, milestones: { select: { id: true, name: true }, orderBy: { order: "asc" } } },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Persist the linked Asana project GID
  await prisma.project.update({ where: { id: projectId }, data: { asanaProjectGid } });

  // 1. Get all tasks in the Asana project
  const taskUrl = new URL(`https://app.asana.com/api/1.0/projects/${asanaProjectGid}/tasks`);
  taskUrl.searchParams.set("opt_fields", "gid,name,assignee.name");
  taskUrl.searchParams.set("limit", "100");

  let tasks: AsanaTask[];
  try {
    tasks = await fetchAllPages<AsanaTask>(taskUrl, token);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }

  // 2. Fetch time entries for each task (parallelised in batches of 20)
  const BATCH = 20;
  const allEntries: { task: AsanaTask; entry: AsanaTimeEntry }[] = [];

  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async task => {
      try {
        const url = new URL(`https://app.asana.com/api/1.0/tasks/${task.gid}/time_tracking_entries`);
        url.searchParams.set("opt_fields", "gid,duration_minutes,entered_on,created_by.name");
        url.searchParams.set("limit", "100");
        const entries = await fetchAllPages<AsanaTimeEntry>(url, token);
        return entries.map(e => ({ task, entry: e }));
      } catch {
        return [];
      }
    }));
    allEntries.push(...results.flat());
  }

  if (allEntries.length === 0) {
    return NextResponse.json({ error: "No time tracking entries found in this Asana project" }, { status: 400 });
  }

  // 3. Map to PreviewRow format
  const persons = await prisma.person.findMany({
    where: { OR: [{ costPerHour: { not: null } }, { billingRate: { not: null } }] },
    select: { name: true, costPerHour: true, billingRate: true, rateCurrency: true },
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
  function matchPerson(name: string) {
    if (matchCache.has(name)) return matchCache.get(name)!;
    let best: typeof persons[0] | null = null, bestScore = 0;
    for (const p of persons) {
      const s = nameScore(name, p.name);
      if (s > bestScore && s >= 0.5) { best = p; bestScore = s; }
    }
    matchCache.set(name, best);
    return best;
  }

  const rows = allEntries.map(({ task, entry }, idx) => {
    const employeeName = entry.created_by?.name ?? task.assignee?.name ?? "Unknown";
    const hoursLogged = Math.round((entry.duration_minutes / 60) * 100) / 100;
    const date = entry.entered_on ?? null; // "YYYY-MM-DD"
    const rowMonth = date?.slice(0, 7) ?? null;
    const suggested = !month || rowMonth === month;
    const person = matchPerson(employeeName);

    return {
      index: idx,
      employeeName,
      hoursLogged,
      date,
      taskName: task.name,
      hourlyRate: person?.costPerHour ?? null,
      role: null as string | null,
      currency: person?.rateCurrency ?? null,
      notes: null as string | null,
      milestoneId: null as string | null,
      milestoneName: null as string | null,
      matchScore: suggested ? 1 : 0,
      suggested,
      matchedCostPerHour: person?.costPerHour ?? null,
      matchedBillingRate: person?.billingRate ?? null,
      matchedRateCurrency: person?.rateCurrency ?? null,
      projectMatch: true,
      aiReason: undefined as string | undefined,
    };
  });

  // AI-powered filtering when user provided a prompt
  let aiFilterApplied = false;
  const trimmedAiPrompt = aiPrompt?.trim() || null;
  if (trimmedAiPrompt) {
    try {
      const projectLabel = `the project "${project.name}"${project.clientName ? ` (client: ${project.clientName})` : ""}`;

      type AiRow = typeof rows[0];
      function rowToText(r: AiRow) {
        return (
          `Row ${r.index}: Employee: ${r.employeeName}` +
          (r.taskName ? ` | Task: ${r.taskName}` : "") +
          (r.date     ? ` | Date: ${r.date}`     : "") +
          ` | Hours: ${r.hoursLogged}`
        );
      }

      async function filterBatch(batch: AiRow[]) {
        const prompt = `You are filtering timesheet rows for ${projectLabel}.

User instruction: "${trimmedAiPrompt}"

Apply the instruction to each row below and decide whether to include it.
Only exclude rows that clearly contradict the instruction — when in doubt, include.
Keep each reason to 5 words or fewer.

${batch.map(rowToText).join("\n")}

Return your decisions for every row listed above.`;

        const response = await anthropic.beta.messages.parse({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 8192,
          output_config: { format: { type: "json_schema", schema: AI_FILTER_SCHEMA } },
          messages: [{ role: "user", content: prompt }],
        });
        const result = response.parsed_output as { rows: Array<{ index: number; include: boolean; reason: string }> } | null;
        return result?.rows ?? [];
      }

      const batches: AiRow[][] = [];
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        batches.push(rows.slice(i, i + BATCH_SIZE));
      }

      const batchResults = await Promise.all(batches.map(filterBatch));
      const byIndex = new Map(batchResults.flat().map(r => [r.index, r]));

      for (const row of rows) {
        const ai = byIndex.get(row.index);
        if (ai) {
          row.suggested = ai.include;
          row.aiReason  = ai.reason;
        }
      }
      aiFilterApplied = true;
    } catch {
      // AI filter failed — fall back to rule-based suggestions silently
    }
  }

  const suggestedRows = rows.filter(r => r.suggested);

  return NextResponse.json({
    rows,
    hasProjectCol: false,
    hasDateCol: true,
    monthFiltered: !!month,
    totalRowCount: rows.length,
    suggestedCount: suggestedRows.length,
    filename: `Asana · ${project.name}`,
    projectName: project.name,
    clientName: project.clientName ?? null,
    source: "asana",
    aiFilterApplied,
  });
}
