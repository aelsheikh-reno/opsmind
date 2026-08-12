import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

async function getAsanaConfig() {
  const [tokenSetting, userGidSetting, workspaceSetting] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "asanaAccessToken" } }),
    prisma.setting.findUnique({ where: { key: "asanaUserGid" } }),
    prisma.setting.findUnique({ where: { key: "asanaWorkspaceGid" } }),
  ]);
  return {
    token: tokenSetting?.value || process.env.ASANA_ACCESS_TOKEN || "",
    userGid: userGidSetting?.value || process.env.ASANA_USER_GID || "",
    workspaceGid: workspaceSetting?.value || process.env.ASANA_WORKSPACE_GID || "",
  };
}

type AsanaTask = {
  gid: string;
  name: string;
  notes: string;
  completed: boolean;
  due_on: string | null;
  created_at: string;
};

type AsanaAttachment = {
  gid: string;
  name: string;
  download_url: string;
  size: number | null;
};

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp", pdf: "application/pdf",
    heic: "image/heic", heif: "image/heif",
  };
  return map[ext] ?? "application/octet-stream";
}

function parseDescription(notes: string) {
  const extract = (key: string) => {
    const regex = new RegExp(`${key}:\\s*\\n?([^\\n]+)`, "i");
    const match = notes.match(regex);
    return match ? match[1].trim() : undefined;
  };
  return {
    currency: extract("Currency"),
    expenseType: extract("Expense Type"),
    paymentMethod: extract("Payment Method"),
    submitterEmail: extract("Email address"),
  };
}

