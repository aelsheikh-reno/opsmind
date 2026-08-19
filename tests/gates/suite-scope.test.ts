// Assertions for the `gate-scopes-the-suite-to-the-diff` backlog task:
//
//   1. "A diff touching scripts/, eslint.config.mjs, templates/ or
//       .github/workflows/ runs the pipeline's own tests"
//   2. "A diff touching none of those skips them, and says so in the printed
//       verdict rather than silently"
//   3. "test-count compares against the baseline for the mode that actually ran,
//       and a scoped run can never satisfy the full floor by accident"
//   4. "The same rule decides in CI, because CI runs this script — local and CI
//       never disagree about what ran"
//   5. "The guards gate still runs on every invocation, scoped or not"
//
// HOW THESE ARE DRIVEN. scripts/gate.sh is run for real against fixture
// repositories in temp directories, exactly as tests/gates/stale-input.test.ts
// and tests/gates/size-impl-comments.test.ts already drive it. The fixture
// machinery is theirs: a git repository with a `main` commit and a `task/demo`
// commit carrying the diff under measurement, a copy of scripts/ with
// test-guards.sh stubbed so the suite cannot re-enter itself, npx and npm
// stubbed, and the repository's node_modules symlinked in.
//
// ONE THING IS DIFFERENT, AND IT IS THE POINT. Where those files stub npx to
// exit 0, this one hands `npx vitest` STRAIGHT THROUGH to the real vitest in the
// symlinked node_modules and then copies the JSON report gate.sh asked for
// aside before gate.sh's EXIT trap deletes it. So what this file observes is not
// the arguments gate.sh passed — those are an implementation choice, and a rule
// asserted through them is a rule asserted twice — but the LIST OF TEST FILES
// VITEST ACTUALLY RAN, read out of vitest's own report. Whatever mechanism the
// scoping uses (an --exclude, a positional filter, a project, a config flag),
// the observable is the same and the assertion does not have to know.
//
// NOTHING HERE ASSERTS A WALL CLOCK. The saving this task exists for is real and
// measured on the backlog node, but a duration is a property of the machine as
// much as of the change: this repository has a recorded history of contention
// producing two verdicts for one commit (ADR-033, and the vitest.config.ts
// maxWorkers note). "Which files ran" is a fact about the run; "how long it
// took" is a fact about the afternoon.
//
// WHY THE FIXTURE'S TEST DIRECTORIES CARRY REAL REPOSITORY NAMES. tests/kernel,
// tests/modules and tests/services are directories this repository actually has,
// and tests/gates and tests/scaffold are the two the task excludes. A scoping
// rule may be written as "exclude these two" or as "include the others", and a
// fixture inventing directory names would pass the first and fail the second for
// a reason that has nothing to do with the rule.
//
// WHY tests/baseline.json IS READ AS DATA AND NO KEY OF IT IS NAMED. The task
// introduces a second floor; which keys hold the two is the implementer's
// choice, and a test naming them asserts the schema rather than the behaviour.
// So the fixtures are seeded with the repository's own baseline file verbatim,
// the two floors are read back out of what the GATE PRINTED, and the pairing is
// then checked against the file's integer leaves — flat or nested, any spelling.
// No expected number in this file was copied out of an implementation: every one
// is either a count the fixture itself wrote or a floor the gate stated.
//
// POLARITY. Every rule is pinned in both directions. All four trigger paths run
// the pipeline's tests AND four near-misses do not; the scoped floor binds a
// scoped run AND does not bind a full one; guards passes in both modes AND fails
// the run in both modes when it fails.
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

// A TIMEOUT IS FOR A HANG, NOT FOR CONTENTION (ADR-033). Every case here spawns
// gate.sh, which spawns a real nested vitest. Measured 2026-08-19 on a 14-core
// WSL2 machine: the sixteen distinct gate runs this file drives took 71 s, 104 s
// and 167 s of wall clock across three runs of the identical file — 4.4 s to
// 10.4 s per run, the spread being machine load and nothing else. A single
// nested vitest is 4.5 s of that with --coverage and 3.2 s without, and the rest
// is git and the gate's other lines. The heaviest single CASE drives four runs,
// so ~42 s at the worst figure observed. 300 s is ~7x that and ~29x the slowest
// single run seen. A stuck gate still fails, and fails within five minutes; a
// busy machine does not. Re-measure rather than trust these — they are dated,
// and the instruction beside every bound in this repository is the same one.
// Set per file rather than in vitest.config.ts so no other suite's bound moves.
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_BASELINE = path.join(repoRoot, "tests", "baseline.json");
const GATES_WORKFLOW = path.join(repoRoot, ".github", "workflows", "gates.yml");
const READER_RELATIVE = path.join("tests", "kernel", "kernel-source.ts");

