import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccessToken, listNewFiles, downloadFile } from "@/lib/google-drive";
import { processDocument } from "@/lib/ingest";

// Called by Vercel Cron daily at 6:00 AM UAE time (02:00 UTC).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const conn = await prisma.driveConnection.findFirst();
  if (!conn) return NextResponse.json({ ok: true, skipped: "No Drive connection" });
  if (!conn.folderId) return NextResponse.json({ ok: true, skipped: "No folder selected" });

  let accessToken: string;
  try {
    accessToken = await getAccessToken(conn.refreshToken);
    await prisma.driveConnection.update({ where: { id: conn.id }, data: { accessToken } });
  } catch (err) {
    console.error("[cron/drive-sync] token refresh failed:", err);
    return NextResponse.json({ error: "Token refresh failed" }, { status: 500 });
  }

  const processed = await prisma.driveFile.findMany({ select: { driveFileId: true } });
  const alreadySyncedIds = new Set(processed.map((f) => f.driveFileId));

  let newFiles: { id: string; name: string; mimeType: string }[];
  try {
    newFiles = await listNewFiles(conn.folderId, accessToken, alreadySyncedIds);
  } catch (err) {
    console.error("[cron/drive-sync] list failed:", err);
    return NextResponse.json({ error: "Failed to list folder" }, { status: 500 });
  }

  if (newFiles.length === 0) {
    await prisma.driveConnection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date() } });
    return NextResponse.json({ ok: true, synced: 0, duplicates: 0, failed: 0 });
  }

  let synced = 0, duplicates = 0, failed = 0;

  for (const file of newFiles) {
    try {
      const buffer = await downloadFile(file.id, accessToken);
      const result = await processDocument(buffer, file.name, file.mimeType, { source: "google-drive" });

      const status =
        result.type === "success"   ? "ok" :
        result.type === "duplicate" ? "duplicate" : "failed";

      const errMsg = result.type === "rejected"          ? result.reason
        : result.type === "extraction_failed"            ? result.message
        : result.type === "unsupported"                  ? `Unsupported: ${result.mimeType}`
        : result.type === "error"                        ? result.message
        : result.type === "api_key_error"                ? "Anthropic API key error"
        : undefined;

      await prisma.driveFile.create({
        data: {
          driveFileId: file.id,
          filename: file.name,
          documentId: result.type === "success" ? result.document.id
            : result.type === "duplicate" ? result.existingDocumentId : undefined,
          status,
          error: errMsg,
        },
      });

      if (status === "ok") synced++;
      else if (status === "duplicate") duplicates++;
      else failed++;
    } catch (err) {
      console.error("[cron/drive-sync] file error:", file.name, err);
      await prisma.driveFile.create({
        data: { driveFileId: file.id, filename: file.name, status: "failed", error: String(err) },
      });
      failed++;
    }
  }

  await prisma.driveConnection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date() } });
  console.log(`[cron/drive-sync] done — synced:${synced} duplicates:${duplicates} failed:${failed}`);

  return NextResponse.json({ ok: true, synced, duplicates, failed });
}
