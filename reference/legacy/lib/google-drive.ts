import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/plain",
];

function getClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

export function getAuthUrl(): string {
  return getClient().generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function exchangeCode(code: string) {
  const { tokens } = await getClient().getToken(code);
  return tokens;
}

export async function getAccessToken(refreshToken: string): Promise<string> {
  const client = getClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) throw new Error("Token refresh failed");
  return credentials.access_token;
}

export async function getUserEmail(accessToken: string): Promise<string> {
  const client = getClient();
  client.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  return data.email ?? "unknown@google.com";
}

export async function getFolderName(folderId: string, accessToken: string): Promise<string> {
  const client = getClient();
  client.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: "v3", auth: client });
  const { data } = await drive.files.get({ fileId: folderId, fields: "name,mimeType" });
  if (data.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("The provided ID is not a folder");
  }
  return data.name ?? "Unnamed folder";
}

async function collectFilesRecursively(
  folderId: string,
  drive: ReturnType<typeof google.drive>,
  alreadySyncedIds: Set<string>,
  results: { id: string; name: string; mimeType: string }[],
  visitedFolders: Set<string>,
): Promise<void> {
  if (visitedFolders.has(folderId)) return;
  visitedFolders.add(folderId);

  const mimeQ = ALLOWED_MIME_TYPES.map(m => `mimeType='${m}'`).join(" or ");

  // List documents in this folder (paginated)
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and (${mimeQ}) and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType)",
      pageSize: 100,
      ...(pageToken ? { pageToken } : {}),
    });
    for (const f of res.data.files ?? []) {
      if (f.id && f.name && f.mimeType && !alreadySyncedIds.has(f.id)) {
        results.push({ id: f.id, name: f.name, mimeType: f.mimeType });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  // List subfolders and recurse
  let folderPageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "nextPageToken,files(id,name)",
      pageSize: 100,
      ...(folderPageToken ? { pageToken: folderPageToken } : {}),
    });
    for (const sub of res.data.files ?? []) {
      if (sub.id) {
        await collectFilesRecursively(sub.id, drive, alreadySyncedIds, results, visitedFolders);
      }
    }
    folderPageToken = res.data.nextPageToken ?? undefined;
  } while (folderPageToken);
}

export async function listNewFiles(
  folderId: string,
  accessToken: string,
  alreadySyncedIds: Set<string>,
): Promise<{ id: string; name: string; mimeType: string }[]> {
  const client = getClient();
  client.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: "v3", auth: client });

  const results: { id: string; name: string; mimeType: string }[] = [];
  await collectFilesRecursively(folderId, drive, alreadySyncedIds, results, new Set());
  return results;
}

export async function listFolders(
  parentId: string,
  accessToken: string,
): Promise<{ id: string; name: string }[]> {
  const client = getClient();
  client.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: "v3", auth: client });
  const { data } = await drive.files.list({
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name)",
    orderBy: "name",
    pageSize: 100,
  });
  return (data.files ?? []).filter(
    (f): f is { id: string; name: string } => !!f.id && !!f.name,
  );
}

export async function downloadFile(fileId: string, accessToken: string): Promise<Buffer> {
  const client = getClient();
  client.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: "v3", auth: client });
  const { data } = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(data as ArrayBuffer);
}

// Extracts the folder ID from a Drive URL or returns the raw string if it looks like an ID already
export function parseFolderId(input: string): string | null {
  const urlMatch = input.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (urlMatch) return urlMatch[1];
  const idMatch = input.match(/^[a-zA-Z0-9_-]{15,}$/);
  if (idMatch) return input.trim();
  return null;
}
