import { NextRequest, NextResponse } from "next/server";
import { requireAnyRecordsWrite } from "@/lib/permissions";
import { processDocument, ALLOWED_MIME_TYPES } from "@/lib/ingest";

export async function POST(request: NextRequest) {
  const denied = await requireAnyRecordsWrite();
  if (denied) return denied;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json({ error: `Unsupported file type: ${mimeType}` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const replaceIdRaw = formData.get("replaceId");
  const replaceId = typeof replaceIdRaw === "string" && replaceIdRaw.length > 0 ? replaceIdRaw : null;
  const forceNew = formData.get("forceNew") === "true";

  const result = await processDocument(buffer, file.name, mimeType, { replaceId, forceNew });

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