const temps: string[] = [];
// Runs whether the cases passed or failed, so a red suite does not leave
// fixtures behind. rmSync unlinks the node_modules SYMLINK rather than
// recursing through it — verified before this file was written, because the
// alternative would delete the repository's node_modules on every run.
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ fixtures --

const GIT_ENV = {
  GIT_AUTHOR_NAME: "gate",
  GIT_AUTHOR_EMAIL: "gate@opsmind.test",
  GIT_COMMITTER_NAME: "gate",
  GIT_COMMITTER_EMAIL: "gate@opsmind.test",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, ...GIT_ENV },
  });
}

function write(dir: string, relative: string, content: string): void {
  const target = path.join(dir, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/**
 * The fixture's own suite. Each file declares a distinct number of cases so that
 * a total identifies which files ran even before the report is opened, and every
 * case passes so that the `tests` gate is green and the run reaches test-count.
 */
const SUITES: Record<string, number> = {
  "tests/kernel/kernel.test.ts": 3,
  "tests/modules/modules.test.ts": 2,
  "tests/services/services.test.ts": 6,
  "tests/gates/gates.test.ts": 7,
  "tests/scaffold/scaffold.test.ts": 5,
};

/** The two the task excludes from a scoped run: the pipeline testing itself. */
const PIPELINE_SUITES = ["tests/gates/gates.test.ts", "tests/scaffold/scaffold.test.ts"];
/** Everything else, which runs in either mode. */
const PRODUCT_SUITES = Object.keys(SUITES).filter((f) => !PIPELINE_SUITES.includes(f));

const FULL_COUNT = Object.values(SUITES).reduce((a, b) => a + b, 0); // 23
const SCOPED_COUNT = PRODUCT_SUITES.reduce((a, f) => a + SUITES[f], 0); // 11

function suiteSource(file: string, cases: number): string {
  const tag = file.replace(/[^a-z]/g, "");
  const body = Array.from(
    { length: cases },
    (_, i) => `  it("${tag} case ${i + 1}", () => { expect(${i + 1}).toBe(${i + 1}); });`,
  ).join("\n");
  return `import { describe, it, expect } from "vitest";\n\ndescribe("${file}", () => {\n${body}\n});\n`;
}

// Deliberately close to the repository's own: the same include glob, so a
// scoping rule expressed as a change to the include set behaves here as it would
// there, and a coverage block, because gate.sh runs the suite with --coverage
// and cov-report reads what it produced.
const FIXTURE_VITEST_CONFIG = `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["lcov"],
      reportsDirectory: "coverage",
      include: ["lib/**/*.ts"],
    },
  },
});
`;

/**
 * Stands in for npx. eslint and tsc are answered with a silent success — there
 * is nothing to lint in a temp directory — but the SUITE IS REAL: vitest is
 * handed through untouched, so what runs is decided by the arguments gate.sh
 * passed and by nothing this stub knows about them. The report gate.sh asked
 * vitest to write is copied aside, because gate.sh deletes it on EXIT and it is
 * the only record of which files ran.
 */
function npxStub(dir: string): string {
  return [
    "#!/usr/bin/env bash",
    `here=${JSON.stringify(dir)}`,
    `printf '%s\\n' "$*" >> "$here/gate-probe/npx-argv.log"`,
    `[ "$1" = vitest ] || exit 0`,
    "shift",
    'out=""',
    'prev=""',
    'for a in "$@"; do',
    `  case "$a" in --outputFile=*) out="\${a#--outputFile=}" ;; esac`,
    `  if [ "$prev" = "--outputFile" ]; then out="$a"; fi`,
    '  prev="$a"',
    "done",
    `"$here/node_modules/.bin/vitest" "$@"`,
    "rc=$?",
    "n=1",
    `while [ -e "$here/gate-probe/report-$n.json" ]; do n=$((n + 1)); done`,
    `if [ -n "$out" ] && [ -f "$out" ]; then cp "$out" "$here/gate-probe/report-$n.json"; fi`,
    "exit $rc",
    "",
  ].join("\n");
}

/**
 * Stands in for scripts/test-guards.sh, which probes gate.sh inside fixtures of
 * its own and would not terminate if a fixture ran it for real. It records that
 * it was called, which is what assertion 5 reads, and returns whatever status
 * the scenario asks for, which is how assertion 5 is shown to be load-bearing
 * rather than a line that merely prints.
 */
function guardsStub(dir: string, exitCode: number): string {
  return [
    "#!/usr/bin/env bash",
    `printf 'ran\\n' >> ${JSON.stringify(path.join(dir, "gate-probe", "guards.log"))}`,
    exitCode === 0 ? "exit 0" : `echo "a gate stopped blocking what it claims to"; exit ${exitCode}`,
    "",
  ].join("\n");
}

interface Scenario {
  /** The files the TASK COMMIT adds. This diff is what the mode is decided from. */
  diff: Record<string, string>;
  /** tests/baseline.json, committed on `main`. Defaults to the repository's own. */
  baseline?: string;
  /** What the stubbed guard suite returns. */
  guardsExit?: number;
  /** Check out the task commit detached, as actions/checkout does for a PR. */
  detached?: boolean;
  /** Extra environment for the gate invocation. */
  env?: Record<string, string>;
}

function buildFixture(spec: Scenario): string {
  const dir = mkdtempSync(path.join(tmpdir(), "opsmind-suite-scope-"));
  temps.push(dir);
  // `git init -b main` needs git 2.28; the runner in runner/PROXMOX.md has
  // 2.25, so the branch is named with symbolic-ref as the sibling suites do.
  git(dir, ["init", "-q"]);
  git(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);

  write(dir, ".gitignore", "node_modules\ncoverage/\n.task-current.yaml\ngate-probe/\n");
  write(dir, "lib/seed.ts", "export const seed = 1;\n");
  write(dir, "tasks/backlog.yaml", "- id: demo\n  risk: low\n  status: todo\n");
  write(dir, "tests/baseline.json", spec.baseline ?? readFileSync(REPO_BASELINE, "utf8"));
  write(dir, "vitest.config.ts", FIXTURE_VITEST_CONFIG);
  for (const [file, cases] of Object.entries(SUITES)) write(dir, file, suiteSource(file, cases));
  // size-impl classifies a line with the TypeScript compiler through this
  // reader, and refuses when it cannot reach it (ADR-031). A fixture without it
  // is not a smaller real run, it is a run that cannot measure — the same
  // requirement tests/gates/size-impl-comments.test.ts records.
  write(dir, READER_RELATIVE, readFileSync(path.join(repoRoot, READER_RELATIVE), "utf8"));

  // The artifact under test is COPIED AND RUN, never read. Everything this file
  // knows about scripts/gate.sh it learned by watching it print.
  execFileSync("cp", ["-r", path.join(repoRoot, "scripts"), path.join(dir, "scripts")]);
  write(dir, "scripts/test-guards.sh", guardsStub(dir, spec.guardsExit ?? 0));
  chmodSync(path.join(dir, "scripts", "test-guards.sh"), 0o755);

  mkdirSync(path.join(dir, "gate-probe"));
  mkdirSync(path.join(dir, "stub-bin"));
  write(dir, "stub-bin/npx", npxStub(dir));
  chmodSync(path.join(dir, "stub-bin", "npx"), 0o755);
  write(dir, "stub-bin/npm", "#!/bin/sh\nexit 0\n");
  chmodSync(path.join(dir, "stub-bin", "npm"), 0o755);
  symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"));

  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "base"]);

  git(dir, ["checkout", "-q", "-b", "task/demo"]);
  for (const [file, content] of Object.entries(spec.diff)) write(dir, file, content);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "task"]);
  if (spec.detached === true) git(dir, ["checkout", "-q", "--detach"]);
  return dir;
}

