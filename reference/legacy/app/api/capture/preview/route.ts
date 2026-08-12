import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireAnyRecordsWrite } from "@/lib/permissions";
import { ALLOWED_MIME_TYPES } from "@/lib/ingest";
import { validateDocument, extractDocument } from "@/lib/extract";
import { uploadFile, deleteFile } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { smartSimilarity } from "@/lib/name-match";

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
    return NextResponse.json({ error: `Unsupported file type: ${mimeType}` }, { status: 400 });
  }

  // replaceId / forceNew indicate the user has already resolved a duplicate prompt —
  // skip all duplicate checks so we don't loop back to the same 409.
  const replaceId = formData.get("replaceId") as string | null;
  const forceNew  = formData.get("forceNew") === "true";
  const skipDuplicateChecks = !!(replaceId || forceNew);

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(buffer).digest("hex");

  if (!skipDuplicateChecks) {
    // Exact hash duplicate check
    const staleThreshold = new Date(Date.now() - 30 * 60 * 1000);
    await prisma.document.updateMany({
      where: { fileHash, status: "processing", createdAt: { lt: staleThreshold } },
      data: { status: "failed" },
    });

    const hashMatch = await prisma.document.findFirst({
      where: { fileHash, status: { not: "failed" } },
      select: { id: true, filename: true, source: true },
    });
    if (hashMatch) {
      const sourceNote = hashMatch.source === "google-drive" ? " (synced from Google Drive)" : "";
      return NextResponse.json(
        {
          duplicate: true,
          existingDocumentId: hashMatch.id,
          message: `This exact file has already been uploaded as "${hashMatch.filename}"${sourceNote}.`,
        },
        { status: 409 },
      );
    }
  }

  // Validate document
  const validation = await validateDocument(buffer, mimeType, file.name);
  if (!validation.valid) {
    return NextResponse.json({ error: `Document rejected: ${validation.reason}` }, { status: 422 });
  }

  // Extract document
  let extraction: Awaited<ReturnType<typeof extractDocument>>;
  try {
    extraction = await extractDocument(buffer, mimeType, file.name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("api_key") || message.includes("authentication") || message.includes("401") || message.includes("API key")) {
      return NextResponse.json(
        { error: "Anthropic API key is missing or invalid. Add it to .env.local." },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: `Extraction failed: ${message}` }, { status: 422 });
  }

  if (!extraction) {
    return NextResponse.json({ error: "Extraction failed: Could not parse document" }, { status: 422 });
  }

  if (!skipDuplicateChecks) {
    // Semantic duplicate check
    // purchase_order: same client routinely issues multiple distinct POs — don't match on party name alone
    const skipPartyMatch = ["invoice", "payroll", "invoice_report", "purchase_order"].includes(extraction.docType ?? "");

    if (extraction.referenceNumber) {
      const refMatch = await prisma.document.findFirst({
        where: { docType: extraction.docType, referenceNumber: extraction.referenceNumber, status: { not: "failed" } },
        select: { id: true, filename: true },
      });
      if (refMatch) {
        return NextResponse.json(
          {
            duplicate: true,
            existingDocumentId: refMatch.id,
            message: `A ${(extraction.docType ?? "document").replace(/_/g, " ")} with reference "${extraction.referenceNumber}" already exists — "${refMatch.filename}".`,
          },
          { status: 409 },
        );
      }
    }

    if (!skipPartyMatch && extraction.parties.length > 0) {
      const candidates = await prisma.document.findMany({
        where: { docType: extraction.docType, status: { not: "failed" }, parties: { not: null } },
        select: { id: true, filename: true, parties: true },
        take: 500,
      });

      for (const candidate of candidates) {
        let candidateParties: string[];
        try {
          candidateParties = JSON.parse(candidate.parties ?? "[]");
        } catch {
          continue;
        }
        if (candidateParties.length === 0) continue;

        const hasMatch = extraction.parties.every((newParty) =>
          candidateParties.some((existingParty) => smartSimilarity(newParty, existingParty) >= 0.85),
        );

        if (hasMatch) {
          return NextResponse.json(
            {
              duplicate: true,
              existingDocumentId: candidate.id,
              message: `A similar ${(extraction.docType ?? "document").replace(/_/g, " ")} already exists for "${extraction.parties[0]}" — "${candidate.filename}".`,
            },
            { status: 409 },
          );
        }
      }
    }
  }

  // Upload to temp storage
  const tempId = crypto.randomUUID();
  const ext = MIME_TO_EXT[mimeType] ?? "bin";
  const tempFilePath = `preview/${tempId}.${ext}`;

  try {
    await uploadFile(tempFilePath, buffer, mimeType);
  } catch (err) {
    return NextResponse.json(
      { error: `Temporary file storage failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    tempId,
    tempFilePath,
    filename: file.name,
    fileHash,
    mimeType,
    extraction,
  });
}

export async function DELETE(request: NextRequest) {
  const denied = await requireAnyRecordsWrite();
  if (denied) return denied;

  let body: { tempFilePath?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.tempFilePath) {
    return NextResponse.json({ error: "tempFilePath required" }, { status: 400 });
  }

  // Safety guard: only allow deleting from the preview/ prefix
  if (!body.tempFilePath.startsWith("preview/")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    await deleteFile(body.tempFilePath);
  } catch {
    // Ignore — temp file cleanup is best-effort
  }

  return NextResponse.json({ ok: true });
}
