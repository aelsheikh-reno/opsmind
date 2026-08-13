// Assertions (task `harness-vitest-legacy-alias`):
//   1. "A legacy module's `@/...` import resolves inside reference/legacy/,
//      never into the new build"
//   2. "The new build's own `@` alias still resolves to the repository root"
//   3. "Coverage measures this build's code, not the legacy oracle it loads"
//
// Why this file exists at all. `reference/legacy/lib/fx.ts:1` is
// `import { prisma } from "@/lib/prisma"`. `@` is aliased to the NEW repository
// root, so a legacy module loaded by the differential harness would import the
// code under test — and the oracle would be comparing the candidate against
// itself. This build's `lib/` is empty today, which is the only reason the bug
// is not yet visible; it goes live and silent the moment `lib/prisma` lands.
//
// The plugin is exercised through the imported config object rather than by
// reading `vitest.config.ts` as text: this test is written from the
// specification, not from the implementation (PIPELINE.md:78-81).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// This import is itself evidence for assertion 2. This file lives in the new
// build, so the plugin must decline for it and the global `@` alias must carry
// it to the repository root. If the plugin fired for every importer, or the
// alias were repointed at the legacy tree, this module would fail to load.
import configExport from "@/vitest.config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const legacyRoot = path.join(repoRoot, "reference", "legacy");

const PLUGIN_NAME = "opsmind:legacy-self-alias";

// ------------------------------------------------------------------- shapes --
// Structural types only. The config module's own type is deliberately not
// relied upon, so this test does not encode how the plugin was declared.

type ResolveIdResult = string | { id?: string } | null | undefined | void;

type ResolveIdHook = (
  this: HookContext,
  source: string,
  importer: string | undefined,
  options?: Record<string, unknown>,
) => ResolveIdResult | Promise<ResolveIdResult>;

interface PluginLike {
  name?: string;
  resolveId?: ResolveIdHook | { handler?: ResolveIdHook };
}

/** Stands in for the subset of the Rollup plugin context the hook may use. */
interface HookContext {
  resolve: Resolver;
  error: (reason: string | { message?: string }) => never;
  warn: (reason: unknown) => void;
}

type Resolver = (
  source: string,
  importer?: string,
  options?: Record<string, unknown>,
) => Promise<{ id: string } | null>;

interface CoverageConfig {
  include?: unknown;
  exclude?: unknown;
}

interface ConfigShape {
  plugins?: unknown;
  resolve?: { alias?: unknown };
  test?: { coverage?: CoverageConfig };
}

// --------------------------------------------------------------- accessors --

/** `defineConfig` accepts an object, a promise or a function of the env. */
async function loadConfig(): Promise<ConfigShape> {
  const exported: unknown = configExport;
  const value =
    typeof exported === "function"
      ? await (exported as (env: { command: string; mode: string }) => unknown)({
          command: "serve",
          mode: "test",
        })
      : await exported;
  expect(value, "vitest.config.ts has no usable default export").toBeTruthy();
  return value as ConfigShape;
}

/** `plugins` may hold nested arrays, promises and falsy entries. */
async function flattenPlugins(value: unknown): Promise<PluginLike[]> {
  const resolved: unknown = await value;
  if (!resolved) return [];
  if (Array.isArray(resolved)) {
    const out: PluginLike[] = [];
    for (const entry of resolved as unknown[]) out.push(...(await flattenPlugins(entry)));
    return out;
  }
  if (typeof resolved === "object") return [resolved as PluginLike];
  return [];
}

async function findPlugin(): Promise<PluginLike> {
  const config = await loadConfig();
  const plugins = await flattenPlugins(config.plugins);
  const found = plugins.find((plugin) => plugin.name === PLUGIN_NAME);
  expect(
    found,
    `no plugin named "${PLUGIN_NAME}" in the config's plugins; found: ${plugins
      .map((plugin) => plugin.name ?? "<unnamed>")
      .join(", ")}`,
  ).toBeDefined();
  return found as PluginLike;
}

/** `resolveId` may be a function or an object hook with a `handler`. */
function hookOf(plugin: PluginLike): ResolveIdHook {
  const hook = plugin.resolveId;
  if (typeof hook === "function") return hook;
  if (hook && typeof hook === "object" && typeof hook.handler === "function") return hook.handler;
  throw new Error(`plugin "${PLUGIN_NAME}" has no resolveId hook`);
}

const passthrough: Resolver = async (id) => ({ id });
const unresolvable: Resolver = async () => null;

function makeContext(resolve: Resolver): HookContext {
  return {
    resolve,
    // Rollup's `this.error` throws; model that so the test does not depend on
    // whether the plugin throws directly or reports through the context.
    error: (reason) => {
      throw new Error(typeof reason === "string" ? reason : (reason?.message ?? String(reason)));
    },
    warn: () => {},
  };
}

