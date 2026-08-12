import { NextRequest, NextResponse } from "next/server";
import { requireRead } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAccessToken, listFolders, getFolderName } from "@/lib/google-drive";

export async function GET(request: NextRequest) {
  const denied = await requireRead("settings");
  if (denied) return denied;

  const conn = await prisma.driveConnection.findFirst();
  if (!conn) return NextResponse.json({ error: "Not connected" }, { status: 400 });

  const parentId = request.nextUrl.searchParams.get("parentId") ?? "root";

  try {
    const accessToken = await getAccessToken(conn.refreshToken);
    await prisma.driveConnection.update({ where: { id: conn.id }, data: { accessToken } });

    const [folders, parentName] = await Promise.all([
      listFolders(parentId, accessToken),
      parentId === "root" ? Promise.resolve("My Drive") : getFolderName(parentId, accessToken),
    ]);

    return NextResponse.json({ folders, parentId, parentName });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list folders" },
      { status: 500 },
    );
  }
}
