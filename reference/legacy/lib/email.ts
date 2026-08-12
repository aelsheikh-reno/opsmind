import { Resend } from "resend";
import { prisma } from "@/lib/prisma";

async function getEmailConfig(): Promise<{ resend: Resend; from: string }> {
  const [apiKeySetting, fromSetting] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "resendApiKey" } }),
    prisma.setting.findUnique({ where: { key: "claimFromEmail" } }),
  ]);
  const apiKey = apiKeySetting?.value || process.env.RESEND_API_KEY || "";
  const from = fromSetting?.value || process.env.CLAIM_FROM_EMAIL || "OpsMind <noreply@reno.systems>";
  return { resend: new Resend(apiKey), from };
}

export async function sendOtpEmail(to: string, otp: string, name: string) {
  const { resend, from: FROM } = await getEmailConfig();
  const result = await resend.emails.send({
    from: FROM,
    to,
    subject: "Your OpsMind expense claim code",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="margin:0 0 8px;font-size:20px;color:#111">Expense claim verification</h2>
        <p style="margin:0 0 24px;color:#555;font-size:14px">Hi ${name}, use the code below to confirm your expense submission. It expires in 10 minutes.</p>
        <div style="background:#f4f4f5;border-radius:12px;padding:24px;text-align:center;letter-spacing:8px;font-size:32px;font-weight:700;color:#111">
          ${otp}
        </div>
        <p style="margin:24px 0 0;color:#999;font-size:12px">If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
  if (result.error) {
    console.error("[resend]", result.error);
    throw new Error(result.error.message);
  }
}

type PayslipComponent = { name: string; amount: number };
type PayslipExpense = { name: string; amount: number; currency: string; amountUsd: number };

export type PayslipHtmlOpts = {
  employeeName: string;
  jobTitle?: string | null;
  period: string;
  currency: string;
  salary: number;
  components: PayslipComponent[];
  expenses: PayslipExpense[];
  fxRate?: number | null;
  usdEquiv: number;
  totalUsd: number;
  isPaid: boolean;
  companyName?: string | null;
  showInContractCurrency?: boolean;
};

export function buildPayslipHtml(opts: PayslipHtmlOpts): string {
  const { employeeName, jobTitle, period, currency, salary, components, expenses, fxRate, usdEquiv, totalUsd, isPaid, companyName, showInContractCurrency } = opts;
  const hasComponents = components.length > 1;
  const hasExpenses = expenses.length > 0;
  const isNonUsd = currency !== "USD";

  const componentRows = hasComponents
    ? components.map(c => `
        <tr>
          <td style="padding:7px 0;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6">${c.name}</td>
          <td style="padding:7px 0;font-size:13px;font-weight:600;color:#111;text-align:right;border-bottom:1px solid #f3f4f6">${currency} ${c.amount.toLocaleString()}</td>
        </tr>`).join("")
    : "";

  const expenseRows = hasExpenses
    ? expenses.map(e => `
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#374151;border-bottom:1px solid #f0fdf4">${e.name}</td>
          <td style="padding:6px 0;font-size:12px;font-weight:600;color:#0d9488;text-align:right;border-bottom:1px solid #f0fdf4">
            ${e.currency} ${e.amount.toLocaleString()}${e.currency !== "USD" ? ` <span style="font-weight:400;color:#9ca3af">(≈ USD ${e.amountUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>` : ""}
          </td>
        </tr>`).join("")
    : "";

  return `
    <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
      <!-- Header -->
      <div style="background:#18181b;padding:28px 32px">
        ${companyName ? `<p style="color:#fff;font-size:15px;font-weight:700;margin:0 0 10px">${companyName}</p>` : ""}
        <p style="color:#71717a;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;margin:0 0 6px">PAYSLIP</p>
        <p style="color:#fff;font-size:22px;font-weight:800;margin:0">${period}</p>
      </div>

      <!-- Employee info -->
      <div style="padding:20px 32px;background:#f9fafb;border-bottom:1px solid #e5e7eb">
        <p style="font-size:16px;font-weight:700;color:#111;margin:0 0 3px">${employeeName}</p>
        ${jobTitle ? `<p style="font-size:12px;color:#6b7280;margin:0">${jobTitle}</p>` : ""}
      </div>

      <!-- Salary breakdown -->
      <div style="padding:24px 32px;border-bottom:1px solid #e5e7eb">
        <p style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 14px">Earnings</p>
        <table style="width:100%;border-collapse:collapse">
          ${componentRows}
          <tr>
            <td style="padding:${hasComponents ? "12px 0 0" : "0"};font-size:14px;font-weight:700;color:#111${hasComponents ? ";border-top:2px solid #e5e7eb" : ""}">Total Salary</td>
            <td style="padding:${hasComponents ? "12px 0 0" : "0"};font-size:18px;font-weight:800;color:#111;text-align:right${hasComponents ? ";border-top:2px solid #e5e7eb" : ""}">${currency} ${salary.toLocaleString()}</td>
          </tr>
        </table>
        ${isNonUsd && fxRate && !showInContractCurrency ? `<p style="font-size:11px;color:#9ca3af;margin:6px 0 0">≈ USD ${usdEquiv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} &nbsp;·&nbsp; 1 USD = ${fxRate.toFixed(2)} ${currency}</p>` : ""}
      </div>

      ${hasExpenses ? `
      <!-- Expense reimbursements -->
      <div style="padding:20px 32px;border-bottom:1px solid #e5e7eb;background:#f0fdf9">
        <p style="font-size:10px;font-weight:700;color:#0d9488;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 12px">Expense Reimbursements</p>
        <table style="width:100%;border-collapse:collapse">
          ${expenseRows}
        </table>
      </div>` : ""}

      <!-- Total to pay -->
      <div style="padding:22px 32px;background:#eff6ff;border-bottom:1px solid #e5e7eb">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <p style="font-size:12px;color:#6b7280;margin:0 0 4px">Total to Pay</p>
            ${isPaid ? `<span style="display:inline-block;font-size:10px;font-weight:700;color:#059669;background:#ecfdf5;padding:2px 10px;border-radius:20px;letter-spacing:1px">PAID</span>` : `<span style="display:inline-block;font-size:10px;font-weight:700;color:#d97706;background:#fffbeb;padding:2px 10px;border-radius:20px;letter-spacing:1px">PENDING</span>`}
          </div>
          ${showInContractCurrency
            ? `<p style="font-size:22px;font-weight:800;color:#1e40af;margin:0">${currency} ${salary.toLocaleString()}</p>`
            : `<p style="font-size:22px;font-weight:800;color:#1e40af;margin:0">USD ${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>`
          }
        </div>
      </div>

      <!-- Footer -->
      <div style="padding:16px 32px;border-top:1px solid #f3f4f6">
        <p style="font-size:11px;color:#6b7280;margin:0 0 6px;font-style:italic">
          Please note: for international transfers, allow 3–5 business days to reflect in your account. For SWIFT transactions, allow 2–3 business days.
        </p>
        <p style="font-size:11px;color:#9ca3af;margin:0">This payslip was generated automatically by ${companyName ?? "your company"}. For queries, contact your HR department.</p>
      </div>
    </div>
  `;
}

export async function sendPayslipEmail(opts: PayslipHtmlOpts & { to: string; cc?: string[] }) {
  const { to, cc, companyName, period } = opts;
  const html = buildPayslipHtml(opts);

  const { resend, from: rawFrom } = await getEmailConfig();
  // Replace the display name portion with the company name if configured.
  // "OpsMind <noreply@reno.systems>" → "Acme Corp <noreply@reno.systems>"
  const FROM = companyName
    ? rawFrom.replace(/^[^<]*</, `${companyName} <`)
    : rawFrom;
  const result = await resend.emails.send({
    from: FROM,
    to,
    ...(cc && cc.length > 0 ? { cc } : {}),
    subject: companyName ? `${companyName} - Payslip - ${period}` : `Payslip - ${period}`,
    html,
  });
  if (result.error) {
    console.error("[resend payslip]", result.error);
    throw new Error(result.error.message);
  }
}

export type ExpiryReminderItem = {
  type: "document" | "invoice" | "liability";
  label: string;
  detail: string;
  daysLeft: number;
  amount?: string;
};

export function buildExpiryReminderHtml(items: ExpiryReminderItem[]): string {
  const overdue  = items.filter(i => i.daysLeft < 0);
  const critical = items.filter(i => i.daysLeft >= 0 && i.daysLeft <= 3);
  const warning  = items.filter(i => i.daysLeft > 3 && i.daysLeft <= 7);
  const upcoming = items.filter(i => i.daysLeft > 7 && i.daysLeft <= 90);

  function urgencyBadge(daysLeft: number) {
    if (daysLeft < 0)  return `<span style="display:inline-block;font-size:10px;font-weight:700;color:#fff;background:#dc2626;padding:2px 8px;border-radius:20px;letter-spacing:.5px">OVERDUE</span>`;
    if (daysLeft <= 3) return `<span style="display:inline-block;font-size:10px;font-weight:700;color:#dc2626;background:#fef2f2;padding:2px 8px;border-radius:20px;letter-spacing:.5px">${daysLeft === 0 ? "TODAY" : daysLeft === 1 ? "TOMORROW" : `${daysLeft} DAYS`}</span>`;
    if (daysLeft <= 7) return `<span style="display:inline-block;font-size:10px;font-weight:700;color:#d97706;background:#fffbeb;padding:2px 8px;border-radius:20px;letter-spacing:.5px">${daysLeft} DAYS</span>`;
    return `<span style="display:inline-block;font-size:10px;font-weight:700;color:#2563eb;background:#eff6ff;padding:2px 8px;border-radius:20px;letter-spacing:.5px">${daysLeft} DAYS</span>`;
  }

  function typeIcon(type: ExpiryReminderItem["type"]) {
    if (type === "invoice")   return "📥";
    if (type === "liability") return "💸";
    return "📄";
  }

  function typeLabel(type: ExpiryReminderItem["type"]) {
    if (type === "invoice")   return "Invoice to collect";
    if (type === "liability") return "Payment due";
    return "Document expiry";
  }

  function renderSection(title: string, color: string, bg: string, sectionItems: ExpiryReminderItem[]) {
    if (sectionItems.length === 0) return "";
    const rows = sectionItems.map(item => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;vertical-align:top">
          <div style="display:flex;align-items:flex-start;gap:10px">
            <span style="font-size:16px;line-height:1">${typeIcon(item.type)}</span>
            <div style="flex:1;min-width:0">
              <p style="margin:0 0 2px;font-size:13px;font-weight:600;color:#111">${item.label}</p>
              <p style="margin:0;font-size:11px;color:#6b7280">${typeLabel(item.type)} · ${item.detail}${item.amount ? ` · <strong style="color:#374151">${item.amount}</strong>` : ""}</p>
            </div>
            <div style="flex-shrink:0">${urgencyBadge(item.daysLeft)}</div>
          </div>
        </td>
      </tr>`).join("");

    return `
      <div style="margin-bottom:24px">
        <p style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:1.5px;margin:0 0 12px;padding:6px 12px;background:${bg};border-radius:6px">${title} (${sectionItems.length})</p>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return `
    <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="background:#18181b;padding:28px 32px">
        <p style="color:#71717a;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;margin:0 0 6px">OPSMIND · DAILY DIGEST</p>
        <p style="color:#fff;font-size:22px;font-weight:800;margin:0">Action required</p>
        <p style="color:#a1a1aa;font-size:13px;margin:6px 0 0">${today}</p>
      </div>

      <div style="padding:8px 32px 4px">
        <p style="font-size:13px;color:#6b7280;margin:16px 0">
          You have <strong style="color:#111">${items.length} item${items.length !== 1 ? "s" : ""}</strong> requiring attention${overdue.length > 0 ? ` — including <strong style="color:#dc2626">${overdue.length} overdue</strong>` : ""}.
        </p>
      </div>

      <div style="padding:4px 32px 24px">
        ${renderSection("🔴 Overdue — action needed now", "#dc2626", "#fef2f2", overdue)}
        ${renderSection("🔴 Critical — due within 3 days", "#dc2626", "#fef2f2", critical)}
        ${renderSection("🟡 Due within 7 days", "#d97706", "#fffbeb", warning)}
        ${renderSection("🔵 Upcoming", "#2563eb", "#eff6ff", upcoming)}
      </div>

      <div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center">
        <p style="font-size:11px;color:#9ca3af;margin:0">Sent by OpsMind · This is an automated daily digest.</p>
      </div>
    </div>
  `;
}

export async function sendExpiryReminderEmail(to: string, items: ExpiryReminderItem[]) {
  if (items.length === 0) return;
  const html = buildExpiryReminderHtml(items);
  const overdue  = items.filter(i => i.daysLeft < 0);
  const critical = items.filter(i => i.daysLeft >= 0 && i.daysLeft <= 3);
  const { resend, from: FROM } = await getEmailConfig();
  const result = await resend.emails.send({
    from: FROM,
    to,
    subject: `[OpsMind] ${(overdue.length + critical.length) > 0 ? `⚠️ ${overdue.length + critical.length} urgent · ` : ""}${items.length} item${items.length !== 1 ? "s" : ""} need attention`,
    html,
  });
  if (result.error) {
    console.error("[resend expiry-reminder]", result.error);
    throw new Error(result.error.message);
  }
}

export async function sendClaimStatusEmail(to: string, status: "approved" | "rejected", note: string | null, reviewerName?: string) {
  const { resend, from: FROM } = await getEmailConfig();
  const approved = status === "approved";
  const result = await resend.emails.send({
    from: FROM,
    to,
    subject: approved ? "Your expense claim has been approved" : "Your expense claim was not approved",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="width:48px;height:48px;border-radius:50%;background:${approved ? "#f0fdf4" : "#fef2f2"};display:flex;align-items:center;justify-content:center;margin-bottom:20px">
          <span style="font-size:22px">${approved ? "✓" : "✗"}</span>
        </div>
        <h2 style="margin:0 0 8px;font-size:18px;color:#111">${approved ? "Claim approved" : "Claim not approved"}</h2>
        <p style="margin:0 0 16px;color:#555;font-size:14px">
          ${approved
            ? "Your expense claim has been reviewed and approved."
            : "Your expense claim was reviewed and could not be approved at this time."}
        </p>
        ${reviewerName ? `<p style="margin:0 0 16px;color:#555;font-size:14px">Reviewed by <strong>${reviewerName}</strong>.</p>` : ""}
        ${note ? `<div style="background:#f4f4f5;border-radius:10px;padding:14px 16px;font-size:13px;color:#444;margin-bottom:16px"><strong>Note from reviewer:</strong><br/>${note}</div>` : ""}
        <p style="margin:0;color:#999;font-size:12px">If you have questions, please contact your manager.</p>
      </div>
    `,
  });
  if (result.error) console.error("[resend claim-status]", result.error);
}
