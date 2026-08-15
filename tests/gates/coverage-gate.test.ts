// Assertions for the `gate-coverage-strict-path` backlog task:
//
//   1.  "Coverage is measured on the lines the task changed: 90% for money and
//        compliance, 70% for low"
//   2.  "Total repository coverage must not decrease against the stored baseline"
//   3.  "A task adding uncovered new code fails diff coverage"
//   4.  "A task that lowers total coverage fails the ratchet"
//   5.  "An unreadable coverage report fails closed"
//   6.  "A missing or unparseable baseline fails closed"
//   7.  "A coverage waiver with no reason fails closed, and a waiver in use is
//        printed with its reason"
//   8.  "lib/kernel/*/repository.ts stays measured — no path is excluded to make
//        the gate pass"
//   9.  "A diff with no coverable lines passes, and says so rather than passing
//        silently"
//   10. "A branch that resolves no task can still pass the gates on a clean main"
//
// HOW THESE ARE DRIVEN. scripts/coverage-gate.sh is a shell script whose whole
// job is to read three files and a git diff, so it is exercised the way
// tests/deploy/staging-deploy.test.ts exercises the deploy stack: the artifact
// under test is run for real, against fixtures built in a temp directory.
//
// EVERY FIXTURE IS SYNTHETIC ON PURPOSE. Nothing below reads this repository's
// own coverage/lcov.info or its real percentage. Those numbers move with every
// merged task, and a gate test pinned to them would either fail on unrelated
// work or be quietly relaxed until it asserted nothing. The lcov files here are
// written by hand so the expected arithmetic is visible in the test.
//
// The one exception is assertion 8, which is a claim about configuration rather
// than about arithmetic: it reads vitest.config.ts and the gate scripts as text
// and asserts that no path has been excluded to make the number go green.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(repoRoot, "scripts", "coverage-gate.sh");
const GATE = path.join(repoRoot, "scripts", "gate.sh");

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ fixtures --

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "gate",
      GIT_AUTHOR_EMAIL: "gate@opsmind.test",
      GIT_COMMITTER_NAME: "gate",
      GIT_COMMITTER_EMAIL: "gate@opsmind.test",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
}

/** A shell script's code, without its comments — these scripts explain
 *  themselves at length, and prose about a flag is not the flag. */
function uncommented(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function write(dir: string, relative: string, content: string): void {
  const target = path.join(dir, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/** An lcov report from `{ "lib/a.ts": { 3: 1, 4: 0 } }` — line, then hit count. */
function lcov(files: Record<string, Record<number, number>>): string {
  let out = "";
  for (const [file, lines] of Object.entries(files)) {
    const entries = Object.entries(lines);
    out += `TN:\nSF:${file}\nFNF:0\nFNH:0\n`;
    for (const [line, hits] of entries) out += `DA:${line},${hits}\n`;
    out += `LF:${entries.length}\n`;
    out += `LH:${entries.filter(([, hits]) => hits > 0).length}\n`;
    out += "end_of_record\n";
  }
  return out;
}

/** n numbered source lines, so a fixture's line numbers are readable. */
function body(n: number, tag = "stmt"): string {
  return `${Array.from({ length: n }, (_, i) => `const ${tag}${i + 1} = ${i + 1};`).join("\n")}\n`;
}

// A fixture baseline of zero, so that a test about diff coverage is not also a
// test about the ratchet. Every test that exercises the ratchet sets its own.
const DEFAULT_BASELINE = JSON.stringify({ tests: 1, coverage_bp: 0 });

interface Scenario {
  /** files committed on the base branch */
  base?: Record<string, string>;
  /** files written and committed on the task branch (the diff under measurement) */
  head?: Record<string, string>;
  /** coverage/lcov.info contents; omit the key entirely to write no report */
  report?: Record<string, Record<number, number>> | string | null;
  baseline?: string | null;
  backlog?: string;
  branch?: string;
}

function scenario(spec: Scenario): string {
  const dir = mkdtempSync(path.join(tmpdir(), "opsmind-covgate-"));
  temps.push(dir);
  // `git init -b main` needs git 2.28; the runner in runner/PROXMOX.md has
  // 2.25. symbolic-ref names the branch on any version.
  git(dir, ["init", "-q"]);
  git(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);

  write(dir, "tests/baseline.json", spec.baseline ?? DEFAULT_BASELINE);
  if (spec.backlog !== undefined) write(dir, "tasks/backlog.yaml", spec.backlog);
  for (const [file, content] of Object.entries(spec.base ?? {})) write(dir, file, content);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "base"]);

  git(dir, ["checkout", "-q", "-b", spec.branch ?? "task/demo"]);
  if (spec.head !== undefined) {
    for (const [file, content] of Object.entries(spec.head)) write(dir, file, content);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "task"]);
  }

  // Written after the commits and never committed, exactly as the real report
  // is: coverage/ is generated output that no diff ever contains.
  if (spec.report !== null && spec.report !== undefined) {
    write(dir, "coverage/lcov.info", typeof spec.report === "string" ? spec.report : lcov(spec.report));
  }
  // A baseline of `null` means the file must not exist at all.
  if (spec.baseline === null) rmSync(path.join(dir, "tests/baseline.json"), { force: true });
  return dir;
}

