import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { uploadFile, downloadFile, deleteFile } from "@/lib/storage";
import path from "path";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc || !doc.filePath) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const buffer = await downloadFile(doc.filePath);
    const safeFilename = doc.filename.replace(/[^\x20-\x7E]/g, "_");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `inline; filename="${safeFilename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "File could not be read" }, { status: 404 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  if (buffer.length === 0) {
    return NextResponse.json({ error: "Uploaded file is empty" }, { status: 400 });
  }

  const ext = path.extname(file.name) || ".pdf";
  const key = `${id}${ext}`;

  let filePath: string;
  try {
    filePath = await uploadFile(key, buffer, file.type || "application/octet-stream");
  } catch {
    return NextResponse.json({ error: "Failed to save file" }, { status: 500 });
  }

  // Only update the DB after the file is confirmed on disk
  await prisma.document.update({
    where: { id },
    data: {
      filePath,
      mimeType: file.type || "application/octet-stream",
      // filename and source intentionally not changed — preserve original title and "manual" source
    },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await prisma.document.findUnique({ where: { id }, select: { filePath: true } });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (doc.filePath) {
    await deleteFile(doc.filePath).catch(() => {});
  }

  await prisma.document.update({ where: { id }, data: { filePath: null } });
  return NextResponse.json({ success: true });
}
