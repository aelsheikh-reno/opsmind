import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import mammoth from "mammoth";
import Anthropic from "@anthropic-ai/sdk";
import { applyReplacementsToDocx, type Replacement } from "@/lib/docx-replacements";

// ─── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");

  // ── Refinement mode: JSON body with contractText + existing replacements + prompt ──
  if (isJson) {
    const { contractText, existingReplacements, refinementPrompt } = await req.json() as {
      contractText: string;
      existingReplacements: Replacement[];
      refinementPrompt: string;
    };
    if (!contractText || !refinementPrompt?.trim()) {
      return NextResponse.json({ error: "contractText and refinementPrompt are required" }, { status: 400 });
    }

    const client = new Anthropic();
    let replacements: Replacement[];

    const existingList = existingReplacements.map((r) => `  • "${r.original}" → ${r.placeholder}`).join("\n");

    try {
      const response = await client.messages.create({
        model: "claude-opus-4-7",
        max_tokens: 8096,
        messages: [{
          role: "user",
          content: `You are an expert HR document analyst. You have already extracted these placeholders from an employment contract:

${existingList || "  (none yet)"}

The user wants to refine the extraction with this instruction:
"${refinementPrompt.trim()}"

Here is the full contract text:
━━━
${contractText}
━━━

Apply the user's instruction. You may add new fields, remove fields, rename placeholders, or re-examine the contract for anything missed.

STRICT RULES:
1. "original" = the EXACT verbatim text from the contract — copy character-for-character
2. Include ALL fields in the final list — both unchanged existing ones and any new/updated ones
3. If the user asks to remove a field, omit it from the output
4. If the user renames a placeholder, keep the same "original" but update "placeholder"
5. Do NOT replace: employer/company name, legal clause text, section numbers
6. Return ONLY a JSON array — no markdown, no explanation

[{"original": "exact text", "placeholder": "{{Field Name}}"}]`,
        }],
      });

      const raw = response.content[0].type === "text" ? response.content[0].text.trim() : "";
      const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      replacements = Array.isArray(JSON.parse(json)) ? JSON.parse(json) : [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `AI refinement failed: ${msg}` }, { status: 502 });
    }

    const placeholders = [...new Set(
      replacements.map((r) => r.placeholder.replace(/^\{\{|\}\}$/g, "").trim()).filter(Boolean)
    )];

    return NextResponse.json({ replacements, placeholders, contractText });
  }

  // ── Initial extraction mode: FormData with .docx file ──
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());

  let contractText: string;
  try {
    const result = await mammoth.extractRawText({ buffer });
    contractText = result.value;
  } catch {
    return NextResponse.json({ error: "Could not read DOCX file" }, { status: 422 });
  }
  if (contractText.trim().length < 50) {
    return NextResponse.json({ error: "Document appears to be empty or unreadable" }, { status: 422 });
  }

  const client = new Anthropic();
  let replacements: Replacement[];

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 8096,
      messages: [
        {
          role: "user",
          content: `You are an expert HR document analyst. Convert this filled employment contract into a reusable template by identifying and replacing EVERY employee-specific value with a {{Placeholder}}.

Be EXHAUSTIVE. Read every single line and replace everything that is personal to this specific employee.

━━ WHAT TO FIND — go through the contract line by line ━━

NAMES — find every form the name appears in:
• Full name (all parts together) → {{Full Name}}
• First name alone → {{First Name}}
• Last name alone → {{Last Name}}
• Any other partial combination used separately → unique placeholder for each

CONTACT & IDENTITY:
• Email address → {{Employee Email}}
• Phone / mobile number → {{Employee Phone}}
• Home / residential address → {{Employee Address}}
• National ID / Emirates ID number → {{National ID}}
• Passport number → {{Passport Number}}
• Visa / residency / UID number → {{Visa Number}}
• Date of birth → {{Date of Birth}}

EMPLOYMENT:
• Job title / designation → {{Job Title}}
• Department / division → {{Department}}
• Employee number or code → {{Employee ID}}
• Nationality / citizenship → {{Nationality}}
• Work location (if individual) → {{Work Location}}

DATES:
• Joining / start date → {{Start Date}}
• Contract end / expiry date → {{End Date}}
• Probation end date → {{Probation End Date}}
• Any other employee-specific date → appropriate placeholder
• NO EXPLICIT END DATE — if no specific end date appears but the contract states a duration (e.g. "for a period of one year", "for 12 months", "for two (2) years", "for a term of 24 months"):
  - Use the duration expression itself as "original" and {{End Date}} as "placeholder"
  - Example: original="one (1) year", placeholder="{{End Date}}" → contract reads "for a period of {{End Date}}"
  - Pick the shortest self-contained duration expression so surrounding text (like "for a period of") stays intact
  - If neither an explicit end date NOR a duration is mentioned, omit {{End Date}} entirely — do not invent it

FINANCIAL — replace the NUMBER only, keep currency text as-is:
• Basic salary → {{Basic Salary}}
• Housing allowance → {{Housing Allowance}}
• Transportation allowance → {{Transportation Allowance}}
• Medical / health allowance → {{Medical Allowance}}
• Education allowance → {{Education Allowance}}
• Any other named allowance → {{[Name] Allowance}}
• Total / gross salary → {{Total Salary}}
• Any bonus amount → {{Bonus Amount}}

SIGNATURES:
• Employee signature name if written out → {{Full Name}} or appropriate

━━ STRICT RULES ━━
1. "original" = the EXACT verbatim text copied from the contract below — no paraphrasing, no decoding, copy character-for-character including spacing
2. ONLY replace what you can see — do not invent fields not present
3. If the same value appears multiple times identically, one entry is enough
4. DO NOT replace: employer/company name, company address, company contact, legal clause text, article/section numbers, generic labels like "Employee:" or "Salary:"
5. Numbers in financial fields: replace ONLY the number (e.g. "20,000" not "AED 20,000")
6. Return ONLY a JSON array — no markdown, no explanation, nothing else

Output:
[
  {"original": "exact text", "placeholder": "{{Field Name}}"}
]

━━ CONTRACT ━━
${contractText}`,
        },
      ],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(json);
    replacements = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `AI analysis failed: ${msg}` }, { status: 502 });
  }

  if (replacements.length === 0) {
    return NextResponse.json(
      { error: "No employee-specific fields detected — check the extracted text below", contractText },
      { status: 422 }
    );
  }

  const templateBuffer = applyReplacementsToDocx(buffer, replacements);
  const placeholders = [...new Set(
    replacements.map((r) => r.placeholder.replace(/^\{\{|\}\}$/g, "").trim()).filter(Boolean)
  )];

  return NextResponse.json({
    originalDocxBase64: buffer.toString("base64"),
    docxBase64: templateBuffer.toString("base64"),
    placeholders,
    replacements,
    contractText,
  });
}
