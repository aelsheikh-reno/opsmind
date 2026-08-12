#!/usr/bin/env node
/**
 * Issue a time-limited LICENSE_KEY JWT for a client.
 * Run this each billing cycle and paste the output into the client's Vercel env vars.
 *
 * Usage:
 *   node scripts/issue-license.mjs --client=acme-corp --months=1
 *   node scripts/issue-license.mjs --client=acme-corp --months=3
 *
 * Reads the private key from:
 *   1. LICENSE_PRIVATE_KEY env var (for CI/automated renewal)
 *   2. ./license-private.pem file (local default)
 */

import { readFileSync } from "fs";
import { importPKCS8, SignJWT } from "jose";

// Parse --key=value args
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const eq = a.indexOf("=");
    const k  = a.slice(2, eq);
    const v  = a.slice(eq + 1);
    return [k, v];
  })
);

const clientId = args.client;
const months   = args.months ? parseInt(args.months, 10) : null;
const days     = args.days   ? parseInt(args.days, 10)   : null;

if (!clientId || (months === null && days === null)) {
  console.error("Usage: node scripts/issue-license.mjs --client=acme-corp --months=1");
  console.error("       node scripts/issue-license.mjs --client=test --days=-1   # already expired");
  process.exit(1);
}

// Load private key
let privateKeyPem;
if (process.env.LICENSE_PRIVATE_KEY) {
  privateKeyPem = process.env.LICENSE_PRIVATE_KEY.replace(/\\n/g, "\n");
} else {
  try {
    privateKeyPem = readFileSync("license-private.pem", "utf8");
  } catch {
    console.error("No private key found. Run scripts/generate-keypair.mjs first.");
    process.exit(1);
  }
}

const privateKey = await importPKCS8(privateKeyPem, "RS256");

const now       = new Date();
const expiresAt = new Date(now);
if (days !== null) {
  expiresAt.setDate(expiresAt.getDate() + days);
} else {
  expiresAt.setMonth(expiresAt.getMonth() + months);
}

const durationLabel = days !== null
  ? `${days} day${Math.abs(days) !== 1 ? "s" : ""}`
  : `${months} month${months > 1 ? "s" : ""}`;

const token = await new SignJWT({ clientId })
  .setProtectedHeader({ alg: "RS256" })
  .setSubject(clientId)
  .setIssuedAt()
  .setExpirationTime(expiresAt)
  .sign(privateKey);

console.log("\n══════════════════════════════════════════════════════");
console.log(`  Client  : ${clientId}`);
console.log(`  Issued  : ${now.toISOString().split("T")[0]}`);
console.log(`  Expires : ${expiresAt.toISOString().split("T")[0]}  (${durationLabel})`);
console.log("══════════════════════════════════════════════════════");
console.log("\nSet this in the client's Vercel project → Settings → Environment Variables:\n");
console.log(`LICENSE_KEY=${token}`);
console.log();
