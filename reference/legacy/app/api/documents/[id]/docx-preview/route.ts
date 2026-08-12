import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import mammoth from "mammoth";
import { downloadFile } from "@/lib/storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const doc = await prisma.document.findUnique({
    where: { id },
    select: { filePath: true, mimeType: true },
  });

  if (!doc?.filePath) return new NextResponse("Not found", { status: 404 });

  const isDocx =
    doc.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    doc.mimeType === "application/msword";

  if (!isDocx) return new NextResponse("Not a Word document", { status: 400 });

  let buffer: Buffer;
  try {
    buffer = await downloadFile(doc.filePath);
  } catch {
    return new NextResponse("File not found", { status: 404 });
  }

  const { value: bodyHtml, messages } = await mammoth.convertToHtml({ buffer });

  if (!bodyHtml && messages.some((m) => m.type === "error")) {
    return new NextResponse("Failed to convert document", { status: 500 });
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.7;
      color: #1a1a1a;
    }
    .page {
      max-width: 820px;
      margin: 0 auto;
      padding: 36px 44px;
    }
    @media (min-width: 1100px) {
      .page { max-width: 1000px; padding: 40px 56px; }
    }
    @media (min-width: 1400px) {
      .page { max-width: 1200px; padding: 44px 72px; }
    }
    @media (min-width: 1800px) {
      .page { max-width: 1500px; padding: 48px 96px; }
    }
    h1 { font-size: 1.5em; margin: 1.2em 0 0.4em; font-weight: 700; }
    h2 { font-size: 1.25em; margin: 1.1em 0 0.3em; font-weight: 600; }
    h3, h4 { font-size: 1.05em; margin: 1em 0 0.25em; font-weight: 600; }
    p  { margin: 0 0 0.75em; }
    ul, ol { margin: 0 0 0.75em; padding-left: 1.6em; }
    li { margin-bottom: 0.25em; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
      font-size: 0.92em;
    }
    th, td {
      border: 1px solid #d1d5db;
      padding: 6px 10px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #f9fafb; font-weight: 600; }
    strong { font-weight: 600; }
    em { font-style: italic; }
    img { max-width: 100%; height: auto; }
    a { color: #4f46e5; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="page">
    ${bodyHtml}
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
