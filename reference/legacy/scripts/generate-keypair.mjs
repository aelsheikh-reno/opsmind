#!/usr/bin/env node
/**
 * Run ONCE to create your RSA signing key pair.
 * Keep license-private.pem SECRET — never commit it.
 * Add LICENSE_PUBLIC_KEY to every client's Vercel env vars.
 *
 * Usage: node scripts/generate-keypair.mjs
 */

import { generateKeyPairSync } from "crypto";
import { writeFileSync, existsSync } from "fs";

if (existsSync("license-private.pem")) {
  console.error("license-private.pem already exists. Delete it first if you really want a new pair.");
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding:  { type: "spki",  format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

writeFileSync("license-private.pem", privateKey, { mode: 0o600 });

console.log("✓ Private key saved to license-private.pem  (KEEP THIS FILE SECRET)\n");
const escaped = publicKey.trimEnd().replace(/\n/g, "\\n");

console.log("Copy the line below exactly into Vercel (or .env.local) as LICENSE_PUBLIC_KEY:");
console.log("──────────────────────────────────────────────────────────────────────────");
console.log(`LICENSE_PUBLIC_KEY=${escaped}`);
console.log("──────────────────────────────────────────────────────────────────────────");
console.log("\nThe value already includes -----BEGIN/END PUBLIC KEY----- markers.");
console.log("Paste the entire LICENSE_PUBLIC_KEY=... line — do not strip the headers.");
