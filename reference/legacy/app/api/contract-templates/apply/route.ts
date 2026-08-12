import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { applyReplacementsToDocx, type Replacement } from "@/lib/docx-replacements";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let originalDocxBase64: string;
  let replacements: Replacement[];
  try {
    const body = await req.json();
    originalDocxBase64 = body.originalDocxBase64;
    replacements = body.replacements ?? [];
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!originalDocxBase64) {
    return NextResponse.json({ error: "originalDocxBase64 is required" }, { status: 400 });
  }

  const buffer = Buffer.from(originalDocxBase64, "base64");
  const templateBuffer = applyReplacementsToDocx(buffer, replacements);

  return NextResponse.json({ docxBase64: templateBuffer.toString("base64") });
}
