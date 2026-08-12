import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { DOC_TYPE_LABELS } from "./doc-types";

export { DOC_TYPE_LABELS };

if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your_api_key_here") {
  console.warn("[extract] ANTHROPIC_API_KEY is not configured.");
}

const client = new Anthropic();

export const ExtractionSchema = z.object({
  docType: z.enum([
    "visa",
    "emirates_id",
    "labor_card",
    "trade_license",
    "employee_contract",
    "client_contract",
    "lease_contract",
    "invoice",
    "invoice_report",
    "purchase_order",
    "payroll",
    "insurance",
    "government_permit",
    "other",
  ]),
  confidence: z.number(),
  parties: z.array(z.string()),
  summary: z.string(),
  issueDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
  renewalDeadline: z.string().nullable(),
  amount: z.number().nullable(),
  vatAmount: z.number().nullable(),
  currency: z.string().nullable(),
  issuingCountry: z.string(),
  referenceNumber: z.string().nullable(),
  paymentTerms: z.string().nullable(),
  notes: z.string().nullable(),
  employeeName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  department: z.string(),
  nationality: z.string(),
  payrollPeriod: z.string().nullable(),
  payrollEmployees: z.array(z.object({
    name: z.string(),
    salary: z.number(),
    currency: z.string(),
    month: z.string(),
  })),
  paymentSchedule: z.array(z.object({
    dueDate: z.string(),
    amount: z.number(),
    currency: z.string(),
    description: z.string(),
  })),
  isPaid: z.boolean().nullable(),
  paidDate: z.string().nullable(),
  invoices: z.array(z.object({
    referenceNumber: z.string().nullable().optional(),
    parties:         z.array(z.string()).optional(),
    issueDate:       z.string().nullable().optional(),
    expiryDate:      z.string().nullable().optional(),
    amount:          z.number().nullable().optional(),
    currency:        z.string().nullable().optional(),
    summary:         z.string().nullable().optional(),
    notes:           z.string().nullable().optional(),
    isPaid:          z.boolean().nullable().optional(),
    paidDate:        z.string().nullable().optional(),
  })),
});

export type DocumentExtraction = z.infer<typeof ExtractionSchema>;

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
type MessageContent =
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "image"; source: { type: "base64"; media_type: ImageMediaType; data: string } }
  | { type: "text"; text: string };

export async function buildFileContent(fileBuffer: Buffer, mimeType: string, filename: string): Promise<MessageContent[]> {
  const base64 = fileBuffer.toString("base64");
  const blocks: MessageContent[] = [];

  if (mimeType === "application/pdf") {
    blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } });
  } else if (mimeType.startsWith("image/")) {
    blocks.push({ type: "image", source: { type: "base64", media_type: mimeType as ImageMediaType, data: base64 } });
  } else if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheets = workbook.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false });
      return `Sheet: ${name}\n${csv}`;
    }).join("\n\n");
    blocks.push({ type: "text", text: `Filename: ${filename}\n\n${sheets}` });
  } else if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    const { value: text } = await mammoth.extractRawText({ buffer: fileBuffer });
    blocks.push({ type: "text", text: `Filename: ${filename}\n\n${text}` });
  } else {
    blocks.push({ type: "text", text: `Filename: ${filename}\n\n${fileBuffer.toString("utf-8")}` });
  }

  return blocks;
}

const VALIDATION_SYSTEM = `You are a document type gate for a company records system. Determine if the uploaded file is a legitimate business or operational document — regardless of which company or country it is from.

ACCEPT: contracts, employee contracts, vendor agreements, service agreements, NDAs, MOUs, invoices, purchase orders, payroll records, visas, passports, Emirates ID, labor cards, trade licenses, government permits, certificates, insurance policies, bank statements, financial statements, audit reports, company incorporation documents. Accept documents involving any party name, any country, any language.

REJECT: personal photos, personal chat screenshots, social media content, casual images, error screenshots, blank files, random screenshots, non-business personal receipts unrelated to any company activity.

Do NOT reject based on the company name, country of origin, or which entity issued the document.

Return JSON with exactly two fields: valid (boolean) and reason (one sentence).`;