interface GateRun {
  dir: string;
  code: number;
  out: string;
  /** every output line beginning with a gate label, e.g. line("guards") */
  line: (label: string) => string;
  /** a gate's line together with its indented detail, e.g. block("test-count") */
  block: (label: string) => string;
  /** the test files vitest actually ran, repository-relative and sorted */
  ran: string[];
  /** numTotalTests, from the same report */
  totalTests: number | null;
  /** how many times npx was asked to run vitest */
  vitestRuns: number;
  /** how many times the guard suite was called */
  guardsRuns: number;
}

function readReport(dir: string): { ran: string[]; totalTests: number | null } {
  const report = path.join(dir, "gate-probe", "report-1.json");
  if (!existsSync(report)) return { ran: [], totalTests: null };
  const parsed = JSON.parse(readFileSync(report, "utf8")) as {
    numTotalTests?: number;
    testResults?: { name?: string }[];
  };
  const ran = (parsed.testResults ?? [])
    .map((r) => path.relative(dir, r.name ?? ""))
    .filter((p) => p !== "" && !p.startsWith(".."))
    .sort();
  return { ran, totalTests: parsed.numTotalTests ?? null };
}

function countLines(file: string, predicate: (l: string) => boolean): number {
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8").split("\n").filter(predicate).length;
}

