// Assertion: "eslint.config.mjs contains the three boundary rule blocks from
// templates/"
//
// templates/eslint.config.mjs is the source of truth, so the expectations are
// taken from it at runtime rather than restated here. Restating fragments lets
// someone soften a rule and quietly update the test to match; comparing against
// the template does not. Both configs are loaded as modules, so the comparison
// is on the resolved rule objects and survives reformatting while still failing
// on any change of substance.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const templatePath = path.join(repoRoot, "templates", "eslint.config.mjs");
const projectPath = path.join(repoRoot, "eslint.config.mjs");

const BOUNDARY_RULE = "no-restricted-imports";

// WHAT THE LOAD COSTS, AND WHY THE BOUND BELOW IS WHERE IT IS.
//
// This is not a budget the hook overran. It is a measurement, and the number is
// deliberately far above it.
//
// Loading templates/eslint.config.mjs evaluates eslint-config-next, which pulls
// the whole typescript-eslint graph. Measured on a 14-core machine
// (`nproc` = 14), wall clock for the beforeAll below:
//
//   this file alone, machine idle           1.11 - 1.17 s
//   full suite (23 files), machine idle     6.34 - 7.21 s
//   full suite, 12 background CPU hogs     11.6  - 16.8  s
//
// The work itself is ~1.2 s and does not grow. Everything above that is
// contention: the SECOND config load costs 8-44 ms, because Node has the graph
// cached by then. So what these figures measure is one module graph evaluated
// while up to twelve sibling vitest workers transform their own files.
//
// The old bound was vitest's default hookTimeout of 10 s — that is, no bound was
// ever chosen for this hook. It sat 1.4x above the idle full-suite cost, so any
// load at all pushed a run past it and the suite went red on a file nobody had
// touched. A false red is the same class of defect as a false green: the verdict
// stops describing the subject, and everyone learns to retry instead of read.
//
// So the bound is set from what a timeout here should actually catch: an import
// that is stuck or broken, never a machine that is busy. 120 s is ~100x the
// 1.2 s the work costs alone and ~7x the worst figure measured under deliberate
// saturation. A hang still fails, and fails within two minutes. Contention does
// not.
//
// Raise this only with a fresh measurement written beside it. Lowering it back
// toward the observed cost re-creates the defect.
const CONFIG_LOAD_BUDGET_MS = 120_000;

// Vitest's own hook timeout is held above our deadline on purpose. Whichever
// fires first writes the failure message, and vitest's is the bare
// "Hook timed out in 10000ms" that started this — it names a duration and not a
// subject. Leaving margin means the labelled message below is the one a red CI
// run shows. The global hookTimeout in vitest.config.ts is deliberately NOT
// raised to match: every other hook in the suite keeps the tight default,
// because a bound widened repository-wide would hide a real hang somewhere that
// has no comment like this one saying what its work costs.
const HOOK_TIMEOUT_MS = CONFIG_LOAD_BUDGET_MS + 30_000;

interface FlatEntry {
  files?: unknown;
  rules?: Record<string, unknown>;
}

function isBoundaryBlock(entry: unknown): entry is FlatEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const { rules } = entry as { rules?: unknown };
  if (typeof rules !== "object" || rules === null) return false;
  return Object.prototype.hasOwnProperty.call(rules, BOUNDARY_RULE);
}

// An ignore is a rule switched off for a path, and it is switched off for EVERY
// rule at once — which makes the global ignore list the cheapest way to defeat
// the comparison below. `globalIgnores(["lib/**"])` in eslint.config.mjs
// disables the whole enforcement layer for the code it exists to enforce, and
// nothing caught it: this file passed 7/7 with it in place, and
// check-boundaries.sh exited 0, because the boundary blocks were all still there
// and still identical to the template. They were simply no longer applied to
// anything.
//
// That hole predates the .claude/worktrees/** entry, but adding to the list is
// what surfaced it, so the list is now compared too. The project may hold
// ignores the template does not — it has its own generated output — but each one
// has to be named here, next to the reason, where a reviewer reads it. An ignore
// added to hide a rule fails this test; a legitimate one costs a line and an
// argument. Dropping a template ignore fails as well: losing reference/** would
// put the read-only legacy tree back under the gate's lint.
const ALLOWED_EXTRA_IGNORES = new Map([
  [
    "generated/**",
    "the Prisma client built from the legacy schema by prisma/generate-legacy-client.mjs — " +
      "generator output, never authored, never committed",
  ],
]);

/** Patterns ignored for every rule: an entry carrying `ignores` and no `files`. */
function globalIgnorePatterns(config: unknown[]): Set<string> {
  const patterns = new Set<string>();
  for (const entry of config) {
    if (typeof entry !== "object" || entry === null) continue;
    const { files, ignores } = entry as { files?: unknown; ignores?: unknown };
    if (files !== undefined || !Array.isArray(ignores)) continue;
    for (const pattern of ignores) if (typeof pattern === "string") patterns.add(pattern);
  }
  return patterns;
}

function isOff(setting: unknown): boolean {
  const severity = Array.isArray(setting) ? (setting as unknown[])[0] : setting;
  return severity === "off" || severity === 0;
}

/**
 * Runs `work` under a named deadline.
 *
 * A hook that exceeds its bound must fail saying what it was doing. Vitest's
 * generic timeout cannot: it reports a duration, so someone reading a red run
 * learns that ten seconds passed and nothing about which ten seconds. Both
 * failure exits from here carry the label instead — the deadline, and any error
 * the work itself throws — so the failure names the file being loaded and why
 * that load is expensive. The original error is preserved as `cause` rather than
 * replaced, because the module resolution message underneath is the one an
 * operator acts on.
 *
 * Exported for the tests at the bottom of this file, which drive both exits
 * deterministically rather than by waiting for a slow machine.
 */
