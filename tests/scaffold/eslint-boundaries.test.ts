// Assertion: "eslint.config.mjs contains the three boundary rule blocks from
// templates/"
//
// templates/eslint.config.mjs is the source of truth, so the expectations are
// taken from it at runtime rather than restated here. Restating fragments lets
// someone soften a rule and quietly update the test to match; comparing against
// the template does not. Both configs are loaded as modules, so the comparison
// is on the resolved rule objects and survives reformatting while still failing
// on any change of substance.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ESLint } from "eslint";
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
  ignores?: unknown;
  rules?: Record<string, unknown>;
}

function isBoundaryBlock(entry: unknown): entry is FlatEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const { rules } = entry as { rules?: unknown };
  if (typeof rules !== "object" || rules === null) return false;
  return Object.prototype.hasOwnProperty.call(rules, BOUNDARY_RULE);
}

// An ignore is a rule switched off for a path, and a GLOBAL ignore switches off
// every rule at once — which makes the global ignore list one of the two
// cheapest ways to defeat the comparison below. (The other is an `ignores` on a
// boundary block itself; see ALLOWED_BLOCK_IGNORES.)
// `globalIgnores(["lib/**"])` in eslint.config.mjs
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

// THE SAME SOFTENING, ONE BLOCK DOWN.
//
// `globalIgnorePatterns` below collects only entries that carry no `files` key,
// because that is what makes an ignore global. An `ignores` written INSIDE a
// boundary block is therefore not collected by it — and the block comparison
// read `files` and `rules` and never `ignores`. So one line, `ignores:
// ["lib/**"]`, added to the block at eslint.config.mjs:33 passed this file 9/9,
// left scripts/check-boundaries.sh exiting 0, and took a planted
// lib/_probe/probe.ts carrying both a deep module import and `@/lib/db` from 2
// errors to 0. That is the whole enforcement layer off for lib/ — the outcome
// the global-ignore comparison exists to prevent, at the same price and just as
// invisible. Block ignores are now compared the way `files` and `rules` are.
//
// Keyed by the block's `files` and then the pattern, so an exception is granted
// to one block rather than to a pattern everywhere. Empty on purpose: no
// boundary block in either config carries an `ignores` today, and a boundary
// rule that needs a path carved out of it should say so in its `group`
// patterns, where the carve-out is readable in the rule itself rather than in a
// key that silently removes the rule from a tree. Like ALLOWED_EXTRA_IGNORES
// this is a list a task can append to, and it is defensible for the same
// reason: the addition lands in the diff with its reason attached.
const ALLOWED_BLOCK_IGNORES = new Map<string, string>();

/** The key an entry in ALLOWED_BLOCK_IGNORES is written under. */
function blockIgnoreKey(files: unknown, pattern: string): string {
  return `${JSON.stringify(files)} ignores ${pattern}`;
}