export async function validateDocument(
  fileBuffer: Buffer,
  mimeType: string,
  filename: string
): Promise<{ valid: boolean; reason: string }> {
  const fileContent = await buildFileContent(fileBuffer, mimeType, filename);
  fileContent.push({ type: "text", text: 'Is this a legitimate business document for a company records system? Respond with only valid JSON in the format: {"valid": true, "reason": "one sentence"}' });

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: VALIDATION_SYSTEM,
      messages: [{ role: "user", content: fileContent }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      console.error("[validateDocument] no text block in response:", response.content);
      return { valid: true, reason: "Validation inconclusive — proceeding." };
    }

    // Extract JSON from the response (model may wrap it in markdown code fences)
    const raw = textBlock.text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[validateDocument] could not find JSON in response:", raw);
      return { valid: true, reason: "Validation inconclusive — proceeding." };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return { valid: Boolean(parsed.valid), reason: String(parsed.reason ?? "") };
  } catch (err) {
    console.error("[validateDocument] API error:", err);
    // Fail open: if the validation API call itself fails (auth, network, etc.)
    // don't block the upload — the extraction step will catch bad documents.
    return { valid: true, reason: "Validation skipped due to API error." };
  }
}

const SYSTEM_PROMPT = `You are an operational document intelligence engine for a UAE-based company.
Extract structured information from operational documents.

Document type classification guide — choose the FIRST matching type:
- visa: residence visa, entry permit, visa page
- emirates_id: UAE Emirates Identity card
- labor_card: UAE labour/work card
- trade_license: commercial/trade license, business registration
- employee_contract: employment agreement between the company and an individual employee
- client_contract: a service or commercial agreement where THIS company is the service provider / vendor and the other party is a CLIENT paying for services. Includes support agreements, managed services contracts, consultancy agreements, software/IT service contracts, annual maintenance agreements — any contract where the company delivers a service and receives recurring or lump-sum payment from a client. Payment schedules on these documents are RECEIVABLES (money coming in).
- lease_contract: property rental or lease agreement where the company is the TENANT paying rent
- invoice: a single invoice document (issued to or received by the company)
- invoice_report: a batch or summary of multiple invoices
- purchase_order: a purchase order (PO) document issued by the company to a vendor/supplier, listing goods or services to be procured
- payroll: payroll run, salary sheet, or payroll report listing multiple employees
- insurance: insurance policy or certificate
- government_permit: government-issued permit, NOC, approval, or certificate
- other: anything not matching the above

Field rules:
- parties: names of companies or individuals only — no roles or titles
- issueDate: the start date or issue date of the document (ISO 8601: YYYY-MM-DD)
- expiryDate: the end date, expiry, or due date (ISO 8601: YYYY-MM-DD)
- renewalDeadline: ONLY if the document explicitly states a notice or renewal deadline — otherwise null
- amount: total contract or invoice value as a number only (no symbols or commas). For invoices this is the total amount due (inclusive of VAT if VAT is included in the total).
- vatAmount: invoices only — the VAT or tax amount charged on this invoice. Scan for any label: VAT, Tax, GST, TVA, sales tax, excise, or similar. Priority order: (1) if a numeric tax amount is shown directly (e.g. "VAT: 500.00", "Tax amount: 250"), extract that number; (2) if only a rate is shown against a known subtotal (e.g. "Subtotal: 10,000 — VAT 5%"), calculate: subtotal × rate (= 500); (3) if the total is stated as inclusive and the rate is known, back-calculate: total × rate ÷ (1 + rate). Return null only if there is genuinely no VAT or tax on this invoice, or if this is not an invoice document.
- currency: 3-letter currency code (e.g. AED, USD, EGP)
- issuingCountry: invoices only — the country where the issuing entity (the vendor or service provider who generated this invoice) is based or registered. Use standard English country names only (e.g. "Egypt", "UAE", "United States", "Germany"). Derive from: the issuer's registered address or letterhead, VAT/tax ID prefix (EG→Egypt, AE→UAE, GB→United Kingdom), invoice currency as a last resort (EGP→Egypt, AED→UAE). Return empty string "" for non-invoice documents or if the issuing country cannot be determined.
- paymentTerms: a single concise sentence describing the payment schedule (e.g. "Quarterly payments of 74,221 EGP due Oct, Jan, Apr, Jul. Extra hours at 1,340 EGP/hr.")
- summary: exactly 2–3 sentences describing the scope of the document — what service or product, between which parties, and for what duration. Do not repeat payment details or dates already captured in other fields.
- notes: any critical obligations, SLA terms, or unusual clauses not captured elsewhere — keep to one sentence maximum, or null
- confidence: 0.0–1.0 reflecting extraction certainty
- employeeName: employee contracts only — the individual employee's full name (not the company). Null for all other document types.
- jobTitle: employee contracts only — the employee's position or job title. Null otherwise.
- department: employee contracts only — the employee's department or division if mentioned. Empty string "" otherwise.
- nationality: employee contracts only — the employee's nationality if mentioned. Empty string "" otherwise.
- payrollPeriod: payroll documents only — the overall period label if all rows share the same month, otherwise null. Null for all other document types.
- payrollEmployees: payroll documents only — array of ALL employee rows: {name, salary (gross or total as a number, use 0 if unknown), currency (use "" if unknown), month}. The month field is the specific month this payment is for as "Month YYYY" (e.g. "May 2026") — read it from a date/month column on each row. If no per-row month column exists, set month to "" and use payrollPeriod instead. Extract every row. Empty array [] for all other document types.
- paymentSchedule: For lease_contract, client_contract, employee_contract, and any document with scheduled installment payments — generate the COMPLETE list of every individual payment for the full contract duration. Empty array [] for invoices, payroll, and all other document types without a payment schedule. Rules:
  * For multi-year leases with annual rent increases: calculate each year's payment amounts separately after applying the stated increase (e.g. if Year 1 is AED 120,000/year paid quarterly = 4 × AED 30,000; Year 2 with 5% increase = 4 × AED 31,500). Do NOT group years together.
  * For employee_contract: generate one entry per month from the contract start date (issueDate) through the end date (expiryDate). If the contract specifies different salary amounts for different periods (e.g. "months 1–3: AED 8,000 probation, months 4 onward: AED 10,000" or any tiered/stepped pay structure), apply the exact amount for each individual month — do NOT flatten to a single salary. The dueDate of each monthly salary payment is the last calendar day of that month (e.g. 2025-06-30, 2025-07-31). Description: "Month N — MonthName YYYY" with a note if the amount changes (e.g. "Month 1 — Jun 2025 (probation)", "Month 4 — Sep 2025 (post-probation)").
  * Use the exact due dates stated. If only payment frequency is given (monthly, quarterly, etc.), calculate dates by adding intervals from the contract start date.
  * Each item must have: dueDate (YYYY-MM-DD), amount (the actual installment amount as a number), currency, description.
  * Extract every single payment for the complete contract term — do not truncate.
  * For invoices, payroll, and all other document types return [].
- isPaid: invoices and invoice_report items only — true if the document or line item is explicitly marked as paid (e.g. "PAID" stamp, payment confirmation, "Date Paid", "Settled", "Cleared"). False or null for unpaid invoices. Null for all other document types.
- paidDate: invoices and invoice_report items only — the date the invoice was paid (ISO 8601: YYYY-MM-DD), if stated. Null if not paid or no date is given.
- invoices: invoice_report documents only — extract EVERY individual invoice as a separate item in this array. Each row or entry in the report becomes one object: {referenceNumber (invoice/reference number, "" if none), parties (array of vendor or client names), issueDate (YYYY-MM-DD, "" if not present), expiryDate (due date YYYY-MM-DD, "" if not present), amount (number, 0 if not present), currency (3-letter code, "" if not present), summary (one sentence describing the invoice, "" if none), notes (any special terms, "" if none), isPaid (true if this specific line is marked paid, otherwise false), paidDate (YYYY-MM-DD, "" if not paid or date unknown)}. Extract every single row — do not truncate. For a single invoice document and all other document types, return [].
- Return null for any field not present or unclear`;