function idOf(result: ResolveIdResult): string | null {
  if (result === null || result === undefined) return null;
  if (typeof result === "string") return result;
  return result.id ?? null;
}

/**
 * Calls the hook and normalises the result. Being async, a synchronous throw
 * from the hook surfaces as a rejection, so both styles are assertable.
 */
async function resolveId(
  source: string,
  importer: string | undefined,
  resolver: Resolver = passthrough,
  options: Record<string, unknown> = { isEntry: false },
): Promise<string | null> {
  const plugin = await findPlugin();
  const hook = hookOf(plugin);
  return idOf(await hook.call(makeContext(resolver), source, importer, options));
}

// ---------------------------------------------------------------- fixtures --

// Real files, so an implementation that confirms the counterpart exists on
// disk behaves the same as one that delegates to the resolver.
const legacyImporter = path.join(legacyRoot, "lib", "fx.ts");
const deepLegacyImporter = path.join(legacyRoot, "app", "finances", "petty-cash", "page.tsx");
const newBuildImporter = path.join(repoRoot, "lib", "modules", "payroll", "calculate.ts");
const harnessImporter = path.join(repoRoot, "tests", "differential", "fx.diff.test.ts");

// `reference/legacy/lib/prisma.ts` exists; `reference/legacy/lib/db.ts` does not.
const legacyPrisma = path.join(legacyRoot, "lib", "prisma");
const newBuildPrisma = path.join(repoRoot, "lib", "prisma");

function expectInsideLegacy(resolved: string | null, expectedBase: string): void {
  expect(resolved, "the hook declined instead of redirecting into the legacy tree").not.toBeNull();
  const id = resolved ?? "";
  expect(
    id.startsWith(legacyRoot + path.sep),
    `resolved to ${id}, which is outside ${legacyRoot}`,
  ).toBe(true);
  // an extension may or may not have been appended
  expect(id.startsWith(expectedBase), `resolved to ${id}, expected ${expectedBase}*`).toBe(true);
  expect(
    id.startsWith(path.join(repoRoot, "lib") + path.sep),
    `resolved into the new build at ${id} — the oracle would compare the candidate against itself`,
  ).toBe(false);
}

// ============================================================================
// The plugin is present and reachable
// ============================================================================

describe("the legacy self-alias plugin", () => {
  it(`is exported as a plugin named "${PLUGIN_NAME}"`, async () => {
    const plugin = await findPlugin();
    expect(plugin.name).toBe(PLUGIN_NAME);
  });

  it("exposes a resolveId hook", async () => {
    const plugin = await findPlugin();
    expect(() => hookOf(plugin)).not.toThrow();
  });
});

// ============================================================================
// Assertion 1 — a legacy `@/...` import stays inside reference/legacy/
// ============================================================================

describe("a legacy importer's `@/...` source", () => {
  it("resolves inside reference/legacy/, not into the new build", async () => {
    // the exact line that motivates the task: reference/legacy/lib/fx.ts:1
    const resolved = await resolveId("@/lib/prisma", legacyImporter);
    expectInsideLegacy(resolved, legacyPrisma);
  });

  it("is redirected for a deeply nested legacy importer too", async () => {
    const resolved = await resolveId("@/lib/fx", deepLegacyImporter);
    expectInsideLegacy(resolved, path.join(legacyRoot, "lib", "fx"));
  });

  it("is redirected when it names a nested legacy path", async () => {
    const resolved = await resolveId("@/lib/format-date", legacyImporter);
    expectInsideLegacy(resolved, path.join(legacyRoot, "lib", "format-date"));
  });

  it("is redirected in the post-alias absolute form Vite's alias plugin produces", async () => {
    // Vite's own alias may run first and hand the hook `<repoRoot>/lib/prisma`;
    // the plugin therefore cannot rely on seeing the raw `@/` form.
    const resolved = await resolveId(newBuildPrisma, legacyImporter);
    expectInsideLegacy(resolved, legacyPrisma);
  });
});

// ============================================================================
// Assertion 1 — the hook fires only for legacy importers
// ============================================================================

describe("the hook declines", () => {
  it("when there is no importer (an entry point)", async () => {
    expect(await resolveId("@/lib/prisma", undefined)).toBeNull();
  });

  it("for an importer in the new build's lib/", async () => {
    expect(await resolveId("@/lib/prisma", newBuildImporter)).toBeNull();
  });

  it("for the differential harness itself, which is new-build code", async () => {
    expect(await resolveId("@/lib/prisma", harnessImporter)).toBeNull();
  });

  it("for a sibling directory that merely shares the prefix", async () => {
    // `reference/legacy-sneaky/` is not inside `reference/legacy/`; the check
    // is a directory boundary, not a string prefix.
    const sneaky = path.join(repoRoot, "reference", "legacy-sneaky", "foo.ts");
    expect(await resolveId("@/lib/prisma", sneaky)).toBeNull();
  });

  it("for a file whose name merely shares the prefix", async () => {
    const sibling = path.join(repoRoot, "reference", "legacy-notes.ts");
    expect(await resolveId("@/lib/prisma", sibling)).toBeNull();
  });
});

