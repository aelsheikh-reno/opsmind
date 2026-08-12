import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import Anthropic from "@anthropic-ai/sdk";

type ScheduleRow = { dueDate: string; amount: number; currency: string; description: string };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { schedule, prompt } = await req.json() as { schedule: ScheduleRow[]; prompt: string };

  if (!prompt?.trim()) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  if (!schedule?.length) return NextResponse.json({ error: "Schedule is empty" }, { status: 400 });

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: `You are a payroll assistant. The user has this payment schedule (JSON):

${JSON.stringify(schedule, null, 2)}

User instruction: "${prompt.trim()}"

Apply the instruction and return the updated schedule. Rules:
1. Output ONLY a valid JSON array — no markdown, no explanation
2. Each row must have exactly: dueDate (YYYY-MM-DD), amount (number), currency (string), description (string)
3. Amounts must be numbers, never strings
4. Dates must stay YYYY-MM-DD format
5. If the instruction is unclear, return the schedule unchanged

[{"dueDate":"...","amount":0,"currency":"...","description":"..."}]`,
      }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(json);
    const refined: ScheduleRow[] = Array.isArray(parsed) ? parsed : schedule;

    return NextResponse.json({ schedule: refined });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `AI refinement failed: ${msg}` }, { status: 502 });
  }
}
