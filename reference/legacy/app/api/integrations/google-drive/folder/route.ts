import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAccessToken, getFolderName, parseFolderId } from "@/lib/google-drive";

export async function POST(request: NextRequest) {
  const denied = await requireWrite("settings");
  if (denied) return denied;

  const conn = await prisma.driveConnection.findFirst();
  if (!conn) return NextResponse.json({ error: "Not connected to Google Drive" }, { status: 400 });

  const { input } = await request.json();
  if (!input) return NextResponse.json({ error: "Folder URL or ID required" }, { status: 400 });

  const folderId = parseFolderId(String(input));
  if (!folderId) {
    return NextResponse.json(
      { error: "Could not parse a folder ID from the input. Paste the full folder URL or just the ID." },
      { status: 400 },
    );
  }

  try {
    const accessToken = await getAccessToken(conn.refreshToken);
    const folderName = await getFolderName(folderId, accessToken);

    await prisma.driveConnection.update({
      where: { id: conn.id },
      data: { folderId, folderName, accessToken },
    });

    return NextResponse.json({ folderId, folderName });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
