import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { downloadFile, deleteFile } from "@/lib/storage";
import { auth } from "@/auth";

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp", pdf: "application/pdf",
    heic: "image/heic", heif: "image/heif",
  };
  return map[ext] ?? "application/octet-stream";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const att = await prisma.expenseAttachment.findUnique({ where: { id } });
  if (!att) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Legacy records still have Asana URL — redirect and let Asana handle it
  if (att.downloadUrl.startsWith("https://")) {
    return NextResponse.redirect(att.downloadUrl);
  }

  try {
    const buffer = await downloadFile(att.downloadUrl);
    const safeFilename = att.name.replace(/[^\x20-\x7E]/g, "_");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeFromName(att.name),
        "Content-Disposition": `inline; filename="${safeFilename}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const att = await prisma.expenseAttachment.findUnique({ where: { id } });
  if (!att) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only delete from storage if it's a local/S3 key (not an Asana URL)
  if (!att.downloadUrl.startsWith("https://")) {
    await deleteFile(att.downloadUrl).catch(() => {});
  }

  await prisma.expenseAttachment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
