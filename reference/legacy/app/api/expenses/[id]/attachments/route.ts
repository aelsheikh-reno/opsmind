import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { requireWrite } from "@/lib/permissions";
import { randomUUID } from "crypto";

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp", pdf: "application/pdf",
    heic: "image/heic", heif: "image/heif",
  };
  return map[ext] ?? "application/octet-stream";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { id } = await params;

  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || mimeFromName(file.name);
    const storageKey = await uploadFile(
      `expense-attachments/manual/${id}/${Date.now()}-${file.name}`,
      buffer,
      contentType,
    );

    const attachment = await prisma.expenseAttachment.create({
      data: {
        asanaGid: `manual-${randomUUID()}`,
        expenseId: id,
        name: file.name,
        downloadUrl: storageKey,
        size: buffer.length,
      },
    });

    return NextResponse.json({ ok: true, attachment });
  } catch (err) {
    console.error("[POST expenses/attachments]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