export async function extractDocument(
  fileBuffer: Buffer,
  mimeType: string,
  filename: string
): Promise<DocumentExtraction | null> {
  const fileContent = await buildFileContent(fileBuffer, mimeType, filename);
  fileContent.push({
    type: "text",
    text: "Extract all structured information from this document following the field rules exactly.",
  });

  const schemaJson = {
    type: "object",
    properties: {
      docType: {
        type: "string",
        enum: [
          "visa", "emirates_id", "labor_card", "trade_license",
          "employee_contract", "client_contract", "lease_contract",
          "invoice", "invoice_report", "purchase_order",
          "payroll", "insurance", "government_permit", "other",
        ],
      },
      confidence: { type: "number" },
      parties: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
      issueDate:       { anyOf: [{ type: "string" }, { type: "null" }] },
      expiryDate:      { anyOf: [{ type: "string" }, { type: "null" }] },
      renewalDeadline: { anyOf: [{ type: "string" }, { type: "null" }] },
      amount:          { anyOf: [{ type: "number" }, { type: "null" }] },
      vatAmount:       { anyOf: [{ type: "number" }, { type: "null" }] },
      currency:        { anyOf: [{ type: "string" }, { type: "null" }] },
      issuingCountry:  { type: "string" },
      referenceNumber: { anyOf: [{ type: "string" }, { type: "null" }] },
      paymentTerms:    { anyOf: [{ type: "string" }, { type: "null" }] },
      notes:           { anyOf: [{ type: "string" }, { type: "null" }] },
      employeeName:    { anyOf: [{ type: "string" }, { type: "null" }] },
      jobTitle:        { anyOf: [{ type: "string" }, { type: "null" }] },
      department:      { type: "string" },
      nationality:     { type: "string" },
      payrollPeriod:   { anyOf: [{ type: "string" }, { type: "null" }] },
      payrollEmployees: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name:     { type: "string" },
            salary:   { type: "number" },
            currency: { type: "string" },
            month:    { type: "string" },
          },
          required: ["name", "salary", "currency", "month"],
          additionalProperties: false,
        },
      },
      paymentSchedule: {
        type: "array",
        items: {
          type: "object",
          properties: {
            dueDate:     { type: "string" },
            amount:      { type: "number" },
            currency:    { type: "string" },
            description: { type: "string" },
          },
          required: ["dueDate", "amount", "currency", "description"],
          additionalProperties: false,
        },
      },
      isPaid:   { anyOf: [{ type: "boolean" }, { type: "null" }] },
      paidDate: { anyOf: [{ type: "string" }, { type: "null" }] },
      invoices: {
        type: "array",
        items: {
          type: "object",
          properties: {
            referenceNumber: { type: "string" },
            parties:         { type: "array", items: { type: "string" } },
            issueDate:       { type: "string" },
            expiryDate:      { type: "string" },
            amount:          { type: "number" },
            currency:        { type: "string" },
            summary:         { type: "string" },
            notes:           { type: "string" },
            isPaid:          { type: "boolean" },
            paidDate:        { type: "string" },
          },
          required: ["referenceNumber", "parties", "issueDate", "expiryDate", "amount", "currency", "summary", "notes", "isPaid", "paidDate"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "docType", "confidence", "parties", "summary",
      "issueDate", "expiryDate", "renewalDeadline",
      "amount", "vatAmount", "currency", "issuingCountry", "referenceNumber", "paymentTerms", "notes",
      "employeeName", "jobTitle", "department", "nationality",
      "payrollPeriod", "payrollEmployees", "paymentSchedule",
      "isPaid", "paidDate", "invoices",
    ],
    additionalProperties: false,
  };

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 8192,
    output_config: {
      format: { type: "json_schema", schema: schemaJson },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: fileContent }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;

  try {
    const parsed = JSON.parse(textBlock.text);
    return ExtractionSchema.parse(parsed);
  } catch {
    return null;
  }
}

