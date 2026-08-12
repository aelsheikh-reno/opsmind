import { NextRequest, NextResponse } from "next/server";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { buildFileContent } from "@/lib/extract";
import { uploadFile } from "@/lib/storage";

const anthropic = new Anthropic();

interface PostmarkAttachment {
  Name: string;
  Content: string; // base64
  ContentType: string;
  ContentLength: number;
}

interface PostmarkPayload {
  From: string;
  Subject: string;
  TextBody?: string;
  HtmlBody?: string;
  Attachments?: PostmarkAttachment[];
}

const DOC_TYPES = [
  "lease_contract", "client_contract", "employee_contract", "visa",
  "emirates_id", "labor_card", "trade_license", "insurance",
  "government_permit", "other",
];

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
}

function extractJson(raw: string) {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
  const text = match ? match[1] : raw;
  return JSON.parse(text.trim());
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json() as PostmarkPayload;
    const { From, Subject, TextBody, HtmlBody, Attachments = [] } = payload;

    const emailText = TextBody?.trim() || (HtmlBody ? stripHtml(HtmlBody) : "");

    // Build Claude message content
    const content: Anthropic.ContentBlockParam[] = [
      {
        type: "text",
        text: `Analyze this forwarded email and extract any document or contract information.

Email Subject: ${Subject}
From: ${From}

Email Body:
${emailText}

Return ONLY a JSON object with these fields (null if not found):
{
  "docType": one of ${DOC_TYPES.map(t => `"${t}"`).join(", ")},
  "filename": concise descriptive title,
  "parties": array of party/company names,
  "referenceNumber": contract or reference number or null,
  "issueDate": "YYYY-MM-DD" or null,
  "expiryDate": "YYYY-MM-DD" or null,
  "renewalDeadline": "YYYY-MM-DD" or null,
  "amount": numeric value or null,
  "currency": 3-letter code or null,
  "paymentTerms": description or null,
  "summary": 2-3 sentence summary
}`,
      },
    ];

    // Attach first supported document/image
    // ContentType may be generic "application/octet-stream" for forwarded emails — fall back to filename extension
    const isPdf = (a: PostmarkAttachment) =>
      a.ContentType.includes("pdf") || a.Name.toLowerCase().endsWith(".pdf");
    const isImage = (a: PostmarkAttachment) =>
      a.ContentType.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/i.test(a.Name);
    const isWord = (a: PostmarkAttachment) =>
      /\.(docx?)$/i.test(a.Name) ||
      a.ContentType.includes("msword") ||
      a.ContentType.includes("wordprocessingml");

    const supported = Attachments.find(a => isPdf(a) || isImage(a) || isWord(a));

    if (supported) {
      const mimeType = isPdf(supported)   ? "application/pdf"
        : isWord(supported)               ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : supported.ContentType.split(";")[0].trim();

      const buffer = Buffer.from(supported.Content.replace(/[\r\n\s]/g, ""), "base64");
      const fileBlocks = await buildFileContent(buffer, mimeType, supported.Name);
      content.push(...(fileBlocks as Anthropic.ContentBlockParam[]));
    }

    const response = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      messages: [{ role: "user", content }],
    });

    const rawText = response.content[0].type === "text" ? response.content[0].text : "{}";

    let extracted: Record<string, unknown> = {};
    try {
      extracted = extractJson(rawText);
    } catch {
      // fallback to minimal record if parsing fails
    }

    const safeDate = (v: unknown) => {
      if (!v || typeof v !== "string") return null;
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };

    const doc = await prisma.document.create({
      data: {
        filename: String(extracted.filename || Subject || "Email document"),
        source: "email",
        mimeType: "email",
        status: "review",
        docType: DOC_TYPES.includes(String(extracted.docType)) ? String(extracted.docType) : "other",
        parties: Array.isArray(extracted.parties) && extracted.parties.length > 0
          ? JSON.stringify(extracted.parties)
          : null,
        referenceNumber: extracted.referenceNumber ? String(extracted.referenceNumber) : null,
        issueDate: safeDate(extracted.issueDate),
        expiryDate: safeDate(extracted.expiryDate),
        renewalDeadline: safeDate(extracted.renewalDeadline),
        amount: extracted.amount != null ? Number(extracted.amount) : null,
        currency: extracted.currency ? String(extracted.currency) : null,
        paymentTerms: extracted.paymentTerms ? String(extracted.paymentTerms) : null,
        summary: extracted.summary ? String(extracted.summary) : null,
        notes: `Forwarded from: ${From}`,
      },
    });

    // Save attachment file to disk and link it to the record
    if (supported) {
      try {
        console.log("[inbound-email] saving attachment:", supported.Name, supported.ContentType, "length:", supported.Content.length);
        const ext = path.extname(supported.Name) || (isPdf(supported) ? ".pdf" : ".bin");
        const mimeType = isPdf(supported)   ? "application/pdf"
          : isWord(supported)              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : supported.ContentType.split(";")[0].trim();
        const buffer = Buffer.from(supported.Content.replace(/[\r\n\s]/g, ""), "base64");
        const filePath = await uploadFile(`${doc.id}${ext}`, buffer, mimeType);
        await prisma.document.update({
          where: { id: doc.id },
          data: { filePath, mimeType },
        });
        console.log("[inbound-email] attachment saved ok");
      } catch (fileErr) {
        console.error("[inbound-email] file save failed:", fileErr);
      }
    } else {
      console.log("[inbound-email] no supported attachment found. Attachments received:", Attachments.map(a => `${a.Name} (${a.ContentType})`));
    }

    return NextResponse.json({ ok: true, id: doc.id });
  } catch (err) {
    console.error("[inbound-email]", err);
    return NextResponse.json({ error: "Failed to process email" }, { status: 500 });
  }
}
