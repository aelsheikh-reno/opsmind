#!/usr/bin/env node
// Generate a SECOND Prisma client, from the legacy schema, to its own output.
//
// The differential oracle is legacy code, and legacy code reaches the database
// through the generated client package. That package name resolves to whichever
// client was generated last, and `prisma generate` in this build generates from
// THIS build's schema — so from the moment the new schema grew its first model,
// a legacy oracle loaded by the harness bound to a client that does not have the
// legacy tables. `reference/legacy/lib/fx.ts` asks for `prisma.setting` and
// `prisma.payrollRun`; neither exists on the new client. The oracle stops being
// an oracle, and the differential test it feeds compares the candidate against
// something broken — the exact green-but-meaningless gate PIPELINE.md says the
// harness exists to prevent.
//
// vitest.config.ts aliases the client package to the output of this script, but
// only for importers under reference/legacy/. The new build's own client is
// untouched: same package name, different resolution, decided by who is asking.
//
// This script lives under prisma/ rather than scripts/ because it is Prisma
// tooling and must name the client package. guard-write.sh blocks that name
// outside repository.ts, prisma/ and tests/, and its own comment says the only
// way past otherwise is to split the string — "a guard that can only be
// satisfied by obfuscating around it teaches exactly the habit it exists to
// prevent". prisma/ is the honest home, not a dodge around the rule.
//
// reference/legacy/ is read-only — CLAUDE.md, and a write guard enforces it —
// so the legacy schema cannot simply gain an `output` on its generator. Its text
// is copied to a generated location and the output path added there. The legacy
// schema itself is only ever read.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const legacySchema = path.join(root, "reference/legacy/prisma/schema.prisma");
const outDir = path.join(root, "generated/legacy-prisma-client");
const derivedSchema = path.join(root, "generated/legacy-schema.prisma");

const source = readFileSync(legacySchema, "utf8");

// Anchored to the `generator <name> {` header so a `provider` line elsewhere in
// the file cannot be rewritten by accident.
const generatorHeader = /generator\s+\w+\s*\{/;
if (!generatorHeader.test(source)) {
  throw new Error(`${legacySchema} has no generator block — refusing to guess where the client goes`);
}
if (/^\s*output\s*=/m.test(source)) {
  throw new Error(
    `${legacySchema} already sets an output path. It is read-only and was not expected to; ` +
      "resolve this by hand rather than letting this script fight it.",
  );
}

const derived =
  "// GENERATED — do not edit. Produced by prisma/generate-legacy-client.mjs from\n" +
  "// reference/legacy/prisma/schema.prisma, which is read-only.\n" +
  source.replace(generatorHeader, (header) => `${header}\n  output = ${JSON.stringify(outDir)}`);

mkdirSync(path.dirname(derivedSchema), { recursive: true });
writeFileSync(derivedSchema, derived);

// `prisma generate` validates the datasource block, which reads env even though
// generating needs no connection. A placeholder keeps this runnable on a machine
// with no database; nothing ever connects with it.
const env = { ...process.env };
env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";

execFileSync("npx", ["prisma", "generate", "--schema", derivedSchema], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

process.stdout.write(`legacy prisma client generated -> ${path.relative(root, outDir)}\n`);
