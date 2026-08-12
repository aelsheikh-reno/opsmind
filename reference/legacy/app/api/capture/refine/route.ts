import { NextRequest, NextResponse } from "next/server";
import { requireAnyRecordsWrite } from "@/lib/permissions";
import { extractWithContext, type DocumentExtraction } from "@/lib/extract";
import { downloadFile } from "@/lib/storage";

export async function POST(request: NextRequest) {
  const denied = await requireAnyRecordsWrite();
  if (denied) return denied;

  let body: {
    tempFilePath?: string;
    mimeType?: string;
    filename?: string;
    currentExtraction?: DocumentExtraction;
    prompt?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tempFilePath, mimeType, filename, currentExtraction, prompt } = body;

  if (!tempFilePath || !mimeType || !filename || !currentExtraction || !prompt) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!tempFilePath.startsWith("preview/")) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  }

  let buffer: Buffer;
  try {
    buffer = await downloadFile(tempFilePath);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not retrieve file: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  let extraction: DocumentExtraction | null;
  try {
    extraction = await extractWithContext(buffer, mimeType, filename, currentExtraction, prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("api_key") || message.includes("authentication") || message.includes("401") || message.includes("API key")) {
      return NextResponse.json(
        { error: "Anthropic API key is missing or invalid. Add it to .env.local." },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: `Refinement failed: ${message}` }, { status: 500 });
  }

  if (!extraction) {
    return NextResponse.json({ error: "Refinement failed: Could not parse updated extraction" }, { status: 422 });
  }

  return NextResponse.json({ extraction });
}