/**
 * Stripped from the inner run, never inherited.
 *
 * GITHUB_HEAD_REF is set for a whole CI job and wins inside a fixture over the
 * branch the fixture created — the defect tests/gates/coverage-gate.test.ts
 * records flipping eight of its cases in CI and nowhere else, so the suite was
 * green on the only machine that could not see it. The rest of the GITHUB_* set
 * goes with it, because a scenario that wants a CI environment says so
 * explicitly and one that does not must not be handed one.
 *
 * The VITEST_* pair and NODE_V8_COVERAGE belong to the OUTER run. This file
 * spawns a real vitest inside a real vitest; inherited, they would have the
 * inner one reporting into the outer one's bookkeeping.
 */
const STRIPPED_FROM_THE_INNER_RUN = [
  "GITHUB_HEAD_REF",
  "GITHUB_BASE_REF",
  "GITHUB_REF",
  "GITHUB_ACTIONS",
  "CI",
  "VITEST",
  "VITEST_POOL_ID",
  "VITEST_WORKER_ID",
  "NODE_V8_COVERAGE",
];

const cache = new Map<string, GateRun>();

/** Runs the gate once per distinct scenario; every case below shares the cache,
 *  because a nested vitest is the expensive part and re-running it proves
 *  nothing a second time. */
