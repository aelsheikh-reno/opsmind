import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import mammoth from "mammoth";

export const maxDuration = 300;

const client = new Anthropic();

type MsgContent =
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "text"; text: string };

async function buildContent(buffer: Buffer, mimeType: string, filename: string): Promise<MsgContent[]> {
  const base64 = buffer.toString("base64");
  const instruction: MsgContent = { type: "text", text: "Extract every milestone, phase, deliverable, and key deadline from this project plan." };
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  const isSpreadsheet = mimeType.includes("spreadsheetml") || mimeType.includes("ms-excel") || ext === "xlsx" || ext === "xls" || ext === "csv";
  const isWord       = mimeType.includes("wordprocessingml") || mimeType.includes("msword") || ext === "docx" || ext === "doc";
  const isPdf        = mimeType === "application/pdf" || ext === "pdf";

  if (isPdf) {
    return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }, instruction];
  }
  if (mimeType.startsWith("image/")) {
    return [{ type: "image", source: { type: "base64", media_type: mimeType, data: base64 } }, instruction];
  }
  if (isSpreadsheet) {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const text = wb.SheetNames.map(n => `Sheet: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })}`).join("\n\n");
    return [{ type: "text", text: `Filename: ${filename}\n\n${text}\n\n${instruction.text}` }];
  }
  if (isWord) {
    const { value: text } = await mammoth.extractRawText({ buffer });
    return [{ type: "text", text: `Filename: ${filename}\n\n${text}\n\n${instruction.text}` }];
  }
  return [{ type: "text", text: `Filename: ${filename}\n\n${buffer.toString("utf-8")}\n\n${instruction.text}` }];
}

const SCHEMA = {
  type: "object",
  properties: {
    milestones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name:              { type: "string" },
          description:       { anyOf: [{ type: "string" }, { type: "null" }] },
          dueDate:           { anyOf: [{ type: "string" }, { type: "null" }] },
          billingAmount:     { anyOf: [{ type: "number" }, { type: "null" }] },
          completionPercent: { anyOf: [{ type: "number" }, { type: "null" }] },
          estimatedHours: { anyOf: [{ type: "number" }, { type: "null" }] },
          activities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name:              { type: "string" },
                completionPercent: { anyOf: [{ type: "number" }, { type: "null" }] },
                estimatedHours:    { anyOf: [{ type: "number" }, { type: "null" }] },
              },
              required: ["name", "completionPercent", "estimatedHours"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "description", "dueDate", "billingAmount", "completionPercent", "estimatedHours", "activities"],
        additionalProperties: false,
      },
    },
  },
  required: ["milestones"],
  additionalProperties: false,
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  await params;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());

  let content: MsgContent[];
  try {
    content = await buildContent(buffer, file.type, file.name);
  } catch (err) {
    console.error("[extract] buildContent failed:", err);
    return NextResponse.json({ error: "Could not parse file. Make sure it is not password-protected or corrupted." }, { status: 422 });
  }

  try {
    const response = await client.beta.messages.parse({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      system:
        "You are a project plan analyst. Identify the high-level milestones (phases, deliverables, major checkpoints) in this document. " +
        "A milestone is a significant project stage — NOT an individual task. Aim for 5–20 milestones total. " +
        "For each milestone: name (concise), description (one sentence or null), " +
        "dueDate (YYYY-MM-DD if stated, else null), billingAmount (numeric if stated, else null), " +
        "completionPercent (0-100 or null), " +
        "estimatedHours (total estimated/planned hours for this milestone — sum the Work or Duration values of its tasks if available, else null), " +
        "activities (representative sub-tasks — include up to 15 key activities per milestone, not every granular row; " +
        "for each activity set estimatedHours from the Work/Duration column if available, else null). " +
        "Group tasks under logical milestone groupings. If no clear phases exist, infer them from the work type.",
      messages: [{ role: "user", content: content as Anthropic.MessageParam["content"] }],
    });

    const parsed = response.parsed_output as { milestones: unknown[] } | null;
    if (!parsed?.milestones) {
      return NextResponse.json({ error: "Extraction returned no content" }, { status: 500 });
    }

    return NextResponse.json({ milestones: parsed.milestones });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extract] API call failed:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
