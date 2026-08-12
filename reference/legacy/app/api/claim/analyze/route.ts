import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { buildFileContent } from "@/lib/extract";

const client = new Anthropic();

const EXPENSE_TYPES = [
  "Supplies", "Travel", "Accommodation", "Food & Beverage",
  "Software & Subscriptions", "Marketing & Advertising", "Entertainment",
  "Training & Education", "Equipment", "Utilities", "Professional Services",
  "Medical", "Miscellaneous",
];

const SYSTEM_PROMPT = `You are an expense claim extraction engine for a company operations tool.

Extract ALL individual expense line items from the uploaded document.

For each claim:
- name: concise specific description of the purchase (e.g. "Lunch at Costa Coffee", "AWS EC2 monthly fee")
- amount: numeric value for this line item — null if not found
- currency: 3-letter ISO code (AED, USD, EUR, GBP, EGP, SAR, QAR, etc.) — null if indeterminate
- date: date of the expense as YYYY-MM-DD — null if not present
- expenseType: exactly one of: ${EXPENSE_TYPES.join(", ")} — null if unclear
- notes: vendor name, invoice/reference number, or any other useful detail — null if none

For documents with multiple line items (expense reports, multi-item receipts, spreadsheets) extract each distinct item as a separate claim. Do not include subtotal or grand-total rows that duplicate individual lines.
For a single-item receipt or invoice return one claim.

Provide docSummary: 1-2 sentence description of the entire document (file type, vendor/source, date range if present).`;

const schemaJson = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name:        { type: "string" },
          amount:      { anyOf: [{ type: "number" }, { type: "null" }] },
          currency:    { anyOf: [{ type: "string" }, { type: "null" }] },
          date:        { anyOf: [{ type: "string" }, { type: "null" }] },
          expenseType: { anyOf: [{ type: "string" }, { type: "null" }] },
          notes:       { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["name", "amount", "currency", "date", "expenseType", "notes"],
        additionalProperties: false,
      },
    },
    docSummary: { type: "string" },
  },
  required: ["claims", "docSummary"],
  additionalProperties: false,
};

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp", pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    csv: "text/csv", txt: "text/plain",
    heic: "image/heic", heif: "image/heif",
  };
  return map[ext] ?? "application/octet-stream";
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || mimeFromName(file.name);

    const fileContent = await buildFileContent(buffer, mimeType, file.name);
    fileContent.push({ type: "text", text: "Extract all expense claims from this document." });

    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 8192,
      output_config: { format: { type: "json_schema", schema: schemaJson } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: fileContent }],
    });

    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 });
    }

    let parsed: { claims?: unknown[]; docSummary?: string };
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      console.error("[claim/analyze] truncated JSON — response too long for max_tokens");
      return NextResponse.json({ error: "Document too large — try a shorter file or fewer line items" }, { status: 422 });
    }
    type RawClaim = { expenseType: string | null; [key: string]: unknown };
    const claims = ((parsed.claims ?? []) as RawClaim[]).map(c => ({
      ...c,
      expenseType: EXPENSE_TYPES.includes(c.expenseType ?? "") ? c.expenseType : null,
    }));

    return NextResponse.json({ claims, docSummary: parsed.docSummary ?? "" });
  } catch (err) {
    console.error("[claim/analyze]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Analysis failed: ${msg}` }, { status: 500 });
  }
}
