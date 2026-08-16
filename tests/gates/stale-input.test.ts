// Assertions for the `gate-stale-input-refusal` backlog task:
//
//   1. "gate.sh prints the commit SHA it measured on every run, pass or fail, in
//       the gate column format"
//   2. "An uncommitted change to a file the gate measures fails the run and names
//       the file"
//   3. "An untracked file in a measured path counts as dirty"
//   4. "--summary refuses on a stale tree exactly as the full suite does"
//   5. "A change confined to a path the gate does not measure still runs — it
//       does not over-refuse"
//   6. "The refusal exits before any other gate prints a verdict"
//
// HOW THESE ARE DRIVEN. scripts/gate.sh is run for real against fixture
// repositories built in temp directories, exactly as tests/gates/
// coverage-gate.test.ts drives scripts/coverage-gate.sh. A guard nobody has
// watched refuse is not a verified guard, so almost every check below is on
// observed output and an observed exit code rather than on the script's text.
//
// WHY --summary CARRIES THE CLEAN CASES. The refusal exits before any other gate
// runs, so a DIRTY fixture is fast in either mode and both are exercised. A
// CLEAN fixture is not: the full suite would run `npx eslint .`, `npx tsc` and
// `npx vitest` inside a temp directory with no node_modules, which npx answers
// by downloading the world. The clean-tree cases therefore run `--summary`,
// which reaches the same printing code — the commit line is emitted before the
// mode branch — and the full suite on a clean tree is evidenced by running it on
// this repository, which is what the task's captured output records.
//
// POLARITY. Every behaviour is pinned in both directions. Dirty refuses AND
// clean runs; an untracked file refuses AND an ignored one does not; a measured
// path refuses AND package-lock.json does not. A one-sided suite is satisfied by
// a gate that refuses everything, which is exactly as useless as one that passes
// everything and considerably more annoying.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE = path.join(repoRoot, "scripts", "gate.sh");
const gateSource = readFileSync(GATE, "utf8");

const temps: string[] = [];
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
 * A repository with one commit on `main`, then a `task/demo` branch carrying one
 * more. `dirty` is written AFTER both commits and never committed — that is the
 * stale input the gate has to notice. `staged` is written and `git add`ed but
 * left uncommitted, which is the same mistake one step further along.
 */
interface Fixture {
  committed?: Record<string, string>;
  dirty?: Record<string, string>;
  staged?: Record<string, string>;
  branch?: string;
}

function fixture(spec: Fixture = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "opsmind-stale-"));
  temps.push(dir);
  // `git init -b main` needs git 2.28; symbolic-ref names the branch on any
  // version, as tests/gates/coverage-gate.test.ts already has to do.
  git(dir, ["init", "-q"]);
  git(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  write(dir, "lib/a.ts", "export const a = 1;\n");
  write(dir, "package-lock.json", '{"lockfileVersion":3}\n');
  write(dir, ".gitignore", "coverage/\nnode_modules\n.task-current.yaml\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "base"]);

  git(dir, ["checkout", "-q", "-b", spec.branch ?? "task/demo"]);
  write(dir, "lib/b.ts", "export const b = 2;\n");
  for (const [file, content] of Object.entries(spec.committed ?? {})) write(dir, file, content);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "task"]);

  for (const [file, content] of Object.entries(spec.staged ?? {})) write(dir, file, content);
  if (spec.staged !== undefined) git(dir, ["add", "-A"]);
  for (const [file, content] of Object.entries(spec.dirty ?? {})) write(dir, file, content);
  return dir;
}

function headSha(dir: string): string {
  return git(dir, ["rev-parse", "--short", "HEAD"]).trim();
}

interface GateResult {
  code: number;
  out: string;
  /** the text of every line starting with a gate label */
  line: (label: string) => string;
}

