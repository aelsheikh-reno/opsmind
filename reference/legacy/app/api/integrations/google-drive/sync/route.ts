import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAccessToken, listNewFiles, downloadFile } from "@/lib/google-drive";
import { processDocument } from "@/lib/ingest";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  const denied = await requireWrite("contracts");
  if (denied) return denied;

  const conn = await prisma.driveConnection.findFirst();
  if (!conn) return NextResponse.json({ error: "Not connected to Google Drive" }, { status: 400 });
  if (!conn.folderId) return NextResponse.json({ error: "No folder selected" }, { status: 400 });

  let accessToken: string;
  try {
    accessToken = await getAccessToken(conn.refreshToken);
    await prisma.driveConnection.update({ where: { id: conn.id }, data: { accessToken } });
  } catch {
    return NextResponse.json({ error: "Failed to refresh Google token — please reconnect" }, { status: 401 });
  }

  const processed = await prisma.driveFile.findMany({ select: { driveFileId: true } });
  const alreadySyncedIds = new Set(processed.map(f => f.driveFileId));

  let newFiles: { id: string; name: string; mimeType: string }[];
  try {
    newFiles = await listNewFiles(conn.folderId, accessToken, alreadySyncedIds);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to list folder: ${err instanceof Error ? err.message : err}` },
      { status: 500 },
    );
  }

  if (newFiles.length === 0) {
    await prisma.driveConnection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date() } });
    return NextResponse.json({ synced: 0, failed: 0, files: [] });
  }

  const results: { name: string; status: "ok" | "failed" | "duplicate"; documentId?: string; error?: string }[] = [];

  for (const file of newFiles) {
    try {
      const buffer = await downloadFile(file.id, accessToken);
      const result = await processDocument(buffer, file.name, file.mimeType, { source: "google-drive" });

      if (result.type === "duplicate") {
        await prisma.driveFile.create({
          data: {
            driveFileId: file.id,
            filename: file.name,
            documentId: result.existingDocumentId,
            status: "duplicate",
            error: result.message,
          },
        });
        results.push({ name: file.name, status: "duplicate", documentId: result.existingDocumentId });
      } else if (result.type === "success") {
        await prisma.driveFile.create({
          data: {
            driveFileId: file.id,
            filename: file.name,
            documentId: result.document.id,
            status: "ok",
          },
        });
        results.push({ name: file.name, status: "ok", documentId: result.document.id });
      } else {
        const errMsg =
          result.type === "rejected" ? result.reason
          : result.type === "extraction_failed" ? result.message
          : result.type === "unsupported" ? `Unsupported type: ${result.mimeType}`
          : result.type === "api_key_error" ? "Anthropic API key error"
          : result.type === "error" ? result.message
          : "Unknown error";

        await prisma.driveFile.create({
          data: { driveFileId: file.id, filename: file.name, status: "failed", error: errMsg },
        });
        results.push({ name: file.name, status: "failed", error: errMsg });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.driveFile.create({
        data: { driveFileId: file.id, filename: file.name, status: "failed", error: message },
      });
      results.push({ name: file.name, status: "failed", error: message });
    }
  }

  await prisma.driveConnection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date() } });

  return NextResponse.json({
    synced: results.filter(r => r.status === "ok").length,
    duplicates: results.filter(r => r.status === "duplicate").length,
    failed: results.filter(r => r.status === "failed").length,
    files: results,
  });
}
