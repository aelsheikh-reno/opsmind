import { NextRequest, NextResponse } from "next/server";
import { requireAnyRecordsWrite } from "@/lib/permissions";
import { processDocument, ALLOWED_MIME_TYPES } from "@/lib/ingest";
import { type DocumentExtraction } from "@/lib/extract";
import { downloadFile, deleteFile } from "@/lib/storage";

export async function POST(request: NextRequest) {
  const denied = await requireAnyRecordsWrite();
  if (denied) return denied;

  let body: {
    tempFilePath?: string;
    filename?: string;
    fileHash?: string;
    mimeType?: string;
    extraction?: DocumentExtraction;
    replaceId?: string | null;
    forceNew?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tempFilePath, filename, mimeType, extraction, replaceId, forceNew } = body;

  if (!tempFilePath || !filename || !mimeType || !extraction) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!tempFilePath.startsWith("preview/")) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json({ error: `Unsupported file type: ${mimeType}` }, { status: 400 });
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

  const result = await processDocument(buffer, filename, mimeType, {
    replaceId: replaceId ?? null,
    forceNew: forceNew ?? false,
    source: "upload",
    previewExtraction: extraction,
  });

  // Fire-and-forget temp file cleanup
  deleteFile(tempFilePath).catch(() => {});

  switch (result.type) {
    case "duplicate":
      return NextResponse.json(
        { duplicate: true, existingDocumentId: result.existingDocumentId, message: result.message },
        { status: 409 },
      );
    case "unsupported":
      return NextResponse.json({ error: `Unsupported file type: ${result.mimeType}` }, { status: 400 });
    case "rejected":
      return NextResponse.json({ error: `Document rejected: ${result.reason}` }, { status: 422 });
    case "extraction_failed":
      return NextResponse.json({ error: `Extraction failed: ${result.message}` }, { status: 422 });
    case "api_key_error":
      return NextResponse.json(
        { error: "Anthropic API key is missing or invalid. Add it to .env.local." },
        { status: 500 },
      );
    case "error":
      return NextResponse.json({ error: `Processing failed: ${result.message}` }, { status: 500 });
    case "success":
      return NextResponse.json({
        success: true,
        document: result.document,
        alertsCreated: result.alertsCreated,
        potentialMatches: result.potentialMatches,
        invoicesCreated: result.invoicesCreated,
        invoicesSkipped: result.invoicesSkipped,
        payrollEntriesCreated: result.payrollEntriesCreated,
        contractPersonId: result.contractPersonId,
      });
  }
}