function runGate(spec: Scenario): GateRun {
  const key = JSON.stringify(spec);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const dir = buildFixture(spec);
  const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const name of STRIPPED_FROM_THE_INNER_RUN) delete cleanEnv[name];

  const result = spawnSync(path.join(dir, "scripts", "gate.sh"), [], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...cleanEnv,
      ...GIT_ENV,
      GATE_BASE: "main",
      PATH: `${path.join(dir, "stub-bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      ...(spec.env ?? {}),
    },
  });
  if (result.error !== undefined) throw result.error;
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const { ran, totalTests } = readReport(dir);

  const run: GateRun = {
    dir,
    code: result.status ?? -1,
    out,
    ran,
    totalTests,
    vitestRuns: countLines(path.join(dir, "gate-probe", "npx-argv.log"), (l) =>
      l.startsWith("vitest "),
    ),
    guardsRuns: countLines(path.join(dir, "gate-probe", "guards.log"), (l) => l.trim() === "ran"),
    line: (label) =>
      out
        .split("\n")
        .filter((l) => l.startsWith(label))
        .join("\n"),
    block: (label) => {
      const kept: string[] = [];
      let inside = false;
      for (const l of out.split("\n")) {
        if (l.startsWith(label)) {
          inside = true;
          kept.push(l);
        } else if (inside && /^\s/.test(l)) kept.push(l);
        else inside = false;
      }
      return kept.join("\n");
    },
  };
  cache.set(key, run);
  return run;
}

// --------------------------------------------------------------- the diffs --

const TS = 'export const x = 1;\n';
const SH = "#!/usr/bin/env bash\necho hello\n";

/** A diff that touches none of the trigger paths: ordinary product work. */
const PRODUCT_DIFF = { "lib/modules/payroll/prorata.ts": TS };

const scopedRun = () => runGate({ diff: PRODUCT_DIFF });
const fullRun = () => runGate({ diff: { "scripts/helper.sh": SH } });

/** The lines in which a run says which suite it ran. Deliberately NOT pinned to
 *  a label — the gate's %-14s column may name this anything — only to the words
 *  that carry the meaning, and to the paths a scoped verdict has to name if it
 *  is not to be silent about what it left out. */
function modeStatement(out: string): string {
  return out
    .split("\n")
    .filter((l) => /\b(full|scoped)\b/i.test(l) || /tests\/(gates|scaffold)/.test(l))
    .join("\n");
}

/** The floor a gate line stated, from either spelling gate.sh prints it in. */
function statedFloor(block: string): number | null {
  const match = block.match(/floor (?:is|of) (\d+)/);
  return match === null ? null : Number(match[1]);
}

/** Every integer leaf of a JSON value, by dotted path. Flat or nested: the task
 *  may hold its two floors as two keys or as one key with two members, and this
 *  file has no business caring which. */
function intLeaves(value: unknown, prefix = ""): Map<string, number> {
  const found = new Map<string, number>();
  if (typeof value === "number") {
    if (Number.isInteger(value)) found.set(prefix, value);
    return found;
  }
  if (value === null || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    for (const [p, n] of intLeaves(child, prefix === "" ? key : `${prefix}.${key}`)) found.set(p, n);
  }
  return found;
}

function setLeaf(root: Record<string, unknown>, dotted: string, value: number): void {
  const parts = dotted.split(".");
  let node = root;
  for (const part of parts.slice(0, -1)) node = node[part] as Record<string, unknown>;
  node[parts[parts.length - 1]] = value;
}

/** The repository's baseline with the two floors overwritten — the only way to
 *  drive the ratchet without naming a key the implementer chose. */
function baselineWith(scoped: number, full: number): string {
  const { scopedKey, fullKey } = discoverFloorKeys();
  const parsed = JSON.parse(readFileSync(REPO_BASELINE, "utf8")) as Record<string, unknown>;
  setLeaf(parsed, scopedKey, scoped);
  setLeaf(parsed, fullKey, full);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/**
 * Which key of tests/baseline.json holds which floor — discovered by asking the
 * gate, never by reading the file for a name. Both fixtures below carry the
 * repository's real baseline, whose floors are far above the eleven and
 * twenty-three cases a fixture has, so each run FAILS test-count and states the
 * floor it was graded against. The two stated floors are then matched back to
 * the file's integer leaves.
 */
let floorKeys: { scoped: number; full: number; scopedKey: string; fullKey: string } | null = null;

function discoverFloorKeys(): { scoped: number; full: number; scopedKey: string; fullKey: string } {
  if (floorKeys !== null) return floorKeys;
  const scopedFloor = statedFloor(scopedRun().block("test-count"));
  const fullFloor = statedFloor(fullRun().block("test-count"));
  expect(
    scopedFloor,
    `a scoped run did not state the floor it was graded against:\n${scopedRun().block("test-count")}`,
  ).not.toBeNull();
  expect(
    fullFloor,
    `a full run did not state the floor it was graded against:\n${fullRun().block("test-count")}`,
  ).not.toBeNull();

  const leaves = intLeaves(JSON.parse(readFileSync(REPO_BASELINE, "utf8")));
  const holders = (n: number): string[] =>
    [...leaves.entries()].filter(([, v]) => v === n).map(([k]) => k);
  const scopedHolders = holders(scopedFloor as number);
  const fullHolders = holders(fullFloor as number);

  expect(
    scopedHolders,
    `the scoped run was graded against ${scopedFloor}, which is not recorded anywhere in ` +
      `tests/baseline.json (${[...leaves].map(([k, v]) => `${k}=${v}`).join(", ")}) — a floor ` +
      "the ratchet file does not carry is a floor no reviewer can move",
  ).toHaveLength(1);
  expect(
    fullHolders,
    `the full run was graded against ${fullFloor}, which is not recorded exactly once in ` +
      `tests/baseline.json (${[...leaves].map(([k, v]) => `${k}=${v}`).join(", ")})`,
  ).toHaveLength(1);

  floorKeys = {
    scoped: scopedFloor as number,
    full: fullFloor as number,
    scopedKey: scopedHolders[0],
    fullKey: fullHolders[0],
  };
  return floorKeys;
}

// ---------------------------------------------------------------------------//
// Assertion 1 — a diff that touches the pipeline runs the pipeline's own tests
// ---------------------------------------------------------------------------//

describe("assertion 1 · a diff touching the pipeline runs the pipeline's own tests", () => {
  // ONE CASE PER PATH IN THE TRIGGER LIST. A rule that fires on scripts/ and not
  // on .github/workflows/ passes a single-path test and leaves three quarters of
  // the pipeline ungraded; the four are separate files so a failure names which
  // path stopped triggering. Each fixture touches exactly one of them, and none
  // of the four filenames matches another's rule.
  const triggers: [string, Record<string, string>][] = [
    ["scripts/", { "scripts/helper.sh": SH }],
    ["eslint.config.mjs", { "eslint.config.mjs": "export default [];\n" }],
    ["templates/", { "templates/tsconfig.json": '{ "compilerOptions": {} }\n' }],
    [".github/workflows/", { ".github/workflows/nightly.yml": "name: nightly\non: push\n" }],
  ];

  for (const [label, diff] of triggers) {
    it(`runs tests/gates and tests/scaffold for a diff touching ${label}`, () => {
      const run = runGate({ diff });
      expect(
        run.ran,
        `a diff touching ${label} did not run the pipeline's own tests.\n${run.out}`,
      ).toEqual(expect.arrayContaining(PIPELINE_SUITES));
      expect(run.ran, `a diff touching ${label} skipped product tests too`).toEqual(
        expect.arrayContaining(PRODUCT_SUITES),
      );
      expect(
        run.totalTests,
        `a diff touching ${label} collected the pipeline's files but not its cases`,
      ).toBe(FULL_COUNT);
    });
  }

  it("runs them for a diff that touches a trigger path alongside product code", () => {
    // The common shape of a real pipeline task: it changes the gate AND the
    // module the gate is about. A rule reading only the first changed path, or
    // requiring the diff to be confined to the trigger list, fails here.
    const run = runGate({
      diff: { "scripts/helper.sh": SH, "lib/modules/payroll/prorata.ts": TS },
    });
    expect(run.ran, run.out).toEqual(expect.arrayContaining(PIPELINE_SUITES));
    expect(run.totalTests, run.out).toBe(FULL_COUNT);
  });

  it("states that it ran the full suite", () => {
    const statement = modeStatement(fullRun().out);
    expect(
      statement,
      `a full run printed no statement of what it ran:\n${fullRun().out}`,
    ).toMatch(/\bfull\b/i);
  });
});