interface GateResult {
  code: number;
  out: string;
  /** the text following a gate label, e.g. line("diff-cov") */
  line: (label: string) => string;
}

function runGate(dir: string, floor: number | string, base = "main"): GateResult {
  const result = spawnSync(SCRIPT, [String(floor)], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GATE_BASE: base },
  });
  if (result.error !== undefined) throw result.error;
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return {
    code: result.status ?? -1,
    out,
    line: (label) =>
      out
        .split("\n")
        .filter((l) => l.startsWith(label))
        .join("\n"),
  };
}

// ---------------------------------------------------------------------------//
// Assertion 1 — measured on the lines the task changed, at 90 / 70
// ---------------------------------------------------------------------------//

describe("assertion 1 · the denominator is the changed lines, not the repository", () => {
  it("grades a task on its own lines while the repository sits far below the floor", () => {
    // The defect this task exists to fix: 100% of everything the task wrote,
    // against a repository at 79.20%, under a floor of 90.
    const dir = scenario({
      base: { "lib/a.ts": body(2) },
      head: { "lib/a.ts": body(2) + body(4, "added") },
      report: {
        "lib/a.ts": { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 },
        "lib/kernel/person/repository.ts": Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [i + 1, 0]),
        ),
      },
      baseline: JSON.stringify({ tests: 1, coverage_bp: 1000 }),
    });
    const result = runGate(dir, 90);
    expect(result.line("diff-cov"), result.out).toContain("100.00% of 4 changed line(s)");
    expect(result.code, result.out).toBe(0);
  });

  it("counts only lines the coverage report knows about, in the files that changed", () => {
    const dir = scenario({
      base: { "lib/a.ts": body(2) },
      head: { "lib/a.ts": body(2) + body(4, "added"), "lib/b.ts": body(3, "other") },
      // lib/b.ts is fully uncovered but is NOT in the diff... except it is, so
      // it must be counted. The line that must not be counted is lib/a.ts:7,
      // which no DA record mentions.
      report: {
        "lib/a.ts": { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 },
        "lib/b.ts": { 1: 1, 2: 1, 3: 1 },
      },
    });
    const result = runGate(dir, 90);
    expect(result.line("diff-cov"), result.out).toContain("of 7 changed line(s)");
  });

  it("passes at exactly the floor and fails one basis point below it", () => {
    const covered = (hit: number) =>
      Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 3, i < hit ? 1 : 0]));
    const at90 = scenario({
      base: { "lib/a.ts": body(2) },
      head: { "lib/a.ts": body(2) + body(10, "added") },
      report: { "lib/a.ts": { 1: 1, 2: 1, ...covered(9) } },
    });
    expect(runGate(at90, 90).code, runGate(at90, 90).out).toBe(0);

    const at80 = scenario({
      base: { "lib/a.ts": body(2) },
      head: { "lib/a.ts": body(2) + body(10, "added") },
      report: { "lib/a.ts": { 1: 1, 2: 1, ...covered(8) } },
    });
    const strict = runGate(at80, 90);
    expect(strict.code, strict.out).toBe(1);
    expect(strict.out).toContain("80.00%");
    expect(strict.out).toContain("floor is 90%");
  });

  it("the same diff that fails at 90 passes at 70 — risk chooses the floor", () => {
    const build = () =>
      scenario({
        base: { "lib/a.ts": body(2) },
        head: { "lib/a.ts": body(2) + body(10, "added") },
        report: {
          "lib/a.ts": {
            1: 1,
            2: 1,
            ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 3, i < 8 ? 1 : 0])),
          },
        },
      });
    expect(runGate(build(), 90).code).toBe(1);
    expect(runGate(build(), 70).code).toBe(0);
  });

  it("gate.sh maps risk to that floor and hands it to the coverage gate", () => {
    const source = readFileSync(GATE, "utf8");
    expect(source, "gate.sh no longer routes money|compliance to 90").toMatch(
      /money\|compliance\)\s*cov=90/,
    );
    expect(source, "gate.sh no longer routes low to 70").toMatch(/low\)\s*cov=70/);
    expect(source, "unknown risk must keep the strict path").toMatch(/\*\)\s*cov=90/);
    expect(source, "gate.sh does not call coverage-gate.sh with the floor").toMatch(
      /coverage-gate\.sh"?\s+"\$cov"/,
    );
  });

  it("gate.sh no longer applies the floor as a whole-repository vitest threshold", () => {
    const source = uncommented(readFileSync(GATE, "utf8"));
    expect(
      /--coverage\.thresholds\.lines/.test(source),
      "gate.sh still passes --coverage.thresholds.lines, which is the global " +
        "denominator this task removed (ADR-030)",
    ).toBe(false);
    expect(source, "gate.sh must still run vitest with --coverage to produce the report").toContain(
      "npx vitest run --coverage",
    );
  });
});

