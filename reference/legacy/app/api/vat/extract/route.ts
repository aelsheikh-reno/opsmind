import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { processDocument, ALLOWED_MIME_TYPES } from "@/lib/ingest";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await processDocument(buffer, file.name, mimeType, { source: "vat_upload" });

  if (result.type === "duplicate") {
    // File already in system — return the existing document's data
    return NextResponse.json({
      isDuplicate: true,
      documentId: result.existingDocumentId,
      message: result.message,
    });
  }

  if (result.type === "success") {
    return NextResponse.json({
      isDuplicate: false,
      documentId: result.document.id,
      extracted: {
        paidAmount: result.document.amount ?? null,
        paidAt: result.document.issueDate
          ? new Date(result.document.issueDate).toISOString().split("T")[0]
          : null,
        notes: result.document.referenceNumber ?? null,
      },
    });
  }

  return NextResponse.json({ error: result.type }, { status: 422 });
}
