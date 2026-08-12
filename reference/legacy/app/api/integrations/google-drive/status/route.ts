import { NextResponse } from "next/server";
import { requireRead } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const denied = await requireRead("settings");
  if (denied) return denied;

  const conn = await prisma.driveConnection.findFirst();
  if (!conn) return NextResponse.json({ connected: false });

  const recentFiles = await prisma.driveFile.findMany({
    orderBy: { syncedAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    connected: true,
    email: conn.email,
    folderId: conn.folderId,
    folderName: conn.folderName,
    lastSyncAt: conn.lastSyncAt?.toISOString() ?? null,
    recentFiles,
  });
}
