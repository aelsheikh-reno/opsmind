import { NextRequest, NextResponse } from "next/server";
import { processDocument, ALLOWED_MIME_TYPES } from "@/lib/ingest";
import { sendWhatsApp } from "@/lib/whatsapp";

// ── Meta webhook verification ─────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_SECRET) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// ── Inbound message handler ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // always 200 to Meta
  }

  const change  = (body?.entry as Record<string, unknown>[])?.[0]
                    ?.changes as Record<string, unknown>[];
  const value   = change?.[0]?.value as Record<string, unknown> | undefined;
  const message = (value?.messages as Record<string, unknown>[])?.[0];

  if (!message) return NextResponse.json({ ok: true }); // status updates, etc.

  const senderPhone  = String(message.from ?? "");
  const messageType  = String(message.type ?? "");

  // Non-document messages — reply with usage hint
  if (messageType === "text") {
    await sendWhatsApp(senderPhone, "Send me a PDF or image document and I'll extract its details automatically into OpsMind.");
    return NextResponse.json({ ok: true });
  }

  if (messageType !== "document" && messageType !== "image") {
    return NextResponse.json({ ok: true });
  }

  const mediaObj = (message.document ?? message.image) as Record<string, unknown> | undefined;
  const mediaId  = String(mediaObj?.id ?? "");
  if (!mediaId) return NextResponse.json({ ok: true });

  const filename = String(
    (message.document as Record<string, unknown> | undefined)?.filename
    ?? `whatsapp-doc-${Date.now()}.jpg`
  );

  const token = process.env.META_WHATSAPP_TOKEN;

  try {
    // 1 — Resolve media URL from Meta
    const metaRes = await fetch(`https://graph.facebook.com/v25.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const metaData = await metaRes.json() as Record<string, string>;
    const mediaUrl = metaData.url;
    const mimeType = metaData.mime_type
      ?? (mediaObj?.mime_type as string | undefined)
      ?? "application/octet-stream";

    if (!mediaUrl) throw new Error("Meta did not return a media URL");

    // 2 — Download the file
    const fileRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    // 3 — Validate mime type
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      await sendWhatsApp(senderPhone, "⚠️ Unsupported file type. Please send a PDF or image (JPG, PNG).");
      return NextResponse.json({ ok: true });
    }

    // Acknowledge receipt before the AI call (takes ~5-15 s)
    await sendWhatsApp(senderPhone, "📄 Document received — analyzing now...");

    // 4 — Run the same ingest pipeline as the UI upload
    const result = await processDocument(buffer, filename, mimeType, { source: "whatsapp" });

    // 5 — Reply with a summary
    if (result.type === "success") {
      const d = result.document;
      const lines: string[] = ["✅ Document analyzed and saved!"];

      if (d.docType)            lines.push(`Type: ${d.docType.replace(/_/g, " ")}`);
      if (d.parties?.length)    lines.push(`Parties: ${d.parties.join(", ")}`);
      if (d.referenceNumber)    lines.push(`Ref: ${d.referenceNumber}`);
      if (d.amount != null)     lines.push(`Amount: ${d.currency ?? ""} ${d.amount.toLocaleString()}`);
      if (d.issueDate)          lines.push(`Issue date: ${d.issueDate}`);
      if (d.expiryDate)         lines.push(`Expiry: ${d.expiryDate}`);
      if (d.summary)            lines.push(`\n${d.summary}`);

      await sendWhatsApp(senderPhone, lines.join("\n"));

    } else if (result.type === "duplicate") {
      await sendWhatsApp(senderPhone, "⚠️ This document has already been uploaded to OpsMind.");
    } else {
      await sendWhatsApp(senderPhone, "❌ Could not analyze this document. Please try uploading it directly in OpsMind.");
    }

  } catch (err) {
    console.error("[whatsapp-inbound]", err);
    try {
      await sendWhatsApp(senderPhone, "❌ Something went wrong. Please try again.");
    } catch {}
  }

  return NextResponse.json({ ok: true });
}