// ---------------------------------------------------------------------------//
// Assertion 2 — the total is a ratchet
// ---------------------------------------------------------------------------//

describe("assertion 2 · total coverage may not decrease", () => {
  const report = { "lib/a.ts": { 1: 1, 2: 1, 3: 1, 4: 0 } }; // 75.00%

  it("passes when the total is unchanged", () => {
    const dir = scenario({ report, baseline: JSON.stringify({ tests: 1, coverage_bp: 7500 }) });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(0);
    expect(result.line("total-cov")).toContain("75.00%");
  });

  it("passes when the total rises, and says the baseline should be bumped", () => {
    const dir = scenario({ report, baseline: JSON.stringify({ tests: 1, coverage_bp: 5000 }) });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain("bump");
    expect(result.out).toContain("7500");
  });

  it("reports the total as a percentage of the whole report, not of the diff", () => {
    const dir = scenario({
      base: { "lib/a.ts": body(1) },
      head: { "lib/a.ts": body(1) + body(1, "added") },
      report: {
        "lib/a.ts": { 1: 1, 2: 1 },
        "lib/kernel/person/repository.ts": { 1: 0, 2: 0 },
      },
      baseline: JSON.stringify({ tests: 1, coverage_bp: 5000 }),
    });
    expect(runGate(dir, 90).line("total-cov")).toContain("(2/4)");
  });
});

// ---------------------------------------------------------------------------//
// Assertion 3 — uncovered new code fails diff coverage
// ---------------------------------------------------------------------------//

describe("assertion 3 · a task adding uncovered new code fails", () => {
  it("fails, names the file and the uncovered lines, and prints the percentage", () => {
    const dir = scenario({
      base: { "lib/a.ts": body(2) },
      head: { "lib/a.ts": body(2), "lib/modules/new/thresholds.ts": body(5, "fresh") },
      report: {
        "lib/a.ts": { 1: 1, 2: 1 },
        "lib/modules/new/thresholds.ts": { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      },
    });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(1);
    expect(result.line("diff-cov")).toContain("FAIL");
    expect(result.out).toContain("0.00% of the 5 changed executable line(s)");
    expect(result.out).toContain("lib/modules/new/thresholds.ts:1-5");
  });

  it("fails even when the repository total is comfortably above the baseline", () => {
    // Diff coverage and the ratchet are independent. One uncovered new file
    // barely moves a large total, which is exactly the rot the diff check
    // catches and the ratchet would not.
    const bulk = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [i + 1, 1]));
    const dir = scenario({
      base: { "lib/big.ts": body(200) },
      head: { "lib/big.ts": body(200), "lib/new.ts": body(3, "fresh") },
      report: { "lib/big.ts": bulk, "lib/new.ts": { 1: 0, 2: 0, 3: 0 } },
      baseline: JSON.stringify({ tests: 1, coverage_bp: 5000 }),
    });
    const result = runGate(dir, 90);
    expect(result.line("total-cov"), result.out).not.toContain("FAIL");
    expect(result.line("diff-cov"), result.out).toContain("FAIL");
    expect(result.code).toBe(1);
  });
});

