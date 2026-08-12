import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { requireAnyRecordsWrite } from "@/lib/permissions";
import { validateDocument, extractDocument } from "@/lib/extract";
import { uploadFile } from "@/lib/storage";
import { ALLOWED_MIME_TYPES } from "@/lib/ingest";
import { prisma } from "@/lib/prisma";

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "text/plain": "txt",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
};

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
    return NextResponse.json({ valid: false, reason: "Unsupported file type" });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(buffer).digest("hex");

  // Check for exact duplicate already in DB
  const dup = await prisma.document.findFirst({
    where: { fileHash, status: { not: "failed" } },
    select: { id: true, filename: true },
  });
  if (dup) {
    return NextResponse.json({
      valid: false,
      duplicate: true,
      reason: `Already uploaded as "${dup.filename}"`,
    });
  }

  // Validate document
  const { valid, reason } = await validateDocument(buffer, mimeType, file.name);
  if (!valid) {
    return NextResponse.json({ valid: false, reason: reason ?? "Document rejected" });
  }

  // Extract structured data
  let extraction;
  try {
    extraction = await extractDocument(buffer, mimeType, file.name);
    if (!extraction) {
      return NextResponse.json({ valid: false, reason: "Extraction returned no data" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ valid: false, reason: `Extraction failed: ${msg}` });
  }

  // Upload file to temp storage (no DB record yet)
  const tempId = randomUUID();
  const ext = MIME_TO_EXT[mimeType] ?? "bin";
  const filePath = await uploadFile(`bulk/${tempId}.${ext}`, buffer, mimeType);

  return NextResponse.json({
    valid: true,
    tempId,
    filename: file.name,
    filePath,
    fileHash,
    mimeType,
    extraction: {
      docType:         extraction.docType,
      confidence:      extraction.confidence,
      parties:         extraction.parties,
      summary:         extraction.summary,
      referenceNumber: extraction.referenceNumber,
      issueDate:       extraction.issueDate,
      expiryDate:      extraction.expiryDate,
      amount:          extraction.amount,
      currency:        extraction.currency,
      vatAmount:       extraction.vatAmount,
      issuingCountry:  extraction.issuingCountry,
      notes:           extraction.notes,
      isPaid:          extraction.isPaid,
      paidDate:        extraction.paidDate,
      invoices:        extraction.invoices,
    },
  });
}