export async function extractWithContext(
  fileBuffer: Buffer,
  mimeType: string,
  filename: string,
  currentExtraction: DocumentExtraction,
  userPrompt: string,
): Promise<DocumentExtraction | null> {
  const fileContent = await buildFileContent(fileBuffer, mimeType, filename);
  fileContent.push({
    type: "text",
    text: `You previously extracted this document as:\n<previous>\n${JSON.stringify(currentExtraction, null, 2)}\n</previous>\n\nThe user requests:\n${userPrompt}\n\nReturn the updated extraction JSON.`,
  });

  const schemaJson = {
    type: "object",
    properties: {
      docType: {
        type: "string",
        enum: [
          "visa", "emirates_id", "labor_card", "trade_license",
          "employee_contract", "client_contract", "lease_contract",
          "invoice", "invoice_report", "purchase_order",
          "payroll", "insurance", "government_permit", "other",
        ],
      },
      confidence: { type: "number" },
      parties: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
      issueDate:       { anyOf: [{ type: "string" }, { type: "null" }] },
      expiryDate:      { anyOf: [{ type: "string" }, { type: "null" }] },
      renewalDeadline: { anyOf: [{ type: "string" }, { type: "null" }] },
      amount:          { anyOf: [{ type: "number" }, { type: "null" }] },
      vatAmount:       { anyOf: [{ type: "number" }, { type: "null" }] },
      currency:        { anyOf: [{ type: "string" }, { type: "null" }] },
      issuingCountry:  { type: "string" },
      referenceNumber: { anyOf: [{ type: "string" }, { type: "null" }] },
      paymentTerms:    { anyOf: [{ type: "string" }, { type: "null" }] },
      notes:           { anyOf: [{ type: "string" }, { type: "null" }] },
      employeeName:    { anyOf: [{ type: "string" }, { type: "null" }] },
      jobTitle:        { anyOf: [{ type: "string" }, { type: "null" }] },
      department:      { type: "string" },
      nationality:     { type: "string" },
      payrollPeriod:   { anyOf: [{ type: "string" }, { type: "null" }] },
      payrollEmployees: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name:     { type: "string" },
            salary:   { type: "number" },
            currency: { type: "string" },
            month:    { type: "string" },
          },
          required: ["name", "salary", "currency", "month"],
          additionalProperties: false,
        },
      },
      paymentSchedule: {
        type: "array",
        items: {
          type: "object",
          properties: {
            dueDate:     { type: "string" },
            amount:      { type: "number" },
            currency:    { type: "string" },
            description: { type: "string" },
          },
          required: ["dueDate", "amount", "currency", "description"],
          additionalProperties: false,
        },
      },
      isPaid:   { anyOf: [{ type: "boolean" }, { type: "null" }] },
      paidDate: { anyOf: [{ type: "string" }, { type: "null" }] },
      invoices: {
        type: "array",
        items: {
          type: "object",
          properties: {
            referenceNumber: { type: "string" },
            parties:         { type: "array", items: { type: "string" } },
            issueDate:       { type: "string" },
            expiryDate:      { type: "string" },
            amount:          { type: "number" },
            currency:        { type: "string" },
            summary:         { type: "string" },
            notes:           { type: "string" },
            isPaid:          { type: "boolean" },
            paidDate:        { type: "string" },
          },
          required: ["referenceNumber", "parties", "issueDate", "expiryDate", "amount", "currency", "summary", "notes", "isPaid", "paidDate"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "docType", "confidence", "parties", "summary",
      "issueDate", "expiryDate", "renewalDeadline",
      "amount", "vatAmount", "currency", "issuingCountry", "referenceNumber", "paymentTerms", "notes",
      "employeeName", "jobTitle", "department", "nationality",
      "payrollPeriod", "payrollEmployees", "paymentSchedule",
      "isPaid", "paidDate", "invoices",
    ],
    additionalProperties: false,
  };

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    output_config: {
      format: { type: "json_schema", schema: schemaJson },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: fileContent }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;

  try {
    const parsed = JSON.parse(textBlock.text);
    return ExtractionSchema.parse(parsed);
  } catch {
    return null;
  }
}