async function extractAmountFromAttachment(downloadUrl: string): Promise<number | null> {
  try {
    const imgRes = await fetch(downloadUrl);
    if (!imgRes.ok) return null;
    const buffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const rawType = imgRes.headers.get("content-type") ?? "image/jpeg";
    const mediaType = (
      ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(rawType)
        ? rawType
        : "image/jpeg"
    ) as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 64,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: "What is the total amount on this receipt or payment proof? Reply with only the numeric value (e.g. 250.00). If you cannot determine the amount, reply with exactly: unknown",
            },
          ],
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text.trim() : "";
    if (!text || text.toLowerCase() === "unknown") return null;
    const amount = parseFloat(text.replace(/[^0-9.]/g, ""));
    return isNaN(amount) ? null : amount;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  // Optional date range: YYYY-MM-DD strings.
  // When called by the cron (no params), fall back to the saved asanaSyncFrom preference.
  const searchParams = req.nextUrl.searchParams;
  const fromParam = searchParams.get("from") ?? (
    await prisma.setting.findUnique({ where: { key: "asanaSyncFrom" } })
  )?.value ?? null;
  const toParam   = searchParams.get("to");
  const fromDate  = fromParam ? new Date(fromParam) : null;
  const toDate    = toParam   ? new Date(toParam + "T23:59:59") : null;

  const { token: ASANA_TOKEN, userGid: ASANA_USER_GID, workspaceGid: ASANA_WORKSPACE_GID } = await getAsanaConfig();
  if (!ASANA_TOKEN || !ASANA_USER_GID || !ASANA_WORKSPACE_GID) {
    return NextResponse.json({ ok: false, error: "Asana credentials not configured" }, { status: 400 });
  }

  // Paginate through all assigned tasks
  const tasks: AsanaTask[] = [];
  let offset: string | undefined;

  do {
    const url = new URL("https://app.asana.com/api/1.0/tasks");
    url.searchParams.set("assignee", ASANA_USER_GID);
    url.searchParams.set("workspace", ASANA_WORKSPACE_GID);
    url.searchParams.set("opt_fields", "gid,name,notes,completed,due_on,created_at");
    url.searchParams.set("limit", "100");
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${ASANA_TOKEN}` },
    });
    const data = (await res.json()) as { data: AsanaTask[]; next_page?: { offset: string } };
    tasks.push(...(data.data ?? []));
    offset = data.next_page?.offset;
  } while (offset);

  const expenseTasks = tasks
    .filter((t) => t.notes?.includes("submitted through Expenses"))
    .filter((t) => {
      if (!fromDate && !toDate) return true;
      const raw = t.due_on ?? t.created_at;
      if (!raw) return false;
      const d = new Date(raw);
      if (fromDate && d < fromDate) return false;
      if (toDate   && d > toDate)   return false;
      return true;
    });

  let synced = 0;
  let extracted = 0;

  for (const task of expenseTasks) {
    const parsed = parseDescription(task.notes ?? "");

    const existingByGid = await prisma.expense.findUnique({
      where: { asanaTaskGid: task.gid },
      select: { id: true, amount: true, amountConfirmed: true },
    });

    // If not found by GID, check for a Zoho-imported record with the same name —
    // claim it rather than creating a duplicate.
    const zohoMatch = !existingByGid
      ? await prisma.expense.findFirst({
          where: {
            zohoExpenseId: { not: null },
            asanaTaskGid: null,
            name: { equals: task.name, mode: "insensitive" },
          },
          select: { id: true, amount: true, amountConfirmed: true },
        })
      : null;

    const existing = existingByGid ?? zohoMatch;

    const expenseData = {
      name:           task.name,
      currency:       parsed.currency ?? "AED",
      expenseType:    parsed.expenseType,
      paymentMethod:  parsed.paymentMethod,
      submitterEmail: parsed.submitterEmail,
      dueOn:          task.due_on ? new Date(task.due_on) : null,
      completed:      task.completed,
      notes:          task.notes,
    };

    let expense;
    if (zohoMatch) {
      // Claim the Zoho-imported row instead of inserting a duplicate
      expense = await prisma.expense.update({
        where: { id: zohoMatch.id },
        data: { asanaTaskGid: task.gid, asanaCreatedAt: task.created_at ? new Date(task.created_at) : null, ...expenseData },
      });
    } else {
      expense = await prisma.expense.upsert({
        where: { asanaTaskGid: task.gid },
        create: { asanaTaskGid: task.gid, asanaCreatedAt: task.created_at ? new Date(task.created_at) : null, ...expenseData },
        update: expenseData,
      });
    }

    synced++;

    // Always sync attachments — upload to S3 so links never expire
    const attRes = await fetch(
      `https://app.asana.com/api/1.0/attachments?parent=${task.gid}&opt_fields=gid,name,download_url,size`,
      { headers: { Authorization: `Bearer ${ASANA_TOKEN}` } }
    );
    const attData = (await attRes.json()) as { data: AsanaAttachment[] };
    const attachments = attData.data ?? [];

    for (const att of attachments) {
      if (!att.download_url) continue;

      // Check if already uploaded to S3 (key doesn't start with https://)
      const existingAtt = await prisma.expenseAttachment.findUnique({ where: { asanaGid: att.gid } });
      let storageKey = existingAtt?.downloadUrl;

      if (!storageKey || storageKey.startsWith("https://")) {
        try {
          const fileRes = await fetch(att.download_url);
          if (fileRes.ok) {
            const buffer = Buffer.from(await fileRes.arrayBuffer());
            const contentType = fileRes.headers.get("content-type") ?? mimeFromName(att.name);
            storageKey = await uploadFile(`expense-attachments/${att.gid}/${att.name}`, buffer, contentType);
          }
        } catch { /* keep existing URL as fallback */ }
        storageKey ??= att.download_url;
      }

      await prisma.expenseAttachment.upsert({
        where: { asanaGid: att.gid },
        create: {
          asanaGid: att.gid,
          expenseId: expense.id,
          name: att.name,
          downloadUrl: storageKey,
          size: att.size,
        },
        update: { downloadUrl: storageKey },
      });
    }

    // Skip amount extraction for already-confirmed expenses
    if (existing?.amountConfirmed) continue;

    // Extract amount from first image attachment if not yet set
    if (!existing?.amount && attachments.length > 0) {
      const imageAtt = attachments.find((a) =>
        /\.(jpg|jpeg|png|gif|webp)$/i.test(a.name)
      );
      if (imageAtt?.download_url) {
        const amount = await extractAmountFromAttachment(imageAtt.download_url);
        if (amount !== null) {
          await prisma.expense.update({
            where: { id: expense.id },
            data: { amount },
          });
          extracted++;
        }
      }
    }
  }

  // Remove claims that no longer exist in Asana (never touch manually-created expenses)
  const activeGids = new Set(expenseTasks.map((t) => t.gid));
  const { count: deleted } = await prisma.expense.deleteMany({
    where: { asanaTaskGid: { not: null, notIn: Array.from(activeGids) } },
  });

  return NextResponse.json({ ok: true, synced, extracted, deleted });
  } catch (err) {
    console.error("[asana-expenses]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
