import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import Anthropic from "@anthropic-ai/sdk";

const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

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
  const client = new Anthropic();

  let content: Anthropic.MessageParam["content"];

  if (mimeType === "application/pdf") {
    content = [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
      } as Anthropic.DocumentBlockParam,
      { type: "text", text: EXTRACTION_PROMPT },
    ];
  } else {
    content = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType as "image/jpeg" | "image/png" | "image/webp",
          data: buffer.toString("base64"),
        },
      },
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
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ error: "Could not parse document" }, { status: 422 });

    const extracted = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ extracted });
  } catch (err) {
    console.error("[tax/config-extract]", err);
    return NextResponse.json({ error: "Extraction failed" }, { status: 500 });
  }
}

const EXTRACTION_PROMPT = `You are reading a corporate tax registration certificate, tax clearance letter, income tax notice, withholding tax registration, or similar government tax document.

Extract the following fields and return ONLY a JSON object with no explanation:

{
  "companyName": "registered company or entity name on the document, or null",
  "taxId": "corporate tax ID, TIN, CRN, or primary registration number shown, or null",
  "country": "country or jurisdiction name (e.g. UAE, Egypt, United Kingdom)",
  "currency": "3-letter currency code for that country (e.g. AED, EGP, GBP)",
  "taxType": "one of: corporate, income, withholding, other — based on the document type",
  "rate": "tax rate as a percentage number only (e.g. 9 for 9%, 22.5 for 22.5%), or null if not shown",
  "startDate": "registration or effective date in YYYY-MM-DD format, or null if not found",
  "frequencyMonths": "filing frequency in months — 1 monthly, 3 quarterly, 6 semi-annual, 12 annual. Use 12 if unclear for corporate tax",
  "filingDeadlineDays": "days after period end to file or pay — use 90 if not specified",
  "anchorMonth": "which month starts the tax year (1=January). Use 1 if unclear"
}

If a field cannot be determined, use null for strings and the default values noted for numbers.`;
