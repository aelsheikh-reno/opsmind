import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import Anthropic from "@anthropic-ai/sdk";

const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

async function toBase64Blocks(buffer: Buffer, mimeType: string) {
  return [
    {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: mimeType as "image/jpeg" | "image/png" | "image/webp",
        data: buffer.toString("base64"),
      },
    },
  ];
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED.has(mimeType)) {
    return NextResponse.json({ error: "Please upload a PDF or image file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // For PDFs, convert first page to base64 text approach
  const isPdf = mimeType === "application/pdf";

  const client = new Anthropic();

  let content: Anthropic.MessageParam["content"];

  if (isPdf) {
    content = [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: buffer.toString("base64"),
        },
      } as Anthropic.DocumentBlockParam,
      {
        type: "text",
        text: EXTRACTION_PROMPT,
      },
    ];
  } else {
    const imageBlocks = await toBase64Blocks(buffer, mimeType);
    content = [
      ...imageBlocks,
      { type: "text", text: EXTRACTION_PROMPT },
    ];
  }

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ error: "Could not parse document" }, { status: 422 });

    const extracted = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ extracted });
  } catch (err) {
    console.error("[vat/config-extract]", err);
    return NextResponse.json({ error: "Extraction failed" }, { status: 500 });
  }
}

const EXTRACTION_PROMPT = `You are reading a VAT registration certificate, tax authority letter, or similar government tax document.

Extract the following fields and return ONLY a JSON object with no explanation:

{
  "companyName": "registered company or entity name on the document, or null",
  "taxId": "TRN, VAT registration number, or primary tax ID shown on the document, or null",
  "country": "country or jurisdiction name (e.g. UAE, Egypt, United Kingdom)",
  "currency": "3-letter currency code for that country (e.g. AED, EGP, GBP)",
  "rate": "VAT rate as a percentage number only (e.g. 5 for 5%, 14 for 14%)",
  "startDate": "registration or effective date in YYYY-MM-DD format, or null if not found",
  "frequencyMonths": "filing frequency in months — 1 for monthly, 3 for quarterly, 12 for annual. Use 3 if unclear",
  "filingDeadlineDays": "days after period end to file — use 28 if not specified",
  "anchorMonth": "which month starts a new filing cycle (1=January). Use 1 if unclear"
}

If a field cannot be determined from the document, use null for strings or the default values noted above for numbers.`;
