const BASE = "https://www.zohoapis.com/books/v3";
const AUTH = "https://accounts.zoho.com/oauth/v2";

export function getAuthUrl(): string {
  const params = new URLSearchParams({
    scope: "ZohoBooks.expenses.CREATE,ZohoBooks.expenses.READ,ZohoBooks.settings.READ,ZohoBooks.accountants.READ,ZohoBooks.contacts.READ",
    client_id: process.env.ZOHO_CLIENT_ID!,
    response_type: "code",
    redirect_uri: process.env.ZOHO_REDIRECT_URI!,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH}/auth?${params}`;
}

export async function exchangeCode(code: string) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.ZOHO_CLIENT_ID!,
    client_secret: process.env.ZOHO_CLIENT_SECRET!,
    redirect_uri: process.env.ZOHO_REDIRECT_URI!,
    code,
  });
  const res = await fetch(`${AUTH}/token`, { method: "POST", body: params });
  return res.json() as Promise<{ access_token?: string; refresh_token?: string; expires_in?: number; error?: string }>;
}

export async function refreshAccessToken(refreshToken: string) {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID!,
    client_secret: process.env.ZOHO_CLIENT_SECRET!,
    refresh_token: refreshToken,
  });
  const res = await fetch(`${AUTH}/token`, { method: "POST", body: params });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data as { access_token: string; expires_in: number };
}

export async function getOrganizations(accessToken: string) {
  const res = await fetch(`${BASE}/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const data = await res.json();
  return (data.organizations ?? []) as Array<{ organization_id: string; name: string }>;
}

export async function getCurrencies(accessToken: string, orgId: string) {
  const res = await fetch(`${BASE}/settings/currencies?organization_id=${orgId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const data = await res.json();
  return (data.currencies ?? []) as Array<{ currency_id: string; currency_code: string }>;
}

const EXPENSE_ACCOUNT_TYPES = ["expense", "other_expense", "cost_of_goods_sold"];

export async function getExpenseAccounts(accessToken: string, orgId: string) {
  const res = await fetch(`${BASE}/chartofaccounts?organization_id=${orgId}&filter_by=AccountType.Expense`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const data = await res.json();
  console.log("[zoho] chartofaccounts response:", JSON.stringify(data).slice(0, 1000));
  const all = (data.chartofaccounts ?? []) as Array<{ account_id: string; account_name: string; account_type: string }>;
  return all.filter(a => EXPENSE_ACCOUNT_TYPES.includes(a.account_type));
}

export type ZohoLineItem = {
  line_item_id: string;
  account_id: string;
  account_name: string;
  description: string;
  amount: number;
};

export type ZohoExpense = {
  expense_id: string;
  account_id: string;
  account_name: string;
  vendor_name: string;
  date: string;
  amount: number;
  total: number;
  currency_code: string;
  description: string;
  reference_number: string;
  notes: string;
  payment_mode: string;
  line_items: ZohoLineItem[];
};

export async function getExpenseDetail(accessToken: string, orgId: string, expenseId: string): Promise<ZohoExpense | null> {
  const res = await fetch(`${BASE}/expenses/${expenseId}?organization_id=${orgId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const data = await res.json();
  return data.expense ?? null;
}

export async function getExpenses(accessToken: string, orgId: string): Promise<ZohoExpense[]> {
  const results: ZohoExpense[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${BASE}/expenses?organization_id=${orgId}&per_page=200&page=${page}`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );
    const data = await res.json();
    // Zoho returns code 0 on success; anything else is an error
    if (data.code !== undefined && data.code !== 0) {
      throw new Error(`Zoho API error ${data.code}: ${data.message ?? JSON.stringify(data)}`);
    }
    const items = (data.expenses ?? []) as ZohoExpense[];
    results.push(...items);
    if (!data.page_context?.has_more_page) break;
    page++;
  }
  return results;
}

export async function getVendors(accessToken: string, orgId: string): Promise<Array<{ contact_id: string; contact_name: string }>> {
  const res = await fetch(
    `${BASE}/contacts?organization_id=${orgId}&contact_type=vendor&per_page=200`,
    { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
  );
  const data = await res.json();
  return (data.contacts ?? []) as Array<{ contact_id: string; contact_name: string }>;
}

export async function deleteZohoExpense(accessToken: string, orgId: string, expenseId: string) {
  const res = await fetch(`${BASE}/expenses/${expenseId}?organization_id=${orgId}`, {
    method: "DELETE",
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  return res.json() as Promise<{ code: number; message?: string }>;
}

export async function createZohoExpense(
  accessToken: string,
  orgId: string,
  body: {
    account_id: string;
    date: string;
    amount: number;
    currency_id?: string;
    paid_through_account_id?: string;
    vendor_id?: string;
    description?: string;
    reference_number?: string;
    line_items?: Array<{ account_id: string; amount: number; description?: string }>;
  }
) {
  console.log("[zoho] createExpense body:", JSON.stringify(body));
  const res = await fetch(`${BASE}/expenses?organization_id=${orgId}`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  console.log("[zoho] createExpense response:", JSON.stringify(data));
  return data as { code: number; expense?: { expense_id: string; currency_code?: string }; message?: string };
}

export async function getValidToken(conn: {
  id: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}): Promise<{ accessToken: string; updated: { accessToken: string; expiresAt: Date } | null }> {
  if (new Date(conn.expiresAt) > new Date(Date.now() + 60_000)) {
    return { accessToken: conn.accessToken, updated: null };
  }
  const refreshed = await refreshAccessToken(conn.refreshToken);
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  return { accessToken: refreshed.access_token, updated: { accessToken: refreshed.access_token, expiresAt } };
}