export async function withDeadline<T>(
  label: string,
  budgetMs: number,
  work: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} did not finish within ${budgetMs}ms`));
    }, budgetMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([work(), deadline]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed: ${message}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

async function loadFlatConfig(file: string): Promise<unknown[]> {
  const relative = path.relative(repoRoot, file);
  const loaded = await withDeadline(
    `loading the eslint flat config ${relative} — this import evaluates ` +
      "eslint-config-next and the whole typescript-eslint graph, about 1.2s of " +
      "work on an idle machine",
    CONFIG_LOAD_BUDGET_MS,
    async (): Promise<{ default?: unknown }> => import(pathToFileURL(file).href),
  );
  const config = loaded.default;
  return Array.isArray(config) ? (config as unknown[]) : [];
}

let templateConfig: unknown[] = [];
let templateBlocks: FlatEntry[] = [];
let projectConfig: unknown[] = [];
let projectBlocks: FlatEntry[] = [];

beforeAll(async () => {
  templateConfig = await loadFlatConfig(templatePath);
  templateBlocks = templateConfig.filter(isBoundaryBlock);
  projectConfig = await loadFlatConfig(projectPath);
  projectBlocks = projectConfig.filter(isBoundaryBlock);
}, HOOK_TIMEOUT_MS);

describe("eslint boundary rules", () => {
  it("the template still carries exactly three boundary blocks", () => {
    // guards the comparison below: if the template changes shape, the rest of
    // this file must be re-read rather than silently checking nothing
    expect(templateBlocks).toHaveLength(3);
  });

  it("eslint.config.mjs loads as a non-empty flat config array", () => {
    expect(projectConfig.length).toBeGreaterThan(0);
  });

  it("carries every boundary block from templates/eslint.config.mjs, unweakened", () => {
    expect(templateBlocks).toHaveLength(3);
    templateBlocks.forEach((template, index) => {
      const key = JSON.stringify(template.files);
      const match = projectBlocks.find((block) => JSON.stringify(block.files) === key);
      expect(
        match,
        `eslint.config.mjs has no ${BOUNDARY_RULE} block for files ${key} (template block ${index + 1})`,
      ).toBeDefined();
      expect(
        match?.rules?.[BOUNDARY_RULE],
        `block ${index + 1} (files ${key}) differs from templates/eslint.config.mjs`,
      ).toEqual(template.rules?.[BOUNDARY_RULE]);
    });
  });

  it("turns the boundary rule off only where the template turns it off", () => {
    const allowedExceptions = templateBlocks
      .filter((block) => isOff(block.rules?.[BOUNDARY_RULE]))
      .map((block) => JSON.stringify(block.files));
    // repositories and prisma tooling are the one exception; a wider `off`
    // block anywhere else disables the whole enforcement layer
    expect(allowedExceptions.length).toBeGreaterThan(0);
    const projectExceptions = projectBlocks
      .filter((block) => isOff(block.rules?.[BOUNDARY_RULE]))
      .map((block) => JSON.stringify(block.files));
    for (const exception of projectExceptions) {
      expect(
        allowedExceptions,
        `eslint.config.mjs disables ${BOUNDARY_RULE} for ${exception}, which the template does not`,
      ).toContain(exception);
    }
  });
});

describe("eslint global ignores", () => {
  it("still ignores everything templates/eslint.config.mjs ignores", () => {
    const template = globalIgnorePatterns(templateConfig);
    const project = globalIgnorePatterns(projectConfig);
    expect(template.size).toBeGreaterThan(0);
    for (const pattern of template) {
      expect(
        [...project],
        `templates/eslint.config.mjs ignores ${pattern} and eslint.config.mjs no longer does`,
      ).toContain(pattern);
    }
  });

  it("adds no ignore of its own that is not named and argued for above", () => {
    const template = globalIgnorePatterns(templateConfig);
    const extras = [...globalIgnorePatterns(projectConfig)].filter((p) => !template.has(p));
    for (const pattern of extras) {
      expect(
        [...ALLOWED_EXTRA_IGNORES.keys()],
        `eslint.config.mjs ignores ${pattern}, which templates/eslint.config.mjs does not. ` +
          "An ignore switches off every rule for that path, including the boundary rules " +
          "this file compares — so it is a softening. Add it to ALLOWED_EXTRA_IGNORES with " +
          "a reason, or take it out.",
      ).toContain(pattern);
    }
  });
});

describe("the config load says what it was doing when it fails", () => {
  // Driven with a 1 ms deadline and a promise that never settles, so the message
  // is asserted without depending on how busy the machine is. Proving it by
  // actually exhausting CONFIG_LOAD_BUDGET_MS would make this file take two
  // minutes to check a string, which is the cost this node exists to remove.
  const label = "loading the eslint flat config templates/eslint.config.mjs";

  it("names the work in the deadline message, never a bare timeout", async () => {
    await expect(withDeadline(label, 1, () => new Promise<never>(() => {}))).rejects.toThrow(
      `${label} did not finish within 1ms`,
    );
  }, 30_000);

  it("names the work when the load itself throws, and keeps the original as cause", async () => {
    const original = new Error("Cannot find package 'eslint-config-next'");
    await expect(withDeadline(label, 30_000, () => Promise.reject(original))).rejects.toThrow(
      `${label} failed: Cannot find package 'eslint-config-next'`,
    );
    await expect(withDeadline(label, 30_000, () => Promise.reject(original))).rejects.toHaveProperty(
      "cause",
      original,
    );
  });

  it("returns the loaded config untouched when the work finishes inside the bound", async () => {
    await expect(withDeadline(label, 30_000, async () => ["a block"])).resolves.toEqual([
      "a block",
    ]);
  });
});
