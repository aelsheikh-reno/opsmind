import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";

const LOCAL_UPLOAD_DIR = path.join(process.cwd(), "uploads");
const IS_LOCAL = process.env.NODE_ENV !== "production";

// ── Local filesystem (development) ───────────────────────────────────────────

async function localUpload(key: string, buffer: Buffer): Promise<string> {
  const dest = path.join(LOCAL_UPLOAD_DIR, key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buffer);
  return key;
}

async function localDownload(key: string): Promise<Buffer> {
  return fs.readFile(path.join(LOCAL_UPLOAD_DIR, key));
}

// ── S3 (production) ───────────────────────────────────────────────────────────

function getS3Client() {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const region      = process.env.S3_REGION?.trim();
  const bucket      = process.env.S3_BUCKET_NAME?.trim();

  // S3_SECRET_B64 is base64-encoded to survive + → space corruption in env var UIs
  const secretAccessKey = process.env.S3_SECRET_B64
    ? Buffer.from(process.env.S3_SECRET_B64.trim(), "base64").toString("utf8")
    : process.env.S3_SECRET_ACCESS_KEY?.trim();

  if (!accessKeyId || !secretAccessKey || !region || !bucket) {
    throw new Error(`Missing S3 env vars — keyId:${!!accessKeyId} secret:${!!secretAccessKey} region:${!!region} bucket:${!!bucket}`);
  }

  return new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
}

const BUCKET = () => process.env.S3_BUCKET_NAME!;

// ── Public API ────────────────────────────────────────────────────────────────

export async function uploadFile(key: string, buffer: Buffer, contentType: string): Promise<string> {
  if (IS_LOCAL) return localUpload(key, buffer);

  await getS3Client().send(new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return key;
}

export async function downloadFile(key: string): Promise<Buffer> {
  if (IS_LOCAL) return localDownload(key);

  const res = await getS3Client().send(new GetObjectCommand({
    Bucket: BUCKET(),
    Key: key,
  }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function deleteFile(key: string): Promise<void> {
  if (IS_LOCAL) {
    await fs.unlink(path.join(LOCAL_UPLOAD_DIR, key)).catch(() => {});
    return;
  }
  await getS3Client().send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }));
}
