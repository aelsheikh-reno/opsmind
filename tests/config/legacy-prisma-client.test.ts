// The oracle must reach the LEGACY database schema, not this build's.
//
// Legacy code reaches the database through the generated client package, and
// that package name resolves to whichever client was generated last — which is
// this build's, from this build's schema. reference/legacy/lib/fx.ts reads
// `prisma.setting` and `prisma.payrollRun`; neither exists on the new client. A
// shared client therefore makes the oracle answer about the wrong database, or
// throw, and the differential test it feeds proves nothing.
//
// It hid while the new schema had no models: with nothing to generate the
// import failed outright, so the harness's own "must throw" guard passed for the
// wrong reason. kernel-schema-base added the first models and it surfaced.
//
// These assert on resolution rather than on the new client's model list,
// because on a branch whose schema has no models `prisma generate` cannot run
// at all and the new client is not importable. Resolution is the invariant and
// it holds either way. Once a schema with models is on main, the stronger
// "no legacy model is visible on the new client" check becomes assertable too.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadLegacyModule } from "@/tests/differential/harness";

const rootDir = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const legacyClientDir = path.join(rootDir, "generated/legacy-prisma-client");

const modelsOf = (client: object): string[] =>
  Object.keys(client).filter((key) => !key.startsWith("$") && !key.startsWith("_"));

describe("the legacy oracle resolves the legacy client", () => {
  it("a legacy module reaching the client gets the legacy schema's models", async () => {
    // Loaded the way the harness loads an oracle — dynamically, by path. A
    // static import would drag legacy TypeScript into this build's type
    // program, where its own "@/..." imports do not resolve.
    const shim = await loadLegacyModule("lib/prisma.ts");
    const models = modelsOf(shim.prisma as object);
    // The legacy schema declares 38 models. Pinned as an exact count so that
    // silently resolving some other client cannot pass this.
    expect(models.length, `legacy client exposes ${models.length} models`).toBe(38);
    for (const model of ["setting", "payrollRun", "vatConfig", "taxConfig"]) {
      expect(models, `the legacy client is missing ${model}`).toContain(model);
    }
  });

  it("those models are declared by the legacy schema and not by this build's", () => {
    // Reading both schemas, so this says something even before the new client
    // can be generated. If this build ever legitimately grows a `Setting`, this
    // fails and asks for a different discriminator rather than rotting quietly.
    const declared = (schemaPath: string): Set<string> =>
      new Set(
        [...readFileSync(schemaPath, "utf8").matchAll(/^\s*model\s+(\w+)/gm)].map((m) =>
          m[1].toLowerCase(),
        ),
      );
    const legacy = declared(path.join(rootDir, "reference/legacy/prisma/schema.prisma"));
    const current = declared(path.join(rootDir, "prisma/schema.prisma"));

    expect(legacy.size, "legacy schema should declare 38 models").toBe(38);
    for (const model of ["setting", "payrollrun", "vatconfig", "taxconfig"]) {
      expect(legacy.has(model), `legacy schema is missing ${model}`).toBe(true);
      expect(current.has(model), `this build's schema unexpectedly declares ${model}`).toBe(false);
    }
  });

  it("the new build does not resolve the legacy client", () => {
    // A new-build importer — this test file is one — must land on the shared
    // package, never inside generated/legacy-prisma-client. This holds whether
    // or not the new client has been generated, because the package itself is
    // installed either way.
    const resolved = createRequire(import.meta.url).resolve("@prisma/client");
    expect(resolved.startsWith(legacyClientDir), `new build resolved to ${resolved}`).toBe(false);
    expect(resolved).toContain("node_modules");
  });
});

describe("fx.ts works as an oracle", () => {
  // fx.ts is the reason this task exists: it is a money oracle (FX conversion)
  // and it was the module the harness guard caught loading against the wrong
  // client. Loading is not enough — it has to compute.
  it("loads through loadLegacyModule and computes", async () => {
    const fx = await loadLegacyModule("lib/fx.ts");
    const toUSD = fx.toUSD as (a: number, c: string, r: Record<string, number>) => number;
    const parseSnapshot = fx.parseSnapshot as (s: string | null) => Record<string, number> | null;

    expect(typeof fx.getUsdRates, "fx.ts must export its rate reader").toBe("function");
    expect(toUSD(367, "AED", { AED: 3.67 })).toBeCloseTo(100, 6);
    expect(toUSD(100, "USD", {})).toBe(100);
    expect(parseSnapshot('{"AED":3.67}')).toEqual({ AED: 3.67 });
    expect(parseSnapshot(null)).toBeNull();
  });
});