// ============================================================================
// Assertion 1 — shared and relative things are left alone
// ============================================================================

describe("from a legacy importer the hook leaves alone", () => {
  it.each(["zod", "next/server", "react", "node:path"])(
    "the bare package specifier %s",
    async (source) => {
      expect(await resolveId(source, legacyImporter)).toBeNull();
    },
  );

  it("the scoped package `@prisma/client`, which is not the `@/` alias", async () => {
    // both sides of a differential test share third-party code; it is not the
    // code under test, and `@prisma/` must not be mistaken for `@/`
    expect(await resolveId("@prisma/client", legacyImporter)).toBeNull();
  });

  it.each(["./tax", "../lib/vat", "../../lib/prisma"])(
    "the relative specifier %s",
    async (source) => {
      expect(await resolveId(source, legacyImporter)).toBeNull();
    },
  );

  it("a source already inside reference/legacy/", async () => {
    expect(await resolveId(path.join(legacyRoot, "lib", "prisma.ts"), legacyImporter)).toBeNull();
  });

  it("a source elsewhere under reference/", async () => {
    expect(await resolveId(path.join(repoRoot, "reference", "notes.ts"), legacyImporter)).toBeNull();
  });

  it("a source under node_modules/", async () => {
    const dep = path.join(repoRoot, "node_modules", "zod", "index.js");
    expect(await resolveId(dep, legacyImporter)).toBeNull();
  });

  it("a legacy dependency nested under node_modules/", async () => {
    const dep = path.join(legacyRoot, "node_modules", "zod", "index.js");
    expect(await resolveId(dep, legacyImporter)).toBeNull();
  });
});

// ============================================================================
// Assertion 1 — refusing rather than falling through
// ============================================================================

describe("when a legacy `@/...` import has no counterpart in reference/legacy/", () => {
  // `unresolvable` covers an implementation that asks the resolver; the paths
  // below genuinely do not exist, covering one that checks the filesystem.
  const missing = "@/lib/no-such-legacy-module";

  it("throws instead of returning null", async () => {
    // returning null would let resolution fall through to the global `@` alias
    // and reach the new build — the exact contamination being prevented
    await expect(resolveId(missing, legacyImporter, unresolvable)).rejects.toThrow();
  });

  it("names the importer and the source in the error", async () => {
    let message = "";
    try {
      await resolveId(missing, legacyImporter, unresolvable);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message, "the hook did not throw").not.toBe("");
    expect(message, `error did not name the source: ${message}`).toContain(missing);
    expect(message, `error did not name the importer: ${message}`).toContain(legacyImporter);
  });

  it("throws for the post-alias absolute form as well", async () => {
    // same logical import, already rewritten by Vite's alias plugin; declining
    // here would resolve it in the new build just the same
    const absent = path.join(repoRoot, "lib", "no-such-legacy-module");
    await expect(resolveId(absent, legacyImporter, unresolvable)).rejects.toThrow();
  });

  it("still redirects an import that does have a counterpart", async () => {
    // guards against a plugin that throws for everything
    expectInsideLegacy(await resolveId("@/lib/tax", legacyImporter), path.join(legacyRoot, "lib", "tax"));
  });
});

// ============================================================================
// Assertion 1 — the rewrite cannot recurse
// ============================================================================

describe("resolution of the rewritten target", () => {
  it("terminates rather than re-entering the hook in a loop", async () => {
    let depth = 0;
    const reentrant: Resolver = async (id, importer, options) => {
      // Vite skips the calling plugin when it asks for skipSelf; a plugin that
      // does not ask gets handed its own hook again, which is the loop risk.
      if (options?.skipSelf === true) return { id };
      depth += 1;
      if (depth > 8) throw new Error(`resolveId recursed ${depth} deep on ${id}`);
      try {
        const nested = await resolveId(id, importer ?? legacyImporter, reentrant);
        return { id: nested ?? id };
      } finally {
        depth -= 1;
      }
    };

    const resolved = await resolveId("@/lib/prisma", legacyImporter, reentrant);
    expectInsideLegacy(resolved, legacyPrisma);
  });
});

// ============================================================================
// Assertion 2 — the new build's own `@` alias still points at the repo root
// ============================================================================