/** Patterns this one block's rules skip: its own `ignores`, not a global one. */
function blockIgnorePatterns(entry: FlatEntry | undefined): Set<string> {
  const patterns = new Set<string>();
  const ignores = entry?.ignores;
  if (!Array.isArray(ignores)) return patterns;
  for (const pattern of ignores) if (typeof pattern === "string") patterns.add(pattern);
  return patterns;
}

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

  it("carries the same ignores on each boundary block as the template", () => {
    expect(templateBlocks).toHaveLength(3);

    // nothing the project adds. An ignore on a boundary block removes that
    // block's rule from the path entirely, so it softens exactly as a global
    // ignore does — it is merely scoped to the one block a reader is looking at
    for (const block of projectBlocks) {
      const key = JSON.stringify(block.files);
      const fromTemplate = blockIgnorePatterns(
        templateBlocks.find((template) => JSON.stringify(template.files) === key),
      );
      for (const pattern of blockIgnorePatterns(block)) {
        if (fromTemplate.has(pattern)) continue;
        expect(
          [...ALLOWED_BLOCK_IGNORES.keys()],
          `the ${BOUNDARY_RULE} block for files ${key} in eslint.config.mjs ignores ${pattern}, ` +
            "which templates/eslint.config.mjs does not. An ignore on a boundary block switches " +
            "that boundary rule off for the path — `ignores: [\"lib/**\"]` here disables the " +
            "enforcement layer for the code it exists to enforce. Add it to " +
            "ALLOWED_BLOCK_IGNORES with a reason, or take it out.",
        ).toContain(blockIgnoreKey(block.files, pattern));
      }
    }

    // and nothing the template holds is dropped, the same way the global list
    // is compared in both directions
    for (const [index, template] of templateBlocks.entries()) {
      const key = JSON.stringify(template.files);
      const match = projectBlocks.find((block) => JSON.stringify(block.files) === key);
      const inProject = blockIgnorePatterns(match);
      for (const pattern of blockIgnorePatterns(template)) {
        expect(
          [...inProject],
          `template block ${index + 1} (files ${key}) ignores ${pattern} and eslint.config.mjs ` +
            "no longer does",
        ).toContain(pattern);
      }
    }
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

// ---------------------------------------------------------------------------
// GENERATED OUTPUT IS NOT LINTED — AND THE IGNORE THAT SAYS SO IS NOT A BLANK CHEQUE
//
// coverage/ is regenerated by `vitest run --coverage` on every gate run and is
// authored by nobody. eslint flat config does not read .gitignore, so `npx
// eslint .` walked into it anyway and reported "Unused eslint-disable directive"
// from coverage/lcov-report/block-navigation.js — a verdict on output no human
// wrote. It changed nothing only because it is a warning; the day a generated
// report carries something eslint calls an error, the lint gate goes red on a
// file no PR touched. Same hole as .claude/worktrees/, one path over (ADR-033,
// "What this record does not fix").
//
// The fix is one ignore, and an ignore is a softening: it switches EVERY rule
// off for a path, which is why the global list is compared against the template
// at all. So the cases below hold the fix to three things at once — the report
// really is ignored, the ignore reaches nothing a human wrote, and the exception
// is still argued for where a reviewer reads it.
// ---------------------------------------------------------------------------

// The generated report opens with `/* eslint-disable */` and gives that
// directive nothing to suppress, so eslint reports it as unused — which is the
// exact warning coverage/lcov-report/block-navigation.js produces today. Two
// lines reproduce it, so the case below never depends on a real coverage run
// having happened, and never asks for one.
const GENERATED_REPORT_SOURCE = "/* eslint-disable */\n";

// Written into coverage/ and into the control directory, and removed again.
const PROBE_DIR = "__eslint-ignore-probe__";

// eslint reads a file that NO config entry matches as ignored. Without this the
// probe below would call every .ts path ignored whatever the ignore list said,
// and "the ignore reaches nothing a human wrote" would pass vacuously.
const PROBE_CONFIGURED_FILES = "**/*.{js,cjs,mjs,ts,tsx}";

/**
 * An eslint that knows the given ignore patterns and nothing else.
 *
 * Asking the whole config would answer "is this path linted", which is true but
 * unattributable — the point here is that the GLOBAL IGNORE LIST, the list the
 * template comparison audits, is what decides. Patterns taken from the loaded
 * config, never restated, for the same reason the rule blocks are not restated.
 */
function ignoresPath(patterns: Iterable<string>, relativePath: string): Promise<boolean> {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    baseConfig: [{ files: [PROBE_CONFIGURED_FILES], rules: {} }, { ignores: [...patterns] }],
  });
  return eslint.isPathIgnored(relativePath);
}

/** Which of `patterns`, on its own, is what ignores `relativePath`. */
async function patternsIgnoring(
  patterns: Iterable<string>,
  relativePath: string,
): Promise<string[]> {
  const responsible: string[] = [];
  for (const pattern of patterns) {
    if (await ignoresPath([pattern], relativePath)) responsible.push(pattern);
  }
  return responsible;
}

/** A reason as written, tolerant of a value that is not a string at runtime. */
function reasonText(reason: unknown): string {
  return typeof reason === "string" ? reason.trim() : "";
}

// Inside the generated report: the file ADR-033 names, a sibling of it, and a
// path nested deeper than the reporter happens to write today, so the ignore is
// not satisfied by naming one directory level.
const GENERATED_REPORT_PATHS = [
  "coverage/lcov-report/block-navigation.js",
  "coverage/lcov-report/sorter.js",
  "coverage/lcov-report/lib/modules/payroll/deep-report.js",
];

// Authored source, and each entry is here because a plausible widening of
// `coverage/**` swallows it — an ignore that reaches these is the softening the
// template comparison exists to catch, arriving as a typo instead of a decision.
// Measured against the real matcher: `**/coverage/**` ignores the third,
// `cov*` and `coverage*` ignore the fourth, `**` ignores all five.
const AUTHORED_PATHS = [
  "tests/gates/coverage-gate.test.ts", // a real test file, named for coverage
  "tests/scaffold/eslint-boundaries.test.ts", // this file
  "lib/kernel/coverage/index.ts", // a module directory could be called that
  "lib/coverage.ts",
  "coverage-notes.ts", // repository root, name merely starting with "coverage"
];

