import { NextRequest, NextResponse } from "next/server";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import mammoth from "mammoth";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { downloadFile } from "@/lib/storage";

function sentinel(key: string) {
  return `OPSMIND_PFIELD_${key}_ENDFIELD`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { templateId, fields } = await req.json() as { templateId: string; fields: Record<string, string> };

  const template = await prisma.contractTemplate.findUnique({ where: { id: templateId } });
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buffer = await downloadFile(template.filePath);

  // All placeholder keys known for this template
  let allKeys: string[] = [];
  try { allKeys = template.placeholders ? JSON.parse(template.placeholders) : []; } catch {}

  // Build sentinel map for every known placeholder so none get silently dropped
  const sentinelFields: Record<string, string> = {};
  for (const key of allKeys) sentinelFields[key] = sentinel(key);
  // Keys provided by the caller take the same sentinel slot (their value replaces it later)
  for (const key of Object.keys(fields)) sentinelFields[key] = sentinel(key);

  let filled: Buffer = buffer;
  try {
    const zip = new PizZip(buffer);
    const doc = new Docxtemplater(zip, {
      delimiters: { start: "{{", end: "}}" },
      paragraphLoop: true,
      linebreaks: true,
    });
    doc.render(sentinelFields);
    filled = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
  } catch {}

  const { value: rawHtml } = await mammoth.convertToHtml({ buffer: filled });

  // Replace each sentinel — filled value if provided, friendly placeholder label if not
  const allProcessedKeys = [...new Set([...allKeys, ...Object.keys(fields)])];
  let html = rawHtml;
  for (const key of allProcessedKeys) {
    const s = sentinel(key);
    const value = fields[key] ?? "";
    let display: string;
    let cls: string;
    if (value) {
      display = escapeHtml(value);
      cls = "pf-mark";
    } else {
      display = escapeHtml(key);
      cls = "pf-mark pf-placeholder";
    }
    html = html.split(s).join(
      `<mark id="pf-${escapeHtml(key)}" data-field="${escapeHtml(key)}" class="${cls}">${display}</mark>`
    );
  }

  return NextResponse.json({ html });
}