// ---------------------------------------------------------------------------//
// Assertion 2 — a diff touching none of them skips them, and says so
// ---------------------------------------------------------------------------//

describe("assertion 2 · a product diff skips the pipeline's own tests, out loud", () => {
  it("does not run tests/gates or tests/scaffold", () => {
    const run = scopedRun();
    expect(
      run.ran.filter((f) => f.startsWith("tests/gates/") || f.startsWith("tests/scaffold/")),
      `a diff touching no pipeline path still ran the pipeline's own tests.\n${run.out}`,
    ).toEqual([]);
  });

  it("still runs every product test", () => {
    const run = scopedRun();
    expect(run.ran, run.out).toEqual(expect.arrayContaining(PRODUCT_SUITES));
    expect(run.totalTests, run.out).toBe(SCOPED_COUNT);
    expect(run.line("tests"), `the scoped suite did not pass:\n${run.out}`).toContain("pass");
  });

  it("says in the printed verdict that it skipped them, and names what it skipped", () => {
    const run = scopedRun();
    expect(
      modeStatement(run.out),
      `a scoped run printed no statement of what it left out:\n${run.out}`,
    ).toMatch(/scoped|skip/i);
    expect(
      run.out,
      "the scoped verdict does not name tests/gates as excluded — a verdict that " +
        "silently measures less is the defect ADR-031 exists to prevent",
    ).toContain("tests/gates");
    expect(run.out, "the scoped verdict does not name tests/scaffold as excluded").toContain(
      "tests/scaffold",
    );
  });

  it("prints a different statement in the two modes", () => {
    // If the same words appear whatever ran, the print is decoration and the
    // operator still cannot tell which question the verdict answered.
    expect(modeStatement(scopedRun().out)).not.toBe(modeStatement(fullRun().out));
  });

  it("runs a strict subset of the full suite, never a different one", () => {
    // The invariant behind the whole task: scoping REMOVES files, it does not
    // substitute them. A scoped run that ran something a full run does not
    // would be a second suite nobody grades.
    const scoped = scopedRun();
    const full = fullRun();
    for (const file of scoped.ran) expect(full.ran, full.out).toContain(file);
    expect(scoped.ran.length).toBeLessThan(full.ran.length);
    expect(scoped.totalTests as number).toBeLessThan(full.totalTests as number);
  });

  it("does not treat a product path that merely contains a trigger name as a trigger", () => {
    // `scripts/`, `templates/` and `.github/workflows/` are directories at the
    // repository root. A rule matching them as substrings anywhere in a path
    // drags every one of these product files into a full run, and the saving
    // this task exists for quietly stops applying.
    const run = runGate({
      diff: {
        "lib/scripts/helper.ts": TS,
        "lib/templates/letter.ts": TS,
        "lib/github/workflows/state.ts": TS,
        "app/api/scripts/route.ts": TS,
      },
    });
    expect(
      run.ran.filter((f) => f.startsWith("tests/gates/") || f.startsWith("tests/scaffold/")),
      "a product path containing a trigger directory's name as a substring was " +
        `treated as touching the pipeline.\n${run.out}`,
    ).toEqual([]);
    expect(run.totalTests, run.out).toBe(SCOPED_COUNT);
  });

  it("does not treat a file merely named eslint.config.mjs elsewhere as the root config", () => {
    // The trigger is the repository's eslint config. A basename match makes any
    // file of that name anywhere force a full run — the safe direction, but a
    // rule nobody can predict, and one that grows a hole the day a module ships
    // a config of its own.
    const run = runGate({ diff: { "lib/modules/billing/eslint.config.mjs": TS } });
    expect(
      run.ran.filter((f) => f.startsWith("tests/gates/") || f.startsWith("tests/scaffold/")),
      `a non-root file named eslint.config.mjs was read as the root config.\n${run.out}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------//
// Assertion 3 — the ratchet is graded against the mode that actually ran
// ---------------------------------------------------------------------------//
//
// THIS IS WHERE THE DEFECT WOULD LIVE. Not "the wrong number is printed" — a
// scoped run silently satisfying the full floor, or a full run graded against
// the scoped one. Either leaves the ratchet meaningless with everything green,
// which is the failure ADR-031 catalogues four instances of. Both confusions are
// constructed below, and each case is built so that the WRONG pairing gives the
// opposite verdict rather than a different number.

describe("assertion 3 · test-count grades the mode that actually ran", () => {
  it("grades the two modes against two different floors, each recorded in the baseline", () => {
    const keys = discoverFloorKeys();
    expect(
      keys.scopedKey,
      `both modes were graded against ${keys.scoped} from the same key '${keys.scopedKey}' — ` +
        "one floor cannot serve two suites, and the one it does not fit is the one it waves through",
    ).not.toBe(keys.fullKey);
    expect(
      keys.full,
      `the full floor (${keys.full}) is not above the scoped floor (${keys.scoped}); the full ` +
        "suite is a superset, so a full floor at or below the scoped one can be met by a scoped run",
    ).toBeGreaterThan(keys.scoped);
  });

  it("passes a scoped run whose count is far below the full floor", () => {
    // CONFUSION ONE, CONSTRUCTED. Eleven cases, a scoped floor of eleven and a
    // full floor of 999. Graded against the mode that ran, this passes; graded
    // against the full baseline it fails, so the case is red under exactly the
    // mispairing it exists to detect.
    const run = runGate({ diff: PRODUCT_DIFF, baseline: baselineWith(SCOPED_COUNT, 999) });
    expect(run.totalTests, run.out).toBe(SCOPED_COUNT);
    expect(
      run.block("test-count"),
      `a scoped run of ${SCOPED_COUNT} was graded against the FULL floor of 999.\n${run.out}`,
    ).toContain("pass");
    expect(
      run.block("test-count"),
      "the scoped run named the full floor as the number it had to clear",
    ).not.toMatch(/floor (?:is|of) 999/);
  });

  it("fails a full run below the full floor even when the scoped floor is beneath it", () => {
    // CONFUSION TWO, CONSTRUCTED, and the dangerous direction. Twenty-three
    // cases, a scoped floor of 1 and a full floor of 999. Graded against the
    // mode that ran, this fails; graded against the scoped baseline it passes
    // and the full ratchet has stopped existing while the gate prints green.
    const run = runGate({ diff: { "scripts/helper.sh": SH }, baseline: baselineWith(1, 999) });
    expect(run.totalTests, run.out).toBe(FULL_COUNT);
    expect(
      run.block("test-count"),
      `a full run of ${FULL_COUNT} satisfied the SCOPED floor of 1 and never met the full ` +
        `floor of 999.\n${run.out}`,
    ).toContain("FAIL");
    expect(run.block("test-count"), run.out).toMatch(/999/);
    expect(run.code, run.out).toBe(1);
  });

  it("fails a scoped run below the scoped floor, with the full floor at zero", () => {
    // The scoped floor has to BIND, not merely be printed. Eleven cases against
    // a scoped floor of twelve, with the full floor set to zero so nothing else
    // in the file could be doing the work.
    const run = runGate({ diff: PRODUCT_DIFF, baseline: baselineWith(SCOPED_COUNT + 1, 0) });
    expect(
      run.block("test-count"),
      `a scoped run of ${SCOPED_COUNT} cleared a scoped floor of ${SCOPED_COUNT + 1}.\n${run.out}`,
    ).toContain("FAIL");
    expect(run.block("test-count"), run.out).toMatch(new RegExp(String(SCOPED_COUNT + 1)));
    expect(run.code, run.out).toBe(1);
  });

  it("passes a full run at exactly the full floor while the scoped floor towers over it", () => {
    // The boundary, and the mirror of the case above: a floor is met at equality
    // and the other mode's number does not reach across.
    const run = runGate({ diff: { "scripts/helper.sh": SH }, baseline: baselineWith(999, FULL_COUNT) });
    expect(run.totalTests, run.out).toBe(FULL_COUNT);
    expect(
      run.block("test-count"),
      `a full run of exactly ${FULL_COUNT} against a full floor of ${FULL_COUNT} did not ` +
        `pass — the scoped floor of 999 reached across.\n${run.out}`,
    ).toContain("pass");
  });

  it("takes the count from the one run it made, in either mode", () => {
    // The floor may only be compared with a count from the run that produced the
    // verdict; a second invocation is a second suite, which is how test-count
    // once reported 1064 against a floor of 1111 on a docs-only commit.
    expect(scopedRun().vitestRuns, scopedRun().out).toBe(1);
    expect(fullRun().vitestRuns, fullRun().out).toBe(1);
  });
});

// ---------------------------------------------------------------------------//
// Assertion 4 — the same rule decides in CI, because CI runs this script
// ---------------------------------------------------------------------------//

describe("assertion 4 · one rule, in one file, for both places", () => {
  const workflow = readFileSync(GATES_WORKFLOW, "utf8");

  it("has CI invoke the gate script rather than a suite of its own", () => {
    expect(workflow, "the gates workflow no longer runs scripts/gate.sh").toMatch(
      /\.\/scripts\/gate\.sh/,
    );
    expect(
      /npx\s+vitest|npm\s+(run\s+)?test\b/.test(workflow),
      "the gates workflow runs a test suite of its own; whatever it selects is a " +
        "second answer to the question gate.sh already answers, and the two will disagree",
    ).toBe(false);
  });

  it("keeps the selection rule out of the workflow", () => {
    expect(
      /tests\/gates|tests\/scaffold/.test(workflow),
      "the gates workflow names the directories the scoping rule selects. A rule " +
        "living in the workflow is the split brain ADR-031 and ADR-033 exist to prevent",
    ).toBe(false);
    expect(
      /^\s*paths(-ignore)?:/m.test(workflow),
      "the gates workflow carries a paths filter, so which gates run at all is " +
        "decided by the workflow and not by the script a developer runs locally",
    ).toBe(false);
  });

  it("decides a product diff the same way under a CI checkout", () => {
    // actions/checkout builds a detached merge commit for a pull request, so the
    // branch name survives only in GITHUB_HEAD_REF. A rule reading the branch
    // rather than the diff answers differently here than it does locally.
    const ci = runGate({
      diff: PRODUCT_DIFF,
      detached: true,
      env: {
        CI: "true",
        GITHUB_ACTIONS: "true",
        GITHUB_HEAD_REF: "task/demo",
        GITHUB_BASE_REF: "main",
        GITHUB_REF: "refs/pull/1/merge",
      },
    });
    expect(ci.ran, `CI ran a different set of files than the local run did.\n${ci.out}`).toEqual(
      scopedRun().ran,
    );
    expect(ci.totalTests, ci.out).toBe(scopedRun().totalTests);
    expect(modeStatement(ci.out), ci.out).toMatch(/scoped|skip/i);
  });

  it("decides a pipeline diff the same way under a CI checkout", () => {
    const ci = runGate({
      diff: { "scripts/helper.sh": SH },
      detached: true,
      env: {
        CI: "true",
        GITHUB_ACTIONS: "true",
        GITHUB_HEAD_REF: "task/demo",
        GITHUB_BASE_REF: "main",
        GITHUB_REF: "refs/pull/1/merge",
      },
    });
    expect(ci.ran, `CI ran a different set of files than the local run did.\n${ci.out}`).toEqual(
      fullRun().ran,
    );
    expect(ci.totalTests, ci.out).toBe(FULL_COUNT);
    expect(modeStatement(ci.out), ci.out).toMatch(/\bfull\b/i);
  });
});

// ---------------------------------------------------------------------------//
// Assertion 5 — guards runs on every invocation, scoped or not
// ---------------------------------------------------------------------------//
//
// THIS IS THE SAFETY NET AND IT IS PROVED, NOT ASSUMED. scripts/test-guards.sh
// is what verifies every gate still blocks what it claims to, in both
// directions, and it is the whole reason skipping the deeper checks in
// tests/gates/ is acceptable at all. A scoped run that quietly dropped it too
// would have removed the argument for its own existence. So it is pinned in both
// modes, and pinned by CALLING rather than by PRINTING: a stub that fails must
// take the run down with it.

describe("assertion 5 · the guards gate runs on every invocation", () => {
  it("runs it on a full invocation", () => {
    const run = fullRun();
    expect(run.guardsRuns, `the guard suite was not called.\n${run.out}`).toBe(1);
    expect(run.line("guards"), run.out).toContain("pass");
  });

  it("runs it on a scoped invocation too", () => {
    const run = scopedRun();
    expect(
      run.guardsRuns,
      `a scoped run did not call the guard suite. Skipping tests/gates is only ` +
        `acceptable because guards still asks whether the gates work at all.\n${run.out}`,
    ).toBe(1);
    expect(run.line("guards"), run.out).toContain("pass");
  });

  it("fails a scoped run when the guards fail", () => {
    const run = runGate({ diff: PRODUCT_DIFF, guardsExit: 1 });
    expect(
      run.line("guards"),
      `a scoped run printed a guards verdict it did not earn.\n${run.out}`,
    ).toContain("FAIL");
    expect(run.code, run.out).toBe(1);
    expect(run.out).toContain("GATES FAILED");
  });

  it("fails a full run when the guards fail", () => {
    const run = runGate({ diff: { "scripts/helper.sh": SH }, guardsExit: 1 });
    expect(run.line("guards"), run.out).toContain("FAIL");
    expect(run.code, run.out).toBe(1);
    expect(run.out).toContain("GATES FAILED");
  });
});