// ---------------------------------------------------------------------------//
// Assertion 4 — lowering the total fails the ratchet
// ---------------------------------------------------------------------------//

describe("assertion 4 · a task that lowers total coverage fails the ratchet", () => {
  it("fails and names both the baseline and the current value", () => {
    const dir = scenario({
      report: { "lib/a.ts": { 1: 1, 2: 0, 3: 0, 4: 0 } }, // 25.00%
      baseline: JSON.stringify({ tests: 1, coverage_bp: 7920 }),
    });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(1);
    expect(result.line("total-cov")).toContain("FAIL");
    expect(result.out).toContain("25.00%");
    expect(result.out).toContain("79.20%");
    expect(result.out).toContain("coverage_waiver");
  });

  it("fails the ratchet even when every changed line is covered", () => {
    const dir = scenario({
      base: { "lib/a.ts": body(1) },
      head: { "lib/a.ts": body(1) + body(2, "added") },
      report: { "lib/a.ts": { 1: 1, 2: 1, 3: 1 }, "lib/old.ts": { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
      baseline: JSON.stringify({ tests: 1, coverage_bp: 7920 }),
    });
    const result = runGate(dir, 90);
    expect(result.line("diff-cov"), result.out).toContain("100.00%");
    expect(result.line("total-cov"), result.out).toContain("FAIL");
    expect(result.code).toBe(1);
  });
});

// ---------------------------------------------------------------------------//
// Assertion 5 — an unreadable coverage report fails closed
// ---------------------------------------------------------------------------//

describe("assertion 5 · an unreadable coverage report fails closed", () => {
  it("fails BOTH gates when coverage/lcov.info is absent", () => {
    const dir = scenario({ report: null });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(1);
    expect(result.line("diff-cov")).toContain("FAIL");
    expect(result.line("total-cov")).toContain("FAIL");
    expect(result.out).toContain("nothing was measured");
  });

  it("fails when the report exists but is empty", () => {
    const dir = scenario({ report: "" });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(1);
    expect(result.line("diff-cov")).toContain("FAIL");
  });

  it("fails when the report parses but declares no measurable line", () => {
    const dir = scenario({ report: "TN:\nSF:lib/a.ts\nend_of_record\n" });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(1);
    expect(result.line("total-cov")).toContain("FAIL");
    expect(result.out).toContain("no DA:");
  });

  it("never prints a bare pass for a run that measured nothing", () => {
    const absent = runGate(scenario({ report: null }), 90);
    for (const label of ["diff-cov", "total-cov"]) {
      expect(absent.line(label), `${label} reported a pass with no report`).not.toMatch(
        /^\S+\s+pass\s*$/m,
      );
    }
  });

  it("fails closed when the diff base cannot be resolved", () => {
    const dir = scenario({ report: { "lib/a.ts": { 1: 1 } } });
    const result = runGate(dir, 90, "origin/does-not-exist");
    expect(result.code, result.out).toBe(1);
    expect(result.line("diff-cov")).toContain("FAIL");
    expect(result.out).toContain("cannot resolve");
  });

  it("fails closed when no usable floor is passed", () => {
    const dir = scenario({ report: { "lib/a.ts": { 1: 1 } } });
    for (const floor of ["", "ninety", "0", "-5"]) {
      const result = runGate(dir, floor);
      expect(result.code, `floor '${floor}' was accepted:\n${result.out}`).toBe(1);
      expect(result.out).toContain("floor");
    }
  });
});

// ---------------------------------------------------------------------------//
// Assertion 6 — a missing or unparseable baseline fails closed
// ---------------------------------------------------------------------------//

describe("assertion 6 · a missing or unparseable baseline fails closed", () => {
  const report = { "lib/a.ts": { 1: 1, 2: 1 } };

  it.each([
    ["absent", null],
    ["not JSON at all", "{{{ this is not json"],
    ["JSON without the key", JSON.stringify({ tests: 487 })],
    ["the key present but empty", '{"tests":1,"coverage_bp":}'],
    ["the key present but not a number", '{"tests":1,"coverage_bp":"seventy"}'],
  ])("fails when tests/baseline.json is %s", (_label, baseline) => {
    const dir = scenario({ report, baseline });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(1);
    expect(result.line("total-cov")).toContain("FAIL");
    expect(result.out).toContain("coverage_bp");
  });

  it("this repository's own baseline carries a numeric coverage_bp", () => {
    const parsed = JSON.parse(readFileSync(path.join(repoRoot, "tests/baseline.json"), "utf8")) as {
      coverage_bp?: unknown;
      tests?: unknown;
    };
    expect(typeof parsed.coverage_bp, "tests/baseline.json has no numeric coverage_bp").toBe(
      "number",
    );
    expect(typeof parsed.tests, "the test-count ratchet lost its floor").toBe("number");
    expect(parsed.coverage_bp as number).toBeGreaterThan(0);
    expect(parsed.coverage_bp as number).toBeLessThanOrEqual(10000);
  });
});

// ---------------------------------------------------------------------------//
// Assertion 7 — the waiver requires a reason, and is printed when in use
// ---------------------------------------------------------------------------//

const backlogWith = (lines: string[]): string =>
  ["- id: other-task", "  risk: low", "- id: demo", "  risk: low", ...lines, ""].join("\n");

describe("assertion 7 · the coverage waiver", () => {
  const report = { "lib/a.ts": { 1: 1, 2: 0, 3: 0, 4: 0 } }; // 25.00%

  it("lowers the floor and is printed with its reason when granted", () => {
    const dir = scenario({
      report,
      baseline: JSON.stringify({ tests: 1, coverage_bp: 7920 }),
      backlog: backlogWith([
        "  coverage_waiver: 2000",
        "  coverage_waiver_reason: >",
        "    the payroll module was deleted and its covered lines with it",
      ]),
    });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(0);
    expect(result.line("cov-waiver")).toContain("the payroll module was deleted");
    expect(result.line("cov-waiver")).toContain("20.00%");
    expect(result.line("total-cov")).not.toContain("FAIL");
  });

  it("fails when the waiver carries no reason", () => {
    const dir = scenario({
      report,
      backlog: backlogWith(["  coverage_waiver: 2000"]),
    });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(1);
    expect(result.out).toContain("coverage_waiver_reason");
  });

  it("fails when the reason is present but blank", () => {
    const dir = scenario({
      report,
      backlog: backlogWith(["  coverage_waiver: 2000", '  coverage_waiver_reason: "   "']),
    });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(1);
    expect(result.out).toContain("coverage_waiver_reason");
  });

  it.each(["", "lots", "79.2", "-1"])("fails when the waiver value is '%s'", (value) => {
    const dir = scenario({
      report,
      backlog: backlogWith([
        `  coverage_waiver: ${value === "" ? "" : value}`,
        "  coverage_waiver_reason: >",
        "    a reason that must not rescue a malformed number",
      ]),
    });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(1);
    expect(result.out).toContain("refusing to guess a floor");
  });

  it("never reads a waiver from a branch that is not task/<id>", () => {
    const dir = scenario({
      report,
      branch: "chore/tidy",
      baseline: JSON.stringify({ tests: 1, coverage_bp: 7920 }),
      backlog: backlogWith([
        "  coverage_waiver: 2000",
        "  coverage_waiver_reason: >",
        "    belongs to the demo task, not to this branch",
      ]),
    });
    const result = runGate(dir, 90);
    expect(result.line("total-cov"), result.out).toContain("FAIL");
    expect(result.out).not.toContain("belongs to the demo task");
  });

  it("prints nothing about a waiver when no node declares one", () => {
    const dir = scenario({
      report: { "lib/a.ts": { 1: 1, 2: 1, 3: 1, 4: 1 } },
      backlog: backlogWith([]),
    });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(0);
    expect(result.out).not.toContain("cov-waiver");
  });
});

// ---------------------------------------------------------------------------//
// Assertion 8 — no path is excluded to make the gate pass
// ---------------------------------------------------------------------------//

describe("assertion 8 · repositories stay measured", () => {
  const vitestConfig = readFileSync(path.join(repoRoot, "vitest.config.ts"), "utf8");

  it("coverage.include still covers lib/**", () => {
    expect(vitestConfig).toContain('include: ["lib/**/*.ts"');
  });

  it("coverage.exclude names no repository, no kernel path and no module path", () => {
    // The exclude list is read from `exclude: [ ... ]` inside the coverage
    // block. Everything legitimately there is legacy code, node_modules, build
    // output or test files — none of it is code this build is judged on.
    const block = /coverage:\s*\{[\s\S]*?exclude:\s*\[([\s\S]*?)\]/.exec(vitestConfig)?.[1] ?? "";
    expect(block, "could not find coverage.exclude in vitest.config.ts").not.toBe("");
    for (const forbidden of ["repository", "kernel", "lib/modules", "lib/"]) {
      expect(
        block.includes(forbidden),
        `vitest.config.ts excludes '${forbidden}' from coverage. Repositories are what ` +
          "payroll and the money spine read through, and an excluded file is one nobody " +
          "looks at again — raising them is kernel-repository-integration-tests.",
      ).toBe(false);
    }
  });

  it("the gate scripts filter no path out of the measurement", () => {
    for (const script of [SCRIPT, GATE]) {
      const code = uncommented(readFileSync(script, "utf8"));
      expect(
        /repository\.ts/.test(code),
        `${path.basename(script)} names repository.ts in code — the gate must not ` +
          "special-case a path to reach its floor",
      ).toBe(false);
    }
  });

  it("an uncovered repository still drags the measured total down", () => {
    // The proof that nothing is filtered: a fixture whose only uncovered file
    // is a kernel repository must fail the ratchet, not be waved through.
    const dir = scenario({
      report: {
        "lib/a.ts": { 1: 1, 2: 1 },
        "lib/kernel/person/repository.ts": { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
      },
      baseline: JSON.stringify({ tests: 1, coverage_bp: 7920 }),
    });
    const result = runGate(dir, 90);
    expect(result.line("total-cov"), result.out).toContain("FAIL");
    expect(result.out).toContain("25.00%");
  });

  it("a repository changed by the task is measured like any other file", () => {
    const dir = scenario({
      base: { "lib/kernel/person/repository.ts": body(2) },
      head: { "lib/kernel/person/repository.ts": body(2) + body(4, "added") },
      report: { "lib/kernel/person/repository.ts": { 1: 1, 2: 1, 3: 0, 4: 0, 5: 0, 6: 0 } },
    });
    const result = runGate(dir, 90);
    expect(result.line("diff-cov"), result.out).toContain("FAIL");
    expect(result.out).toContain("lib/kernel/person/repository.ts:3-6");
  });
});

// ---------------------------------------------------------------------------//
// Assertion 9 — a diff with no coverable lines passes, and says so
// ---------------------------------------------------------------------------//

describe("assertion 9 · a diff with no coverable lines", () => {
  const report = { "lib/a.ts": { 1: 1, 2: 1, 3: 1, 4: 0 } };

  it.each([
    ["documentation only", { "docs/architecture/decisions.md": "# ADR-030\n\nprose\n" }],
    ["tests only", { "tests/gates/thing.test.ts": body(20, "t") }],
    ["a workflow", { ".github/workflows/gates.yml": "name: gates\non: push\n" }],
    ["a backlog node", { "tasks/backlog.yaml": "- id: demo\n  risk: low\n" }],
  ])("passes on a %s change", (_label, head) => {
    const dir = scenario({ base: { "lib/a.ts": body(4) }, head, report });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(0);
    expect(result.line("diff-cov")).toContain("no coverable lines changed");
  });

  it("says so rather than printing a bare pass", () => {
    const dir = scenario({
      base: { "lib/a.ts": body(4) },
      head: { "README.md": "# opsmind\n" },
      report,
    });
    const result = runGate(dir, 90);
    expect(result.line("diff-cov"), "a docs change printed a bare 'pass'").not.toMatch(
      /^diff-cov\s+pass\s*$/m,
    );
    expect(result.line("diff-cov")).toContain("added line(s)");
  });

  it("does not count added lines the report has no DA record for", () => {
    // Comments, blank lines, type-only declarations. A task that adds forty
    // lines of explanation to a covered file must not fail for documenting
    // itself.
    const dir = scenario({
      base: { "lib/a.ts": body(4) },
      head: { "lib/a.ts": `${body(4)}// a comment\n// another\n\n// a third\n` },
      report,
    });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(0);
    expect(result.line("diff-cov")).toContain("no coverable lines changed");
    expect(result.line("diff-cov")).toContain("4 added line(s)");
  });

  it("a diff that only deletes lines has nothing to cover", () => {
    const dir = scenario({
      base: { "lib/a.ts": body(4), "lib/gone.ts": body(3, "old") },
      report,
    });
    rmSync(path.join(dir, "lib/gone.ts"), { force: true });
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "delete"]);
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(0);
    expect(result.line("diff-cov")).toContain("no coverable lines changed");
  });

  it("is not fooled by a fixture whose content looks like a diff header", () => {
    // `+++ b/lib/evil.ts` as file CONTENT must not be read as a file header;
    // reading it as one would attribute the next hunk to the wrong file.
    const dir = scenario({
      base: { "lib/a.ts": body(2) },
      head: {
        "lib/a.ts": body(2) + body(2, "added"),
        "tests/fixture.txt": "--- a/lib/evil.ts\n+++ b/lib/evil.ts\n@@ -1,0 +1,9 @@\n",
      },
      report: { "lib/a.ts": { 1: 1, 2: 1, 3: 1, 4: 1 }, "lib/evil.ts": { 1: 0, 2: 0, 3: 0 } },
    });
    const result = runGate(dir, 90);
    expect(result.line("diff-cov"), result.out).toContain("of 2 changed line(s)");
    expect(result.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------//
// Assertion 10 — a branch that resolves no task still passes on a clean main
// ---------------------------------------------------------------------------//

describe("assertion 10 · a branch that resolves no task", () => {
  it("passes the coverage gate on the strict path with an empty diff", () => {
    // The old shape: a chore branch resolves no node, gate.sh takes the strict
    // path and demands 90, and the whole-repository number is 79.20. Two chore
    // branches had to be given a backlog node purely to get through.
    const dir = scenario({
      base: { "lib/a.ts": body(4) },
      branch: "chore/tidy-the-readme",
      report: { "lib/a.ts": { 1: 1, 2: 1, 3: 1, 4: 0 } },
      baseline: JSON.stringify({ tests: 1, coverage_bp: 7500 }),
    });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(0);
    expect(result.line("diff-cov")).toContain("no coverable lines changed");
    expect(result.line("total-cov")).toContain("75.00%");
  });

  it("still fails that branch if it lowers the total", () => {
    // Resolving no task buys a branch nothing on the ratchet — it is a property
    // of the repository, not of the task.
    const dir = scenario({
      base: { "lib/a.ts": body(4) },
      branch: "chore/tidy-the-readme",
      report: { "lib/a.ts": { 1: 1, 2: 0, 3: 0, 4: 0 } },
      baseline: JSON.stringify({ tests: 1, coverage_bp: 7500 }),
    });
    expect(runGate(dir, 90).code).toBe(1);
  });

  it("still fails that branch if it adds uncovered code", () => {
    const dir = scenario({
      base: { "lib/a.ts": body(4) },
      branch: "chore/tidy-the-readme",
      head: { "lib/a.ts": body(4), "lib/sneaky.ts": body(3, "s") },
      report: { "lib/a.ts": { 1: 1, 2: 1, 3: 1, 4: 1 }, "lib/sneaky.ts": { 1: 0, 2: 0, 3: 0 } },
      baseline: JSON.stringify({ tests: 1, coverage_bp: 1000 }),
    });
    expect(runGate(dir, 90).code).toBe(1);
  });
});

// ---------------------------------------------------------------------------//
// The gate script itself
// ---------------------------------------------------------------------------//

describe("scripts/coverage-gate.sh", () => {
  it("exists and is executable", () => {
    expect(existsSync(SCRIPT), "scripts/coverage-gate.sh is missing").toBe(true);
    const mode = spawnSync("test", ["-x", SCRIPT]);
    expect(mode.status, "scripts/coverage-gate.sh is not executable").toBe(0);
  });

  it("prints its gate lines in gate.sh's column format", () => {
    const dir = scenario({ report: { "lib/a.ts": { 1: 1, 2: 1, 3: 1, 4: 0 } } });
    const result = runGate(dir, 90);
    for (const line of result.out.split("\n").filter((l) => l !== "" && !l.startsWith("    "))) {
      expect(line, `'${line}' is not in the %-14s label column format`).toMatch(
        /^[a-z-]+ {2,}\S/,
      );
    }
  });

  it("fails closed rather than crashing on a report full of nonsense", () => {
    const dir = scenario({ report: " not\nan\nlcov\nfile\n@@ -1 +1 @@\n" });
    const result = runGate(dir, 90);
    expect(result.code, result.out).toBe(1);
  });
});