/** Applies the config's alias table to a source the way Vite's alias plugin would. */
function applyAlias(aliases: unknown, source: string): string | null {
  if (!aliases) return null;
  if (Array.isArray(aliases)) {
    for (const entry of aliases as Array<{ find?: unknown; replacement?: unknown }>) {
      const { find, replacement } = entry;
      if (typeof replacement !== "string") continue;
      if (typeof find === "string" && source.startsWith(find)) {
        return path.normalize(replacement + source.slice(find.length));
      }
      if (find instanceof RegExp && find.test(source)) {
        return path.normalize(source.replace(find, replacement));
      }
    }
    return null;
  }
  if (typeof aliases === "object") {
    for (const [find, replacement] of Object.entries(aliases as Record<string, unknown>)) {
      if (typeof replacement === "string" && source.startsWith(find)) {
        return path.normalize(replacement + source.slice(find.length));
      }
    }
  }
  return null;
}

describe("the new build's `@` alias", () => {
  it("resolves to the repository root", async () => {
    const config = await loadConfig();
    const resolved = applyAlias(config.resolve?.alias, "@/lib/modules/payroll");
    expect(resolved, "no `@` alias is configured").not.toBeNull();
    expect(resolved).toBe(path.join(repoRoot, "lib", "modules", "payroll"));
  });

  it("is not repointed at the legacy tree", async () => {
    const config = await loadConfig();
    const resolved = applyAlias(config.resolve?.alias, "@/lib/prisma") ?? "";
    expect(
      resolved.startsWith(legacyRoot),
      `the global alias sends new-build code to ${resolved}`,
    ).toBe(false);
  });

  it("carries a new-build module import to the repository root", () => {
    // this file imported `@/vitest.config` and got the repo root's config
    expect(configExport, "`@/vitest.config` did not load from the repository root").toBeTruthy();
  });
});

// ============================================================================
// Assertion 3 — coverage measures this build, not the oracle
// ============================================================================

function asPatterns(value: unknown, label: string): string[] {
  expect(Array.isArray(value), `coverage.${label} is not an array`).toBe(true);
  return (value as unknown[]).filter((entry): entry is string => typeof entry === "string");
}

/**
 * The subset of glob syntax coverage patterns use. Matching on behaviour keeps
 * these assertions about which files get measured rather than about one
 * particular spelling of an equivalent pattern.
 */
function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern.charAt(i);
    if (char === "*") {
      if (pattern.charAt(i + 1) === "*") {
        if (pattern.charAt(i + 2) === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (char === "?") out += "[^/]";
    else if (char === "{") out += "(?:";
    else if (char === "}") out += ")";
    else if (char === ",") out += "|";
    else out += char.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

function matches(patterns: string[], file: string): string | undefined {
  return patterns.find((pattern) => globToRegExp(pattern).test(file));
}

async function coverage(): Promise<{ include: string[]; exclude: string[] }> {
  const config = await loadConfig();
  return {
    include: asPatterns(config.test?.coverage?.include, "include"),
    exclude: asPatterns(config.test?.coverage?.exclude, "exclude"),
  };
}

describe("coverage configuration", () => {
  it("excludes the legacy oracle", async () => {
    const { exclude } = await coverage();
    // the legacy tree is loaded by the harness but is not this build's code,
    // so grading it would move the coverage gate for reasons unrelated to work
    expect(exclude).toContain("**/reference/**");
  });

  it.each([
    "reference/legacy/lib/fx.ts",
    "reference/legacy/app/finances/petty-cash/page.tsx",
  ])("does not measure the oracle file %s", async (file) => {
    const { include, exclude } = await coverage();
    expect(
      matches(exclude, file) ?? (matches(include, file) ? undefined : "not included"),
      `${file} would be graded as this build's code`,
    ).toBeDefined();
  });

  it("includes the differential harness implementation", async () => {
    const { include, exclude } = await coverage();
    const harness = "tests/differential/fx-harness.ts";
    expect(matches(include, harness), `no include pattern covers ${harness}`).toBeDefined();
    expect(
      matches(exclude, harness),
      `${harness} is excluded from measurement by that pattern`,
    ).toBeUndefined();
  });

  it.each([
    "tests/config/legacy-alias.test.ts",
    "tests/differential/fx.diff.test.ts",
    "lib/modules/payroll/calculate.test.ts",
  ])("excludes the test file %s from measurement", async (file) => {
    const { exclude } = await coverage();
    // test files are the measuring instrument, not the thing measured
    expect(matches(exclude, file), `no exclude pattern covers ${file}`).toBeDefined();
  });

  it("never points an include pattern into reference/", async () => {
    const config = await loadConfig();
    const include = asPatterns(config.test?.coverage?.include, "include");
    for (const pattern of include) {
      expect(pattern, `coverage.include measures the oracle: ${pattern}`).not.toContain("reference");
    }
  });
});