export async function askAboutDocument(
  fileBuffer: Buffer,
  mimeType: string,
  filename: string,
  extraction: DocumentExtraction,
  question: string,
  chatHistory: Array<{ role: "user" | "assistant"; content: string }> = [],
): Promise<string> {
  const fileContent = await buildFileContent(fileBuffer, mimeType, filename);
  fileContent.push({
    type: "text",
    text: `Extracted structured data from this document:\n<extraction>\n${JSON.stringify(extraction, null, 2)}\n</extraction>`,
  });

  // Build multi-turn messages: document as first user turn, prior Q&A, then new question
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: fileContent },
    { role: "assistant", content: "I have reviewed the document and its extracted data. What would you like to know?" },
    ...chatHistory.map(m => ({ role: m.role, content: m.content } as Anthropic.MessageParam)),
    { role: "user", content: question },
  ];

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system:
      "You are a document assistant. Your ONLY job is to answer questions about the specific document provided — its content, dates, parties, amounts, terms, and other details visible in the document or extraction data. " +
      "If the user asks something unrelated to this document (general knowledge, other topics, coding, etc.), politely refuse and redirect them to ask about the document instead. " +
      "Keep answers concise and factual.",
    messages,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return "I was unable to process your question.";
  return textBlock.text.trim();
}

export function generateAlerts(
  documentId: string,
  docType: string,
  expiryDate: string | null,
  renewalDeadline: string | null,
  parties: string[]
): Array<{ documentId: string; type: string; dueDate: Date; message: string }> {
  const label = DOC_TYPE_LABELS[docType] ?? "Document";
  const party = parties[0] ?? "";
  const who = party ? ` — ${party}` : "";
  const now = new Date();

  if (docType === "employee_contract") {
    // Employee contracts: alert 90 days before expiry
    if (!expiryDate) return [];
    const dueDate = new Date(expiryDate);
    dueDate.setDate(dueDate.getDate() - 90);
    if (dueDate <= now) return [];
    return [{
      documentId,
      type: "renewal_reminder",
      dueDate,
      message: `Action required: ${label}${who} — Contract expires ${expiryDate}`,
    }];
  }

  // All other docs: 15 days before renewal notice deadline, or 15 days before expiry
  const anchorDateStr = renewalDeadline ?? expiryDate;
  if (!anchorDateStr) return [];

  const anchor = new Date(anchorDateStr);
  const dueDate = new Date(anchor);
  dueDate.setDate(dueDate.getDate() - 15);

  if (dueDate <= now) return [];

  const actionLabel = renewalDeadline
    ? `Renewal notice due ${renewalDeadline}`
    : `Contract expires ${expiryDate}`;

  return [{
    documentId,
    type: "renewal_reminder",
    dueDate,
    message: `Action required: ${label}${who} — ${actionLabel}`,
  }];
}