// GITHUB_HEAD_REF is stripped for the reason coverage-gate.test.ts strips it:
// CI sets it for the whole job, so it would win inside every fixture below and
// each one would resolve the OUTER branch instead of the branch it created.
function runGate(dir: string, mode: "full" | "--summary" = "--summary", cwd = dir): GateResult {
  const { GITHUB_HEAD_REF: _ignored, ...cleanEnv } = process.env;
  const result = spawnSync(GATE, [mode], {
    cwd,
    encoding: "utf8",
    env: { ...cleanEnv, ...GIT_ENV, GATE_BASE: "main" },
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

const MODES = ["full", "--summary"] as const;

// ---------------------------------------------------------------------------//
// Assertion 1 — the subject is stated on every run
// ---------------------------------------------------------------------------//

describe("assertion 1 · every run names the commit it measured", () => {
  it.each(MODES)("prints the real HEAD sha on a clean tree in %s mode", (mode) => {
    // A clean tree in full mode would npx-download a toolchain into a temp dir,
    // so the clean pass is taken in --summary; the dirty run below proves the
    // line is printed in full mode too, since it is printed before the branch.
    const dir = fixture();
    const result = runGate(dir, mode === "full" ? "--summary" : mode);
    expect(result.line("commit"), result.out).toContain(headSha(dir));
    expect(result.code, result.out).toBe(0);
  });

  it("prints it on a FAILING run too, which is when the subject matters most", () => {
    const dir = fixture({ dirty: { "lib/a.ts": "export const a = 99;\n" } });
    for (const mode of MODES) {
      const result = runGate(dir, mode);
      expect(result.code, result.out).toBe(1);
      expect(result.line("commit"), `${mode}: a failing run named no commit\n${result.out}`).toContain(
        headSha(dir),
      );
    }
  });

  it("names the branch and the base it measured against", () => {
    const dir = fixture({ branch: "task/some-node" });
    const result = runGate(dir);
    expect(result.line("commit")).toContain("task/some-node");
    expect(result.line("commit"), "the base the diff is taken against is not stated").toContain(
      "main",
    );
  });

  it("moves with HEAD — the sha is read, not a constant", () => {
    // A hardcoded or base-derived value would satisfy every check above. This is
    // the one that cannot be: two commits, two different shas, both reported.
    const dir = fixture();
    const first = runGate(dir).line("commit");
    write(dir, "lib/c.ts", "export const c = 3;\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "second"]);
    const second = runGate(dir).line("commit");
    expect(second).not.toBe(first);
    expect(second).toContain(headSha(dir));
  });

  it("sits in the same %-14s label column as the other gate lines", () => {
    // "reads as one suite" is the requirement, and a column is what makes it
    // one. Compared against a sibling line rather than a hardcoded 14, so the
    // check survives the whole suite being reformatted together and fails the
    // moment this one line drifts out of step with its neighbours.
    const result = runGate(fixture());
    const column = (label: string): number => {
      const found = result.out.split("\n").find((l) => l.startsWith(label));
      expect(found, `no '${label}' line in:\n${result.out}`).toBeDefined();
      return /^\S+\s+/.exec(found as string)?.[0].length ?? -1;
    };
    expect(result.line("commit")).toMatch(/^commit {2,}\S/);
    expect(column("commit"), "the commit line is not in the size-impl column").toBe(
      column("size-impl"),
    );
  });
});

// ---------------------------------------------------------------------------//
// Assertion 2 — an uncommitted change to a measured file refuses, by name
// ---------------------------------------------------------------------------//

describe("assertion 2 · a dirty measured file refuses and is named", () => {
  it.each(MODES)("refuses in %s mode, naming the file and saying why", (mode) => {
    const dir = fixture({ dirty: { "lib/a.ts": "export const a = 99;\n" } });
    const result = runGate(dir, mode);
    expect(result.code, result.out).toBe(1);
    expect(result.line("worktree"), result.out).toContain("FAIL");
    expect(result.out, "the offending file is not named").toContain("lib/a.ts");
    expect(result.out.toLowerCase()).toContain("dirty");
    expect(result.out, "the reason — that it measures the committed diff — is unstated").toMatch(
      /committed diff/i,
    );
  });

  it("names every offending file, not just the first", () => {
    const dir = fixture({
      dirty: {
        "lib/a.ts": "export const a = 99;\n",
        "docs/architecture/decisions.md": "# ADR-031\n",
        "tasks/backlog.yaml": "- id: demo\n",
      },
    });
    const result = runGate(dir);
    for (const file of ["lib/a.ts", "docs/architecture/decisions.md", "tasks/backlog.yaml"]) {
      expect(result.out, `${file} was not named in the refusal`).toContain(file);
    }
  });

  it("refuses a change that is staged but not committed", () => {
    // `git add` is not `git commit`. The committed diff still does not contain
    // it, so the gate would still measure a tree nobody has.
    const dir = fixture({ staged: { "lib/a.ts": "export const a = 42;\n" } });
    const result = runGate(dir);
    expect(result.code, result.out).toBe(1);
    expect(result.out).toContain("lib/a.ts");
  });

  it("refuses a deletion as readily as an edit", () => {
    const dir = fixture();
    rmSync(path.join(dir, "lib/b.ts"));
    const result = runGate(dir);
    expect(result.code, result.out).toBe(1);
    expect(result.out).toContain("lib/b.ts");
  });

  it("refuses a dirty file outside lib/ and tests/ — including the gate itself", () => {
    // The narrow rule "refuse only for lib/ and tests/" would have passed the
    // exact defect that produced this task: the change under measurement was
    // scripts/gate.sh, and size-total counts every line of it.
    const dir = fixture({ dirty: { "scripts/gate.sh": "#!/usr/bin/env bash\n" } });
    const result = runGate(dir);
    expect(result.code, result.out).toBe(1);
    expect(result.out).toContain("scripts/gate.sh");
  });

  it("sees a dirty file at the root when run from a subdirectory", () => {
    // Without :(top) the status pathspec is resolved against the shell's
    // directory, so a run from a subtree reports only that subtree and a dirty
    // file elsewhere goes unseen. Under-refusing reproduces the defect.
    const dir = fixture({ dirty: { "lib/a.ts": "export const a = 99;\n" } });
    mkdirSync(path.join(dir, "app/api"), { recursive: true });
    const result = runGate(dir, "--summary", path.join(dir, "app/api"));
    expect(result.code, result.out).toBe(1);
    expect(result.out, "a dirty root file was invisible from a subdirectory").toContain("lib/a.ts");
  });
});

// ---------------------------------------------------------------------------//
// Assertion 3 — an untracked file in a measured path counts
// ---------------------------------------------------------------------------//

describe("assertion 3 · untracked files in a measured path", () => {
  it("refuses, naming the file rather than its directory", () => {
    // The file is deliberately in a directory git has never seen. Without
    // -uall, status collapses that to `?? brand/new/` and the refusal names a
    // folder — which is the same defect one level up, a message that does not
    // say what it measured.
    const dir = fixture();
    write(dir, "brand/new/thing.ts", "export const t = 1;\n");
    const result = runGate(dir);
    expect(result.code, result.out).toBe(1);
    expect(result.out, "the untracked file was named only by its directory").toContain(
      "brand/new/thing.ts",
    );
  });

  it("refuses an untracked test file, which the next commit will make measured", () => {
    const dir = fixture();
    write(dir, "tests/gates/stale-input.test.ts", "// pending\n");
    expect(runGate(dir).code).toBe(1);
  });
});

// ---------------------------------------------------------------------------//
// Assertion 5 — it does not over-refuse
//
// A gate that refuses everything is as useless as one that passes everything,
// and considerably easier to write. These are the cases that must still run.
// ---------------------------------------------------------------------------//

describe("assertion 5 · a path the gate does not measure still runs", () => {
  it("runs with an uncommitted package-lock.json, and says the change is unmeasured", () => {
    // Excluded from size-impl and size-total by the nolock pathspec and never
    // selected by coverage.include, so committing it moves no printed number.
    const dir = fixture({ dirty: { "package-lock.json": '{"lockfileVersion":3,"x":1}\n' } });
    const result = runGate(dir);
    expect(result.code, result.out).toBe(0);
    expect(result.out, "a lockfile edit was treated as a stale input").not.toContain("worktree");
    expect(result.line("changed"), result.out).toContain("none in a measured path");
  });

  it("runs with the gate's own output sitting in the tree", () => {
    // coverage/ is written by cov-report during the run itself. A gate that
    // refused because of its own output could never pass.
    const dir = fixture();
    write(dir, "coverage/lcov.info", "TN:\nSF:lib/a.ts\nDA:1,1\nend_of_record\n");
    const result = runGate(dir);
    expect(result.code, result.out).toBe(0);
    expect(result.out).not.toContain("worktree");
  });

  it("runs with .task-current.yaml present, which is deliberately never committed", () => {
    const dir = fixture();
    write(dir, ".task-current.yaml", "risk: low\n");
    expect(runGate(dir).code, "the gate refused over its own uncommitted input").toBe(0);
  });

  it("runs on a wholly clean tree and reaches the gates below", () => {
    const result = runGate(fixture());
    expect(result.code, result.out).toBe(0);
    expect(result.line("boundaries"), result.out).toContain("pass");
    expect(result.line("size-impl"), result.out).toContain("400");
    expect(result.line("size-total"), result.out).toContain("1500");
  });
});

// ---------------------------------------------------------------------------//
// Assertions 4 and 6 — the refusal is total, and identical in --summary
// ---------------------------------------------------------------------------//

describe("assertions 4 and 6 · the refusal stops the suite", () => {
  it.each(MODES)("prints no other gate verdict in %s mode", (mode) => {
    const dir = fixture({ dirty: { "lib/a.ts": "export const a = 99;\n" } });
    const result = runGate(dir, mode);
    // boundaries is the first gate the suite runs, before either mode branches.
    // If it reported, the refusal did not refuse — it merely complained.
    expect(result.line("boundaries"), `a verdict was printed past the refusal:\n${result.out}`).toBe(
      "",
    );
    for (const label of ["lint", "types", "tests", "risk", "size-impl", "size-total"]) {
      expect(result.line(label), `${label} reported past the refusal:\n${result.out}`).toBe("");
    }
  });

  it("the summary and the full suite refuse identically bar the mode argument", () => {
    const dir = fixture({ dirty: { "lib/a.ts": "export const a = 99;\n" } });
    const full = runGate(dir, "full");
    const summary = runGate(dir, "--summary");
    expect(summary.out, "--summary was given a softer refusal than the full suite").toBe(full.out);
    expect(summary.code).toBe(full.code);
  });

  it("the refusal is not conditional on the mode in the source", () => {
    // The Stop hook calls --summary after every turn, so this is where the
    // temptation to soften it lands. The behavioural check above is the real
    // one; this catches a softening written but not yet reached by a fixture.
    const block = /measured_dirty=[\s\S]*?\nfi\n/.exec(gateSource)?.[0] ?? "";
    expect(block, "could not find the refusal block in scripts/gate.sh").not.toBe("");
    expect(/\$\{?mode/.test(block), "the refusal branches on $mode — it must not").toBe(false);
  });

  it("the refusal is positioned ahead of the first gate in the source", () => {
    const refusal = gateSource.indexOf("measured_dirty=");
    const boundaries = gateSource.indexOf('run "boundaries"');
    expect(refusal, "scripts/gate.sh no longer computes a dirty set").toBeGreaterThan(-1);
    expect(boundaries).toBeGreaterThan(-1);
    expect(refusal, "the refusal runs after a gate has already reported").toBeLessThan(boundaries);
  });
});

// ---------------------------------------------------------------------------//
// The record
// ---------------------------------------------------------------------------//

describe("the decision is recorded", () => {
  const decisions = readFileSync(path.join(repoRoot, "docs/architecture/decisions.md"), "utf8");

  it("ADR-031 exists and states the generalising rule", () => {
    expect(decisions).toContain("### ADR-031");
    const record = decisions.slice(decisions.indexOf("### ADR-031"));
    expect(record, "the generalising rule is not stated").toMatch(
      /state[sd]? what it measured[\s\S]{0,200}refuse/i,
    );
  });

  it("cites all four instances of the pattern", () => {
    const record = decisions.slice(decisions.indexOf("### ADR-031"));
    for (const [what, re] of [
      ["the stale baseline read", /stale baseline/i],
      ["gates=FAILURE treated as terminal", /gates=FAILURE/],
      ["the empty diff reading as green", /empty diff/i],
      ["this one — a gate run before its commit", /2,?746/],
    ] as const) {
      expect(re.test(record), `ADR-031 does not cite ${what}`).toBe(true);
    }
  });

  it("states the workflow cost rather than only the benefit", () => {
    const record = decisions.slice(decisions.indexOf("### ADR-031"));
    expect(record, "the cost of losing the mid-edit read is not recorded").toMatch(/mid-edit/i);
  });
});