describe("generated output is outside the lint, and the ignore that says so is audited", () => {
  it("ignores the coverage report, stated in eslint.config.mjs and not left to .gitignore", async () => {
    // The patterns come from the loaded config, so a pass means the config
    // itself carries the ignore. .gitignore has covered coverage/ all along and
    // eslint never read it — that is the whole defect, so satisfying it there
    // again would satisfy nothing.
    const project = globalIgnorePatterns(projectConfig);
    for (const reportPath of GENERATED_REPORT_PATHS) {
      expect(
        await ignoresPath(project, reportPath),
        `eslint.config.mjs does not ignore ${reportPath}. coverage/ is regenerated by ` +
          "`vitest run --coverage` on every gate run and is authored by nobody, so the lint " +
          "gate reads a verdict on output no human wrote. Flat config does not read " +
          ".gitignore: the ignore has to be stated in the config or it does not exist.",
      ).toBe(true);
    }
  });

  it("does not widen that ignore into anything a human wrote", async () => {
    const project = globalIgnorePatterns(projectConfig);
    for (const authored of AUTHORED_PATHS) {
      expect(
        await ignoresPath(project, authored),
        `eslint.config.mjs ignores ${authored}, which is authored source. An ignore switches ` +
          "EVERY rule off for a path, boundary rules included — a pattern like `**/coverage/**` " +
          "or `cov*` reaches source nobody meant to exempt. The ignore's subject is the " +
          "generated report directory, not every path whose name mentions coverage.",
      ).toBe(false);
    }
  });

  it("accounts for the ignore against the template, by either route", async () => {
    // The node leaves the choice open: coverage/** may go into the template too,
    // or stay project-only and be named in ALLOWED_EXTRA_IGNORES. Both keep the
    // comparison honest, so both pass here — what fails is an ignore accounted
    // for by neither, or one waved through with no argument attached.
    const template = globalIgnorePatterns(templateConfig);
    const project = globalIgnorePatterns(projectConfig);
    const responsible = await patternsIgnoring(project, GENERATED_REPORT_PATHS[0]);
    expect(
      responsible,
      "no global ignore in eslint.config.mjs covers the generated coverage report",
    ).not.toHaveLength(0);
    for (const pattern of responsible) {
      if (template.has(pattern)) continue; // in the template as well: nothing extra to argue
      expect(
        reasonText(ALLOWED_EXTRA_IGNORES.get(pattern)),
        `eslint.config.mjs ignores ${pattern}, templates/eslint.config.mjs does not, and ` +
          "ALLOWED_EXTRA_IGNORES records no reason for it. Put the pattern in the template, " +
          "or name it above with the argument a reviewer needs.",
      ).not.toBe("");
    }
  });

  it("refuses an extra ignore whose reason is missing, blank or just the pattern again", () => {
    // The repository already answers this question elsewhere and answers it the
    // same way: gate.sh trims size_waiver_reason before testing it, because a
    // reason of "   " is worse than a missing one — the waiver is granted and
    // the printed line trails off after the em-dash looking as though an
    // argument was recorded. An ignore is a waiver on the enforcement layer, so
    // an unexplained one is refused rather than granted.
    for (const [pattern, reason] of ALLOWED_EXTRA_IGNORES) {
      expect(
        reasonText(reason),
        `ALLOWED_EXTRA_IGNORES grants ${pattern} with no reason. An ignore switches every ` +
          "rule off for that path; unexplained, it is a softening nobody can review.",
      ).not.toBe("");
      expect(
        reasonText(reason).toLowerCase(),
        `ALLOWED_EXTRA_IGNORES gives ${pattern} its own pattern back as the reason, which ` +
          "says why nothing.",
      ).not.toBe(pattern.toLowerCase());
    }
    for (const [key, reason] of ALLOWED_BLOCK_IGNORES) {
      expect(
        reasonText(reason),
        `ALLOWED_BLOCK_IGNORES grants ${key} with no reason — a boundary rule removed from a ` +
          "path, unargued",
      ).not.toBe("");
    }
  });

  it("grants an exception only for an ignore the config actually holds", () => {
    // A granted-in-advance exception is the quiet version of this whole defect:
    // the argument lands in one PR where it reads as harmless bookkeeping, and
    // the ignore it authorises lands in another where the comparison waves it
    // through. An allowance is spent in the same diff that writes it, or it is
    // stale and should go.
    const project = [...globalIgnorePatterns(projectConfig)];
    for (const pattern of ALLOWED_EXTRA_IGNORES.keys()) {
      expect(
        project,
        `ALLOWED_EXTRA_IGNORES allows ${pattern}, which eslint.config.mjs does not ignore. ` +
          "An allowance for an ignore nobody holds is an exception granted in advance.",
      ).toContain(pattern);
    }
    const held = projectBlocks.flatMap((block) =>
      [...blockIgnorePatterns(block)].map((pattern) => blockIgnoreKey(block.files, pattern)),
    );
    for (const key of ALLOWED_BLOCK_IGNORES.keys()) {
      expect(
        held,
        `ALLOWED_BLOCK_IGNORES allows ${key}, which no boundary block in eslint.config.mjs ` +
          "carries — an exception granted in advance",
      ).toContain(key);
    }
  });

  // The end-to-end form of the first case: not "the config says it is ignored"
  // but "eslint, run over the directory as `eslint .` runs over it, reports
  // nothing". Both fixtures are written by this test — coverage/ is emptied and
  // rewritten by every coverage run, so depending on its contents would make the
  // case pass on a machine that had not run one.
  //
  // The control is the point. The same two lines under test-results/ — gitignored
  // exactly as coverage/ is, and not in either eslint config — must be reported,
  // which proves the fixture really does produce a message and that .gitignore is
  // not what silenced the other one.
  //
  // Bounded by ADR-033's budget, and for its reason: the work is one config load
  // plus two directory walks, measured 1.2-1.4 s on an idle 14-core box, and a
  // timeout here is for a stuck import and never for a busy machine.
  it("reports nothing when it walks coverage/, while .gitignore alone silences nothing", async () => {
    const covDir = path.join(repoRoot, "coverage", PROBE_DIR);
    const controlDir = path.join(repoRoot, "test-results", PROBE_DIR);
    const covProbe = path.join(covDir, "generated-report.js");
    const controlProbe = path.join(controlDir, "generated-report.js");
    // Which parents were already here, recorded BEFORE anything is created.
    // `mkdirSync(recursive)` below will make coverage/ or test-results/ if they
    // are absent, and removing only the probe directories would leave an empty
    // one behind — handing the next run a coverage/ that the cov-report gate did
    // not produce. Deleting a parent that was already populated would be worse,
    // so the two cases are distinguished rather than guessed at.
    const parents = [path.dirname(covDir), path.dirname(controlDir)];
    const alreadyThere = new Set(parents.filter((dir) => fs.existsSync(dir)));
    try {
      for (const file of [covProbe, controlProbe]) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, GENERATED_REPORT_SOURCE);
      }
      const eslint = new ESLint({
        cwd: repoRoot,
        overrideConfigFile: projectPath,
        errorOnUnmatchedPattern: false,
      });
      const describeResults = (results: ESLint.LintResult[]): string[] =>
        results.flatMap((result) =>
          result.messages.map(
            (message) =>
              `${path.relative(repoRoot, result.filePath)}:${message.line} ${message.message}`,
          ),
        );

      const control = describeResults(await eslint.lintFiles(["test-results"]));
      expect(
        control,
        "the control fixture reported nothing, so this case proves nothing about coverage/. " +
          "Either the fixture no longer produces a message, or test-results/ has itself been " +
          "added to an ignore list and is no longer a control.",
      ).not.toHaveLength(0);

      // A coverage run clearing the directory mid-test would empty the result
      // set and turn a real failure into a pass, so the subject is checked to
      // still be there rather than assumed.
      expect(fs.existsSync(covProbe), `${covProbe} vanished before it was linted`).toBe(true);
      expect(
        describeResults(await eslint.lintFiles(["coverage"])),
        "eslint reports on files under coverage/, which is generated by `vitest run " +
          "--coverage` on every gate run and authored by nobody. The lint gate's verdict is " +
          "then partly about output no PR wrote.",
      ).toEqual([]);
    } finally {
      for (const dir of [covDir, controlDir]) fs.rmSync(dir, { recursive: true, force: true });
      // Runs on the failure path too, which is the one that matters: a case that
      // tidies up only when it passes leaves its litter exactly when someone is
      // already debugging. rmdir, not rm -r — it refuses a non-empty directory,
      // so a parent that gained anything else meanwhile survives.
      for (const parent of parents) {
        if (alreadyThere.has(parent)) continue;
        if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
      }
    }
  }, CONFIG_LOAD_BUDGET_MS);
});
