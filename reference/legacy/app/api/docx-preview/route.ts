import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import mammoth from "mammoth";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return new NextResponse("No file provided", { status: 400 });
  }

  const arrayBuffer = await (file as File).arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let bodyHtml: string;
  try {
    const result = await mammoth.convertToHtml({ buffer });
    bodyHtml = result.value;
  } catch {
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
