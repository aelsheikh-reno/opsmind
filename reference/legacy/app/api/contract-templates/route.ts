import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import PizZip from "pizzip";

function extractPlaceholders(buffer: Buffer): string[] {
  const zip = new PizZip(buffer);
  const candidates = [
    "word/document.xml",
    "word/header1.xml", "word/header2.xml", "word/header3.xml",
    "word/footer1.xml", "word/footer2.xml", "word/footer3.xml",
  ];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const xmlFile of candidates) {
    try {
      const raw = zip.file(xmlFile)?.asText() ?? "";
      const text = raw.replace(/<[^>]+>/g, " ");
      const matches = text.matchAll(/\{\{([^{}]+)\}\}/g);
      for (const m of matches) {
        const tag = m[1].trim();
        if (tag && !seen.has(tag)) {
          seen.add(tag);
          ordered.push(tag);
        }
      }
    } catch {}
  }
  return ordered;
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const templates = await prisma.contractTemplate.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({
    templates: templates.map((t) => ({
      ...t,
      placeholders: t.placeholders ? JSON.parse(t.placeholders) : [],
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const name = ((form.get("name") as string | null) ?? "").trim();

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());

  let placeholders: string[] = [];
  try { placeholders = extractPlaceholders(buffer); } catch {}

  const template = await prisma.contractTemplate.create({
    data: { name, filePath: "", placeholders: JSON.stringify(placeholders), isActive: false },
  });

  const key = await uploadFile(`templates/${template.id}.docx`, buffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

  await prisma.contractTemplate.update({
    where: { id: template.id },
    data: { filePath: key },
  });

  return NextResponse.json({ ok: true, template: { ...template, placeholders } });
}
