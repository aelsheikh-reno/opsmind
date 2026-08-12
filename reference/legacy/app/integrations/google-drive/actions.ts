"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAccessToken, listNewFiles, downloadFile } from "@/lib/google-drive";
import { processDocument } from "@/lib/ingest";

export type SyncFileResult = {
  name: string;
  status: "ok" | "failed" | "duplicate";
  documentId?: string;
  error?: string;
};

export type SyncActionResult =
  | { ok: false; error: string }
  | { ok: true; synced: number; duplicates: number; failed: number; files: SyncFileResult[] };

export async function resetSyncHistory(): Promise<{ ok: boolean; error?: string; deleted: number }> {
  const session = await auth();
  if (!session) return { ok: false, error: "Unauthorized", deleted: 0 };
  const { count } = await prisma.driveFile.deleteMany({});
  return { ok: true, deleted: count };
}

export async function syncGoogleDrive(): Promise<SyncActionResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Unauthorized" };

  const conn = await prisma.driveConnection.findFirst();
  if (!conn) return { ok: false, error: "Not connected to Google Drive" };
  if (!conn.folderId) return { ok: false, error: "No folder selected" };

  let accessToken: string;
  try {
    accessToken = await getAccessToken(conn.refreshToken);
    await prisma.driveConnection.update({ where: { id: conn.id }, data: { accessToken } });
  } catch {
    return { ok: false, error: "Failed to refresh Google token — please reconnect" };
  }

  const processed = await prisma.driveFile.findMany({ select: { driveFileId: true } });
  const alreadySyncedIds = new Set(processed.map((f) => f.driveFileId));

  let newFiles: { id: string; name: string; mimeType: string }[];
  try {
    newFiles = await listNewFiles(conn.folderId, accessToken, alreadySyncedIds);
  } catch (err) {
    return { ok: false, error: `Failed to list folder: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (newFiles.length === 0) {
    await prisma.driveConnection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date() } });
    return { ok: true, synced: 0, duplicates: 0, failed: 0, files: [] };
  }

  const files: SyncFileResult[] = [];

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
        files.push({ name: file.name, status: "duplicate", documentId: result.existingDocumentId });
      } else if (result.type === "success") {
        await prisma.driveFile.create({
          data: { driveFileId: file.id, filename: file.name, documentId: result.document.id, status: "ok" },
        });
        files.push({ name: file.name, status: "ok", documentId: result.document.id });
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
        files.push({ name: file.name, status: "failed", error: errMsg });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.driveFile.create({
        data: { driveFileId: file.id, filename: file.name, status: "failed", error: message },
      });
      files.push({ name: file.name, status: "failed", error: message });
    }
  }

  await prisma.driveConnection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date() } });

  return {
    ok: true,
    synced: files.filter((f) => f.status === "ok").length,
    duplicates: files.filter((f) => f.status === "duplicate").length,
    failed: files.filter((f) => f.status === "failed").length,
    files,
  };
}
