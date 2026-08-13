// Assertions for the `staging-deploy` backlog task:
//
//   1. "Compose runs app + postgres + nginx; app image builds from the Dockerfile"
//   2. "deploy-staging.yml triggers on push to main and runs ONLY on a runner
//       labeled staging"
//   3. "prisma migrate deploy runs on every deploy before the app starts"
//   4. "No secret appears in the compose file or the workflow — all via an env
//       file on the VM"
//
// plus the one line from runner/PROXMOX.md:101-105 that still holds — no runner
// VM ever mounts /var/run/docker.sock into a job container.
//
// These are written from runner/PROXMOX.md and the task node, not from the
// files. The three files are read as DATA at runtime; they are the subject
// under test, so they are the fixture.
//
// PARSING: YAML is parsed with js-yaml, which is resolvable in node_modules as
// a transitive dependency of eslint. It is deliberately NOT added to
// package.json. If a future eslint stops pulling it in, the guard below fails
// loudly rather than silently skipping every YAML assertion.
//
// SECRET HYGIENE: the secret scanners report a file and a pattern NAME only.
// They never print the matched value — a failing test's message goes straight
// into the CI log, and a scanner that echoes what it found leaks the very thing
// it exists to catch.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const DOCKERFILE = "Dockerfile";
const COMPOSE = "docker-compose.staging.yml";
const WORKFLOW = ".github/workflows/deploy-staging.yml";

// ------------------------------------------------------------------ loading --

function readRequired(relative: string): string {
  const absolute = path.join(repoRoot, relative);
  if (!existsSync(absolute)) {
    throw new Error(
      `${relative} does not exist. The staging-deploy task must produce it ` +
        `(see runner/PROXMOX.md, "VM 2 · opsmind-stg").`,
    );
  }
  const text = readFileSync(absolute, "utf8");
  if (text.trim() === "") throw new Error(`${relative} exists but is empty.`);
  return text;
}

interface YamlModule {
  load: (input: string) => unknown;
}

function yamlLoader(): YamlModule {
  const require_ = createRequire(import.meta.url);
  try {
    return require_("js-yaml") as YamlModule;
  } catch {
    throw new Error(
      "js-yaml is not resolvable in node_modules, so the YAML under test cannot " +
        "be parsed structurally. It normally arrives transitively via eslint. Do " +
        "not delete these assertions to get green — restore a YAML parser.",
    );
  }
}

function loadYaml(relative: string): unknown {
  const text = readRequired(relative);
  try {
    return yamlLoader().load(text);
  } catch (error) {
    // js-yaml's message embeds a snippet of the offending line. That line may
    // hold a credential, so only the reason and position are surfaced.
    const reason = (error as { reason?: string }).reason ?? "unparseable";
    const mark = (error as { mark?: { line?: number; column?: number } }).mark;
    throw new Error(
      `${relative} is not valid YAML: ${reason}` +
        (mark ? ` at line ${(mark.line ?? 0) + 1}, column ${(mark.column ?? 0) + 1}` : ""),
    );
  }
}

// ------------------------------------------------------------- yaml helpers --

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Every string scalar in the tree, with the key it hangs off and its path. */
interface Scalar {
  path: string;
  key: string;
  value: string;
}

function walkStrings(node: unknown, trail: string[] = [], out: Scalar[] = []): Scalar[] {
  if (typeof node === "string") {
    out.push({ path: trail.join("."), key: trail[trail.length - 1] ?? "", value: node });
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkStrings(item, [...trail, String(i)], out));
    return out;
  }
  if (isRec(node)) {
    for (const [key, value] of Object.entries(node)) walkStrings(value, [...trail, key], out);
  }
  return out;
}

// -------------------------------------------------------- compose accessors --

interface ComposeService {
  name: string;
  raw: Rec;
}

function composeServices(): ComposeService[] {
  const doc = loadYaml(COMPOSE);
  if (!isRec(doc)) throw new Error(`${COMPOSE} does not parse to a mapping.`);
  const services = doc.services;
  if (!isRec(services)) {
    throw new Error(`${COMPOSE} declares no top-level \`services:\` mapping.`);
  }
  return Object.entries(services).map(([name, raw]) => ({
    name,
    raw: isRec(raw) ? raw : {},
  }));
}

/** Absolute path of the Dockerfile a service builds from, if it builds at all. */
function buildDockerfile(service: ComposeService): string | undefined {
  const build = service.raw.build;
  if (build === undefined) return undefined;
  if (typeof build === "string") return path.resolve(repoRoot, build, "Dockerfile");
  if (!isRec(build)) return undefined;
  const context = str(build.context) ?? ".";
  const dockerfile = str(build.dockerfile) ?? "Dockerfile";
  return path.resolve(repoRoot, context, dockerfile);
}

function imageOf(service: ComposeService): string {
  return str(service.raw.image) ?? "";
}

/** Host ports this service publishes, both short and long `ports:` syntax. */
function publishedHostPorts(service: ComposeService): number[] {
  const ports: number[] = [];
  for (const entry of asList(service.raw.ports)) {
    if (typeof entry === "number") {
      // `ports: [8080]` publishes a random host port for container 8080
      ports.push(entry);
      continue;
    }
    if (typeof entry === "string") {
      // "80:80" | "0.0.0.0:80:80" | "127.0.0.1:80:80/tcp" | "3000"
      const [spec] = entry.split("/");
      const parts = (spec ?? "").split(":");
      if (parts.length === 1) {
        // container-only form: no fixed host port, but still published
        const only = Number.parseInt(parts[0] ?? "", 10);
        if (!Number.isNaN(only)) ports.push(only);
        continue;
      }
      const host = parts[parts.length - 2] ?? "";
      const parsed = Number.parseInt(host.split("-")[0] ?? "", 10);
      if (!Number.isNaN(parsed)) ports.push(parsed);
      continue;
    }
    if (isRec(entry)) {
      const published = entry.published;
      const parsed =
        typeof published === "number"
          ? published
          : Number.parseInt(String(published ?? "").split("-")[0] ?? "", 10);
      if (!Number.isNaN(parsed)) ports.push(parsed);
    }
  }
  return ports;
}

/** `depends_on` in both the list form and the condition-map form. */
function dependsOn(service: ComposeService): Map<string, string | undefined> {
  const result = new Map<string, string | undefined>();
  const raw = service.raw.depends_on;
  if (Array.isArray(raw)) {
    for (const name of raw) if (typeof name === "string") result.set(name, undefined);
    return result;
  }
  if (isRec(raw)) {
    for (const [name, spec] of Object.entries(raw)) {
      result.set(name, isRec(spec) ? str(spec.condition) : undefined);
    }
  }
  return result;
}

/** command + entrypoint of a service, flattened to one searchable string. */
function serviceRunText(service: ComposeService): string {
  const parts: string[] = [];
  for (const key of ["entrypoint", "command"]) {
    const value = service.raw[key];
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) parts.push(value.filter((v) => typeof v === "string").join(" "));
  }
  return parts.join("\n");
}

function findService(services: ComposeService[], predicate: (s: ComposeService) => boolean) {
  return services.filter(predicate);
}

const IS_POSTGRES = (s: ComposeService) =>
  /(^|\/)(postgres|postgis)(:|$)/i.test(imageOf(s)) || /^(postgres|postgresql|pg|db)$/i.test(s.name);
const IS_NGINX = (s: ComposeService) =>
  /(^|\/)nginx(:|$)/i.test(imageOf(s)) || /^(nginx|proxy|web|edge)$/i.test(s.name);
const BUILDS_APP = (s: ComposeService) =>
  buildDockerfile(s) === path.join(repoRoot, DOCKERFILE) && !IS_NGINX(s);

/**
 * The app service(s). Identified by building from the repo Dockerfile, which is
 * the property assertion 1 wants — but with a name fallback, because otherwise
 * a stack that pulls a prebuilt image would have NO app service and every
 * app-scoped assertion below would pass vacuously while the stack was wrong.
 */
function appServices(services: ComposeService[]): ComposeService[] {
  const builders = services.filter(BUILDS_APP);
  if (builders.length > 0) return builders;
  return services.filter((s) => /^(app|web|opsmind|next|server)$/i.test(s.name));
}

// ------------------------------------------------------- workflow accessors --

interface WorkflowJob {
  id: string;
  raw: Rec;
}

function workflowDoc(): Rec {
  const doc = loadYaml(WORKFLOW);
  if (!isRec(doc)) throw new Error(`${WORKFLOW} does not parse to a mapping.`);
  return doc;
}

/** The `on:` block. YAML 1.1 parsers fold `on` to the boolean true; handle both. */
function triggers(doc: Rec): unknown {
  return doc.on ?? (doc as Record<string, unknown>)["true"] ?? doc.On ?? doc.ON;
}

function workflowJobs(doc: Rec): WorkflowJob[] {
  const jobs = doc.jobs;
  if (!isRec(jobs)) throw new Error(`${WORKFLOW} declares no \`jobs:\` mapping.`);
  return Object.entries(jobs).map(([id, raw]) => ({ id, raw: isRec(raw) ? raw : {} }));
}

interface RunsOn {
  labels: string[];
  /** true when the value is a `${{ }}` expression that cannot be read statically */
  dynamic: boolean;
}

/**
 * `runs-on` has three legal shapes and this assertion is worthless if it only
 * understands one:
 *   runs-on: staging
 *   runs-on: [self-hosted, staging]
 *   runs-on: { group: g, labels: [self-hosted, staging] }
 * A `${{ ... }}` expression is reported as dynamic rather than as "no labels",
 * because "no labels found" must never read as "the staging label is absent in
 * a way I can prove".
 */
function runsOn(job: WorkflowJob): RunsOn {
  const raw = job.raw["runs-on"];
  const collect = (value: unknown): string[] =>
    asList(value)
      .filter((v): v is string => typeof v === "string" || typeof v === "number")
      .map((v) => String(v).trim())
      .filter((v) => v !== "");

  let tokens: string[];
  if (isRec(raw)) tokens = [...collect(raw.labels), ...collect(raw.group)];
  else tokens = collect(raw);

  return {
    labels: tokens,
    dynamic: tokens.some((t) => t.includes("${{")),
  };
}

interface Step {
  index: number;
  jobId: string;
  raw: Rec;
  run: string;
  uses: string;
}

function jobSteps(job: WorkflowJob): Step[] {
  return asList(job.raw.steps)
    .filter(isRec)
    .map((raw, index) => ({
      index,
      jobId: job.id,
      raw,
      run: str(raw.run) ?? "",
      uses: str(raw.uses) ?? "",
    }));
}

function allSteps(doc: Rec): Step[] {
  return workflowJobs(doc).flatMap(jobSteps);
}

// ----------------------------------------------------- dockerfile accessors --

interface Heredoc {
  tag: string;
  /** for `COPY <<EOF /path`, the path the body is written to inside the image */
  target?: string;
  body: string;
}

interface DockerInstruction {
  instruction: string;
  args: string;
  heredocs: Heredoc[];
}

/**
 * Logical instructions, with `\`-continuations joined, comments dropped and
 * heredoc bodies captured.
 *
 * Heredocs matter for more than tidiness: `COPY <<'EOF' /usr/local/bin/x`
 * writes a script that exists only inside the image, with no file in the repo
 * to find. Treated as prose it is invisible; treated as an instruction body it
 * is exactly what the container runs.
 */
function dockerInstructions(): DockerInstruction[] {
  const lines = readRequired(DOCKERFILE).split(/\r?\n/);
  const out: DockerInstruction[] = [];
  let i = 0;

  while (i < lines.length) {
    const first = lines[i] ?? "";
    if (/^\s*(#|$)/.test(first)) {
      i += 1;
      continue;
    }

    // join `\`-continuations into one logical line
    let logical = "";
    for (;;) {
      const line = (lines[i] ?? "").replace(/\s+$/, "");
      i += 1;
      if (/\\$/.test(line)) {
        logical += `${line.replace(/\\$/, "")} `;
        if (i >= lines.length) break;
        continue;
      }
      logical += line;
      break;
    }

    // `<<EOF`, `<<-EOF`, `<<'EOF'`, `<<"EOF"` — possibly several on one line
    const tags = [...logical.matchAll(/<<-?(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g)].map(
      (m) => m[2] ?? "",
    );
    const heredocs: Heredoc[] = [];
    for (const tag of tags) {
      const body: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim() !== tag) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // the terminator itself
      const target = logical
        .split(/\s+/)
        .slice(1)
        .find((token) => !token.includes("<<") && !token.startsWith("-"));
      heredocs.push({ tag, target, body: body.join("\n") });
    }

    const match = /^\s*([A-Za-z]+)\s+([\s\S]*)$/.exec(logical);
    if (match) {
      out.push({
        instruction: (match[1] ?? "").toUpperCase(),
        args: (match[2] ?? "").trim(),
        heredocs,
      });
    }
  }
  return out;
}

/**
 * Shell comments removed, the shebang kept — `#!/bin/sh -e` is how a script
 * declares it aborts on error, which is load-bearing for the ordering proof.
 */
function stripShellComments(text: string): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 && line.startsWith("#!") ? line : line.replace(/#.*$/, "")))
    .join("\n");
}

/** The Dockerfile's instructions and heredoc bodies — comments prove nothing. */
function dockerfileCode(): string {
  return dockerInstructions()
    .map((i) =>
      [`${i.instruction} ${i.args}`, ...i.heredocs.map((h) => stripShellComments(h.body))].join(
        "\n",
      ),
    )
    .join("\n");
}

/** JSON-array or shell form of CMD/ENTRYPOINT, flattened to a searchable string. */
function execArgs(args: string): string {
  const trimmed = args.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).join(" ");
    } catch {
      /* fall through to the shell form */
    }
  }
  return trimmed;
}

// -------------------------------------------------------------------------- //
// Assertion 1 — compose runs app + postgres + nginx, app builds from Dockerfile
// -------------------------------------------------------------------------- //

describe("assertion 1 · the staging stack", () => {
  it("Dockerfile exists and declares a build stage", () => {
    const instructions = dockerInstructions();
    const froms = instructions.filter((i) => i.instruction === "FROM");
    expect(froms.length, "Dockerfile declares no FROM instruction").toBeGreaterThan(0);
  });

  it("the app image is built on Node 20, matching the CI gates and CLAUDE.md", () => {
    const froms = dockerInstructions().filter((i) => i.instruction === "FROM");
    const nodeStages = froms.filter((i) => /(^|\/)node:/i.test(i.args));
    expect(
      nodeStages.length,
      `no FROM node:... stage in the Dockerfile (stages: ${froms.map((f) => f.args).join(", ")})`,
    ).toBeGreaterThan(0);
    for (const stage of nodeStages) {
      const version = /(^|\/)node:v?(\d+)/i.exec(stage.args)?.[2];
      expect(version, `\`FROM ${stage.args}\` pins no explicit Node major`).toBeDefined();
      expect(
        version,
        `\`FROM ${stage.args}\` builds on Node ${version ?? "?"}; the gates run Node 20`,
      ).toBe("20");
    }
  });

  it("the compose file declares services", () => {
    expect(composeServices().length, `${COMPOSE} declares no services`).toBeGreaterThan(0);
  });

  it("the app image is built from the repo's Dockerfile", () => {
    // At least one, not exactly one: a migrator sharing the app image by
    // declaring the same build is a legitimate shape, and the spec asks that
    // the app be BUILT here, not that only one service builds.
    const services = composeServices();
    const builders = findService(services, BUILDS_APP);
    expect(
      builders.length,
      `no service builds from ./Dockerfile — the app must be built from this ` +
        `repo, not pulled as a prebuilt image (services: ${services
          .map((s) => s.name)
          .join(", ")})`,
    ).toBeGreaterThanOrEqual(1);
  });

  it("the app service does not pull a prebuilt image instead of building", () => {
    const app = appServices(composeServices())[0];
    expect(app, "no app service found").toBeDefined();
    // `image:` alongside `build:` is only a tag name, which is fine. What is not
    // fine is an app service with an image and no build at all.
    expect(app?.raw.build, "the app service has no `build:` key").toBeDefined();
  });

  it("runs a postgres service", () => {
    const services = composeServices();
    const pg = findService(services, IS_POSTGRES);
    expect(
      pg.map((s) => s.name),
      `no postgres service in ${COMPOSE} (services: ${services.map((s) => s.name).join(", ")})`,
    ).not.toHaveLength(0);
  });

  it("pins the postgres image to an explicit tag, never `latest`", () => {
    for (const pg of findService(composeServices(), IS_POSTGRES)) {
      const image = imageOf(pg);
      expect(image, `service \`${pg.name}\` has no image`).not.toBe("");
      const tag = image.includes(":") ? image.slice(image.lastIndexOf(":") + 1) : "";
      expect(tag, `service \`${pg.name}\` uses \`${image}\` with no tag`).not.toBe("");
      expect(tag, `service \`${pg.name}\` uses \`${image}\``).not.toBe("latest");
    }
  });

  it("gives postgres a volume, so a redeploy does not wipe the staging data", () => {
    // PROXMOX.md:80-82 expects anonymised-but-realistic data to live on this VM
    // and be worth backing up nightly. An anonymous container filesystem is not.
    for (const pg of findService(composeServices(), IS_POSTGRES)) {
      const volumes = asList(pg.raw.volumes);
      expect(volumes.length, `postgres service \`${pg.name}\` mounts no volume`).toBeGreaterThan(0);
      const mountsData = volumes.some((v) => {
        const text = typeof v === "string" ? v : isRec(v) ? String(v.target ?? "") : "";
        return /\/var\/lib\/postgresql\/data/.test(text);
      });
      expect(mountsData, `postgres service \`${pg.name}\` does not persist its data dir`).toBe(true);
    }
  });

  it("runs an nginx service", () => {
    const services = composeServices();
    expect(
      findService(services, IS_NGINX).map((s) => s.name),
      `no nginx service in ${COMPOSE} (services: ${services.map((s) => s.name).join(", ")})`,
    ).not.toHaveLength(0);
  });

  it("nginx fronts the app: nginx publishes the host port and the app does not", () => {
    const services = composeServices();
    const nginx = findService(services, IS_NGINX);
    const app = appServices(services);
    expect(nginx.length, "no nginx service").toBeGreaterThan(0);
    expect(app.length, "no app service").toBeGreaterThan(0);

    const nginxPorts = nginx.flatMap(publishedHostPorts);
    expect(nginxPorts.length, "nginx publishes no host port, so nothing reaches it").toBeGreaterThan(
      0,
    );
    for (const service of app) {
      expect(
        publishedHostPorts(service),
        `app service \`${service.name}\` publishes a host port, which bypasses nginx entirely`,
      ).toHaveLength(0);
    }
  });

  it("nginx declares its dependency on the app service", () => {
    const services = composeServices();
    const appNames = appServices(services).map((s) => s.name);
    for (const nginx of findService(services, IS_NGINX)) {
      const deps = [...dependsOn(nginx).keys()];
      expect(
        appNames.some((name) => deps.includes(name)),
        `nginx service \`${nginx.name}\` has depends_on [${deps.join(", ")}] and does ` +
          `not name the app service (${appNames.join(", ")})`,
      ).toBe(true);
    }
  });
});

// -------------------------------------------------------------------------- //
// Assertion 2 — push to main, and ONLY on a runner labeled staging
// -------------------------------------------------------------------------- //

describe("assertion 2 · trigger and runner placement", () => {
  it("triggers on push", () => {
    const on = triggers(workflowDoc());
    expect(on, `${WORKFLOW} declares no \`on:\` block`).toBeDefined();
    const hasPush = isRec(on)
      ? Object.keys(on).includes("push")
      : asList(on).includes("push") || on === "push";
    expect(hasPush, `${WORKFLOW} does not trigger on push`).toBe(true);
  });

  it("restricts the push trigger to main, so a feature branch cannot deploy", () => {
    const on = triggers(workflowDoc());
    expect(isRec(on), "`on:` is not a mapping, so no branch filter can be declared").toBe(true);
    const push = isRec(on) ? on.push : undefined;
    expect(isRec(push), "`on.push` carries no branch filter — every branch would deploy").toBe(true);

    const branches = isRec(push) ? asList(push.branches).map(String) : [];
    expect(branches.length, "`on.push.branches` is empty — every branch would deploy").toBeGreaterThan(
      0,
    );
    expect(branches, `on.push.branches is [${branches.join(", ")}]`).toContain("main");
    for (const branch of branches) {
      expect(
        /^\*+$/.test(branch),
        `on.push.branches contains \`${branch}\`, which matches every branch`,
      ).toBe(false);
    }
  });

  it("declares at least one job", () => {
    expect(workflowJobs(workflowDoc()).length, `${WORKFLOW} declares no jobs`).toBeGreaterThan(0);
  });

  it("every job carries the `staging` label in runs-on", () => {
    // PROXMOX.md:62-73 — the staging runner is the ONLY runner with this label,
    // and the gates runner is `self-hosted` without it. A bare `self-hosted`
    // here lands the deploy on the ci-runner VM.
    for (const job of workflowJobs(workflowDoc())) {
      const { labels, dynamic } = runsOn(job);
      expect(labels.length, `job \`${job.id}\` declares no runs-on labels`).toBeGreaterThan(0);
      expect(
        dynamic && !labels.some((l) => l.toLowerCase().includes("staging")),
        `job \`${job.id}\` selects its runner with a \`\${{ }}\` expression ` +
          `(${labels.join(", ")}); the staging label cannot be guaranteed statically`,
      ).toBe(false);
      expect(
        labels.map((l) => l.toLowerCase()),
        `job \`${job.id}\` runs on [${labels.join(", ")}]`,
      ).toContain("staging");
    }
  });

  it("no job can be scheduled on a GitHub-hosted runner", () => {
    const hosted = /^(ubuntu|windows|macos)-/i;
    for (const job of workflowJobs(workflowDoc())) {
      for (const label of runsOn(job).labels) {
        expect(
          hosted.test(label),
          `job \`${job.id}\` names hosted runner image \`${label}\`; the deploy must ` +
            "run on the staging VM, which is where the env file and the stack live",
        ).toBe(false);
      }
    }
  });
});

// -------------------------------------------------------------------------- //
// Assertion 3 — prisma migrate deploy, every deploy, before the app serves
// -------------------------------------------------------------------------- //

const APP_START =
  /\b(next\s+start|npm\s+(run\s+)?start|node\s+server\.js|node\s+[^\s]*\/?server\.js|yarn\s+start|pnpm\s+start)\b/;
const COMPOSE_UP = /docker(\s+compose|-compose)[^\n]*\bup\b/;

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "coverage", "reference", "dist"]);

/** First file in the repo with this basename. The Dockerfile names scripts by
 *  their path INSIDE the image, which says nothing about where they live here. */
function findRepoFile(basename: string, dir = repoRoot, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const found = findRepoFile(basename, path.join(dir, entry.name), depth + 1);
      if (found !== undefined) return found;
    } else if (entry.name === basename) {
      return path.join(dir, entry.name);
    }
  }
  return undefined;
}

/**
 * Every script the image can execute, keyed by BOTH its path inside the image
 * and its basename, because a command names it whichever way it likes.
 *
 * Three sources: a heredoc body the Dockerfile writes to a path, a repo `.sh`
 * file the Dockerfile copies in, and a repo `.sh` file named anywhere in an
 * instruction. A script that exists only as a heredoc has no repo file to find,
 * so basename resolution alone would never see it.
 */
function scriptRegistry(): Map<string, string> {
  const registry = new Map<string, string>();
  const register = (key: string, body: string) => {
    if (key === "") return;
    registry.set(key, body);
    registry.set(path.basename(key), body);
  };

  for (const instruction of dockerInstructions()) {
    for (const heredoc of instruction.heredocs) {
      if (instruction.instruction !== "COPY" && instruction.instruction !== "ADD") continue;
      if (heredoc.target !== undefined) register(heredoc.target, heredoc.body);
    }
    if (!["ENTRYPOINT", "CMD", "COPY", "ADD", "RUN"].includes(instruction.instruction)) continue;

    const tokens = execArgs(instruction.args)
      .split(/\s+/)
      .map((t) => t.replace(/^["'[]+|["'\],]+$/g, ""))
      .filter((t) => /\.(sh|bash)$/.test(t));
    // `COPY entrypoint.sh /usr/local/bin/entrypoint` — the destination name is
    // what the command line will say, so both ends get registered.
    for (const token of tokens) {
      const found = findRepoFile(path.basename(token));
      if (found === undefined) continue;
      const body = readFileSync(found, "utf8");
      register(token, body);
      if (instruction.instruction === "COPY" || instruction.instruction === "ADD") {
        const destination = execArgs(instruction.args).split(/\s+/).pop() ?? "";
        register(destination.replace(/^["'[]+|["'\],]+$/g, ""), body);
      }
    }
  }
  return registry;
}

/** Text of any script the container can execute, as ordering evidence. */
function entrypointScriptTexts(): Array<{ label: string; text: string }> {
  const out = new Map<string, string>();
  for (const [key, body] of scriptRegistry()) out.set(key, stripShellComments(body));
  return [...out.entries()].map(([label, text]) => ({ label, text }));
}

/**
 * Command text with one round of indirection resolved: `npm run x` becomes the
 * body of that script, `./deploy.sh` becomes the contents of that script.
 * Substituting inline keeps the ordering readable — `./migrate.sh && npm start`
 * expands to a chain that still shows migrate before start. Without this, an
 * implementation that puts the migration in a script would look like an
 * implementation that has no migration at all.
 */
function expandIndirections(text: string, depth = 0): string {
  if (depth > 2) return text;
  let out = text;

  const scripts = (() => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts ?? {};
  })();

  out = out.replace(
    /\b(?:npm|pnpm|yarn)\s+(?:run\s+|run-script\s+)?([A-Za-z0-9:_-]+)/g,
    (match, name: string) => {
      const body = scripts[name];
      return body === undefined ? match : ` ( ${expandIndirections(body, depth + 1)} ) `;
    },
  );

  out = out.replace(/(?:^|[\s;&|"'(])((?:\.\/|[\w./-]*\/)?[\w.-]+\.(?:sh|bash))\b/g, (match, file: string) => {
    const found = findRepoFile(path.basename(file));
    if (found === undefined) return match;
    return `${match} ( ${expandIndirections(readFileSync(found, "utf8"), depth + 1)} ) `;
  });

  return out;
}

// ------------------------------------------- recognising the Prisma CLI call --
//
// `prisma migrate deploy` is an argv shape, not a string. The subcommand can
// arrive as separate argv entries through a wrapper — `["px", "migrate",
// "deploy"]` where px execs the Prisma CLI with "$@" — and a scan for the
// contiguous phrase sees nothing at all. So: match the tokens `migrate deploy`
// in that order, then prove the thing receiving them IS the Prisma CLI.
//
// The proof is the part with teeth. `prisma generate` must never satisfy
// assertion 3, and neither must a wrapper whose behaviour cannot be followed.
// An invocation whose command does not resolve is reported as UNRESOLVED, and
// an unresolved invocation fails loudly instead of being assumed benign.

interface Token {
  text: string;
  start: number;
  end: number;
}

/** Punctuation is blanked in place, so every offset still indexes the input. */
function tokenize(text: string): Token[] {
  const flat = text.replace(/[[\],"']/g, " ");
  return [...flat.matchAll(/\S+/g)].map((m) => ({
    text: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
}

/** `prisma`, `node_modules/.bin/prisma`, `node …/prisma/build/index.js`. */
function isPrismaCli(token: string): boolean {
  return /(^|\/)prisma$/.test(token) || /prisma\/build\/index\.js$/.test(token);
}

/** Tokens after which the next word starts a new command. */
const COMMAND_SEPARATOR = new Set([";", ";;", "&&", "||", "|", "|&", "&", "(", "{", "then", "do", "else", "!"]);
/** Words that take a command as their argument: `exec prisma "$@"` runs prisma. */
const COMMAND_PREFIX = new Set(["exec", "command", "env", "nohup", "time", "builtin"]);
/** Interpreters whose FIRST argument is the program: `node …/prisma/… "$@"`. */
const LAUNCHER = /(^|\/)(node|nodejs|npx|pnpx|bunx)$/;
const SHELL_CLI = /(^|\/)(sh|bash|dash|ash|zsh|ksh)$/;

/** Two tokens separated by nothing but quote characters are one shell word:
 *  `tokenize` blanks the quotes in place, so `VAR="$X"` arrives as two. */
const SAME_WORD = /^['"]+$/;

/**
 * True when the token at `index` is argv[0] of a command rather than a word
 * inside somebody else's argument list — the difference between a script that
 * RUNS the Prisma CLI and one that PRINTS the words `prisma "$@"` in a log
 * line, which `tokenize` renders as near-identical token streams because it
 * blanks quotes in place.
 *
 * Whitespace is read back out of the source text rather than the token stream,
 * because `tokenize` discards it, and in a shell script a newline is the
 * commonest command separator there is. That is also this function's known
 * limit: a newline INSIDE a quoted string reads as a command separator too, so
 * a multi-line `echo "usage:\nprisma $@"` is still taken for an invocation.
 * Deliberately not chased — it needs a wrapper that prints and does nothing
 * else, and every shape a real implementation drifts into is caught.
 *
 * The shapes accepted are the ones that genuinely execute the token: start of
 * body, after a separator, after `exec`/`env`, after a `VAR=x` prefix, as the
 * first argument of `node`/`npx`, and as the `-c` argument of a shell. `echo`,
 * `printf` and every other command take their arguments as data.
 */
function isCommandPosition(text: string, tokens: Token[], index: number): boolean {
  let sawDashC = false;
  for (let i = index - 1; i >= 0; i -= 1) {
    const token = tokens[i]?.text ?? "";
    if (token === "\\") continue; // a line continuation is not a word
    const before = i > 0 ? text.slice(tokens[i - 1]?.end ?? 0, tokens[i]?.start ?? 0) : " ";
    // glued to the token on its left, so it is that word's tail, not a word
    if (SAME_WORD.test(before)) continue;
    const after = text.slice(tokens[i]?.end ?? 0, tokens[i + 1]?.start ?? 0);
    if (after.includes("\n")) return true;
    if (COMMAND_SEPARATOR.has(token)) return true;
    if (COMMAND_PREFIX.has(token)) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue; // `DATABASE_URL=… prisma "$@"`
    if (token.startsWith("-")) {
      if (/^-[a-z]*c$/.test(token)) sawDashC = true;
      continue;
    }
    // `node node_modules/prisma/build/index.js "$@"` — the launcher must itself
    // be in command position, so `echo node …/prisma/… "$@"` still fails.
    if (LAUNCHER.test(token)) return isCommandPosition(text, tokens, i);
    // `sh -c 'exec prisma "$@"'` — the -c argument really is a command context.
    return sawDashC && SHELL_CLI.test(token);
  }
  return true;
}

/**
 * A wrapper counts only if it hands its OWN argv straight to the Prisma CLI.
 * `exec node …/prisma/build/index.js "$@"` does. A wrapper that runs
 * `prisma generate` and ignores "$@" does not, and must not be able to make a
 * `migrate deploy` argv look like a migration.
 *
 * The adjacency must be in COMMAND POSITION. A wrapper that only logs
 * `echo "skipping 'prisma $*'"` forwards nothing; certifying it on the strength
 * of a string it prints is how a wrapper that never migrates gets a green tick.
 */
function passesArgvToPrisma(body: string): boolean {
  const text = stripShellComments(body);
  const tokens = tokenize(text);
  return tokens.some(
    (token, i) =>
      isPrismaCli(token.text) &&
      ["$@", "$*", "${@}", "${*}"].includes(tokens[i + 1]?.text ?? "") &&
      isCommandPosition(text, tokens, i),
  );
}

const WORD_NOISE = new Set(["(", ")", ";", "&&", "||", "|", "&", "then", "do", "exec", "\\", "sh"]);

/** argv[0] for the token at `index`, stepping over flags and inlined groups. */
function commandBefore(tokens: Token[], index: number): string {
  let i = index - 1;
  while (i >= 0) {
    const token = tokens[i]?.text ?? "";
    if (token === ")") {
      // an expansion this test inlined; skip the whole group
      let depth = 1;
      i -= 1;
      while (i >= 0 && depth > 0) {
        const inner = tokens[i]?.text ?? "";
        if (inner === ")") depth += 1;
        if (inner === "(") depth -= 1;
        i -= 1;
      }
      continue;
    }
    if (token.startsWith("-") || WORD_NOISE.has(token)) {
      i -= 1;
      continue;
    }
    return token;
  }
  return "";
}

function resolvesToPrismaCli(command: string, registry: Map<string, string>): boolean {
  if (command === "") return false;
  if (isPrismaCli(command)) return true;
  const body = registry.get(command) ?? registry.get(path.basename(command));
  if (body !== undefined) return passesArgvToPrisma(body);
  const inRepo = findRepoFile(path.basename(command));
  if (inRepo !== undefined) return passesArgvToPrisma(readFileSync(inRepo, "utf8"));
  return false;
}

interface MigrateInvocation {
  command: string;
  resolved: boolean;
  start: number;
  end: number;
}

function findMigrateInvocations(text: string): MigrateInvocation[] {
  const registry = scriptRegistry();
  const tokens = tokenize(text);
  const found: MigrateInvocation[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (tokens[i]?.text !== "migrate" || tokens[i + 1]?.text !== "deploy") continue;
    const command = commandBefore(tokens, i);
    found.push({
      command,
      resolved: resolvesToPrismaCli(command, registry),
      start: tokens[i]?.start ?? 0,
      end: tokens[i + 1]?.end ?? 0,
    });
  }
  return found;
}

function migratesHere(text: string): boolean {
  return findMigrateInvocations(expandIndirections(text)).some((i) => i.resolved);
}

/** A blob orders a resolved migration before `start` AND stops if it fails. */
function ordersMigrateBeforeStart(raw: string, start: RegExp = APP_START): boolean {
  const text = expandIndirections(raw);
  for (const invocation of findMigrateInvocations(text)) {
    if (!invocation.resolved) continue;
    const rest = text.slice(invocation.end);
    const startAt = rest.search(start);
    if (startAt < 0) continue;
    // `&&` chains, or a script that aborts on error. `;` or `&` would start the
    // app even when the migration failed, which is the race this forbids.
    if (/&&/.test(rest.slice(0, startAt)) || abortsOnError(text)) return true;
  }
  return false;
}

function abortsOnError(text: string): boolean {
  return (
    /^\s*set\s+-[a-z]*e/m.test(text) ||
    /\bset\s+-o\s+errexit\b/.test(text) ||
    /^#!.*\s-[a-z]*e\b/.test(text)
  );
}

/** Every string VALUE in a YAML file, with shell comments stripped. Comments
 *  describe intent; they do not run. An assertion satisfied by a comment is
 *  satisfied by nothing. */
function yamlCode(relative: string): string {
  return walkStrings(loadYaml(relative))
    .map((s) => s.value)
    .join("\n")
    .replace(/#[^\n]*/g, "");
}

describe("assertion 3 · migrations run before the app serves traffic", () => {
  it("`prisma migrate deploy` is invoked somewhere in the deploy path", () => {
    const blobs = [
      dockerfileCode(),
      yamlCode(COMPOSE),
      yamlCode(WORKFLOW),
      ...entrypointScriptTexts().map((s) => s.text),
    ].map((text) => expandIndirections(text));
    const invocations = blobs.flatMap(findMigrateInvocations);
    const unresolved = [...new Set(invocations.filter((i) => !i.resolved).map((i) => i.command))];

    expect(
      invocations.filter((i) => i.resolved).length,
      invocations.length === 0
        ? "no `migrate deploy` invocation in the Dockerfile, the compose file, the " +
          "workflow, any heredoc they write or any script they reference"
        : "`migrate deploy` is passed to [" +
          `${unresolved.join(", ")}], which cannot be shown to be the Prisma CLI. ` +
          "The invocation is UNRESOLVABLE, not proven absent — but an unfollowable " +
          "indirection cannot count as evidence that migrations run.",
    ).toBeGreaterThan(0);
  });

  it("migrations never run at image build time", () => {
    // A migration baked into `docker build` runs against whatever database the
    // builder can reach, or none at all, and then never runs on deploy.
    for (const instruction of dockerInstructions()) {
      if (instruction.instruction !== "RUN") continue;
      const text = [instruction.args, ...instruction.heredocs.map((h) => h.body)].join("\n");
      expect(
        findMigrateInvocations(expandIndirections(text)).length,
        "a Dockerfile RUN step executes `migrate deploy` at build time",
      ).toBe(0);
    }
  });

  it("the ordering is structural, not a race or a sleep", () => {
    const services = composeServices();
    const apps = appServices(services);
    const doc = workflowDoc();
    const steps = allSteps(doc);
    const reasons: string[] = [];

    // Shape A — a dedicated migrate service the app waits to COMPLETE.
    const migrateServices = services.filter((s) => migratesHere(serviceRunText(s)));
    const shapeA = apps.some((app) =>
      migrateServices.some((migrate) => {
        if (migrate.name === app.name) return false;
        return dependsOn(app).get(migrate.name) === "service_completed_successfully";
      }),
    );
    if (!shapeA) {
      reasons.push(
        `A: no app service depends_on a migrate service with ` +
          `condition: service_completed_successfully (migrate-shaped services: ` +
          `${migrateServices.map((s) => s.name).join(", ") || "none"})`,
      );
    }

    // Shape B — the app container migrates then starts, in that order, aborting
    // on failure: compose command/entrypoint, Dockerfile CMD/ENTRYPOINT, or an
    // entrypoint script in the repo.
    const inContainer: string[] = [
      ...services.map(serviceRunText),
      ...dockerInstructions()
        .filter((i) => i.instruction === "CMD" || i.instruction === "ENTRYPOINT")
        .map((i) => execArgs(i.args)),
      ...entrypointScriptTexts().map((s) => s.text),
    ];
    const shapeB = inContainer.some((text) => ordersMigrateBeforeStart(text));
    if (!shapeB) {
      reasons.push(
        "B: no container command, entrypoint or entrypoint script runs " +
          "`prisma migrate deploy` before the app start command with `&&` or `set -e`",
      );
    }

    // Shape C — a workflow step migrates, and a LATER step brings the app up;
    // or one step does both, in that order, aborting if the migration fails.
    const runs = steps.map((s) => expandIndirections(s.run));
    const migrateStep = runs.findIndex((run) => findMigrateInvocations(run).some((i) => i.resolved));
    const upStep = runs.findIndex((run) => COMPOSE_UP.test(run) || APP_START.test(run));
    const shapeC =
      (migrateStep >= 0 && upStep > migrateStep) ||
      steps.some((s) => ordersMigrateBeforeStart(s.run, new RegExp(`${COMPOSE_UP.source}|${APP_START.source}`)));
    if (!shapeC) {
      reasons.push(
        `C: no workflow step runs \`prisma migrate deploy\` before the step that ` +
          `brings the stack up (migrate step: ${migrateStep}, up step: ${upStep})`,
      );
    }

    expect(
      shapeA || shapeB || shapeC,
      `migrations are not ordered before the app serves traffic:\n  ${reasons.join("\n  ")}`,
    ).toBe(true);
  });

  it("a migrate service the app waits on is waited on for COMPLETION", () => {
    // `service_started` would let the app boot the instant the migrator's
    // container exists — before a single migration has applied.
    const services = composeServices();
    const migrateNames = services.filter((s) => migratesHere(serviceRunText(s))).map((s) => s.name);
    for (const app of appServices(services)) {
      for (const [dep, condition] of dependsOn(app)) {
        if (!migrateNames.includes(dep) || dep === app.name) continue;
        expect(
          condition,
          `app \`${app.name}\` waits on migrate service \`${dep}\` with ` +
            `condition \`${condition ?? "none"}\``,
        ).toBe("service_completed_successfully");
      }
    }
  });

  // Both tests below have to look at the COMPOSE surface as well as the
  // workflow. Where the migration lives in a compose service reached by
  // `docker compose up`, no workflow step ever mentions `migrate deploy`, and a
  // loop that only walks workflow steps runs its body zero times — passing
  // whatever the compose file says.
  //
  // `migrateReach` is therefore: every migrate-shaped compose service, plus
  // every workflow step that either invokes the migration itself or brings up
  // the stack that does.
  interface MigrateReach {
    migrateServices: ComposeService[];
    migrateSteps: Step[];
    upSteps: Step[];
  }

  function migrateReach(): MigrateReach {
    const services = composeServices();
    const migrateServices = services.filter((s) => migratesHere(serviceRunText(s)));
    const steps = allSteps(workflowDoc());
    return {
      migrateServices,
      migrateSteps: steps.filter(
        (s) => findMigrateInvocations(expandIndirections(s.run)).length > 0,
      ),
      upSteps: migrateServices.length > 0 ? steps.filter((s) => COMPOSE_UP.test(s.run)) : [],
    };
  }

  /**
   * `|| true`, `|| :`, `|| exit 0` — a failed migration reported as a success.
   *
   * The boundary sits inside each alternative rather than after the group. `:`
   * is a non-word character, so a trailing `\b` can never match it: `|| :` is
   * the POSIX no-op, the most natural way to write this, and a group-level
   * `\b` silently makes that branch unreachable.
   */
  const SWALLOWS = /(^|[^|&])\|\|\s*(true\b|exit\s+0\b|:(?=[\s;&|]|$))/;

  it("the migration never has its failure swallowed", () => {
    const { migrateServices, migrateSteps, upSteps } = migrateReach();
    expect(
      migrateServices.length + migrateSteps.length,
      "nothing in the compose file or the workflow runs `migrate deploy`, so this " +
        "assertion would pass by having nothing to check",
    ).toBeGreaterThan(0);

    for (const step of [...migrateSteps, ...upSteps]) {
      expect(
        step.raw["continue-on-error"],
        `the step in job \`${step.jobId}\` that reaches the migration is ` +
          "continue-on-error, so a failed migration would still be followed by a deploy",
      ).not.toBe(true);
      expect(
        SWALLOWS.test(step.run),
        `the step in job \`${step.jobId}\` that reaches the migration swallows failure ` +
          "with `|| true`, `|| :` or `|| exit 0`",
      ).toBe(false);
    }

    // The dependency edge proves the app WAITS for the migrator to finish. It
    // proves nothing about what finishing meant. A migrate command that cannot
    // fail exits 0 on a failed migration, satisfies
    // `service_completed_successfully`, and the app starts on a half-migrated
    // schema — which is worse than not migrating at all, because it looks fine.
    for (const migrate of migrateServices) {
      const run = serviceRunText(migrate);
      expect(
        SWALLOWS.test(run),
        `migrate service \`${migrate.name}\` swallows failure (\`|| true\`, \`|| :\` or ` +
          "`|| exit 0`): it exits 0 on a failed migration, so waiting for it to complete " +
          "successfully proves nothing",
      ).toBe(false);
      expect(
        /\bset\s+\+e\b/.test(run),
        `migrate service \`${migrate.name}\` turns off errexit with \`set +e\``,
      ).toBe(false);
    }
  });

  it("nothing gates the migration on a human decision — it runs on every deploy", () => {
    const doc = workflowDoc();
    const humanControlled = /github\.event(?!_name\s*==\s*'push')|inputs\.|vars\.|secrets\./;
    const { migrateServices, migrateSteps, upSteps } = migrateReach();
    const reaching = new Set([...migrateSteps, ...upSteps]);
    let carriers = 0;

    for (const job of workflowJobs(doc)) {
      const jobReaching = jobSteps(job).filter((step) =>
        [...reaching].some((r) => r.jobId === job.id && r.index === step.index),
      );
      if (jobReaching.length === 0) continue;
      carriers += 1;

      for (const step of jobReaching) {
        const stepIf = str(step.raw.if) ?? "";
        expect(
          humanControlled.test(stepIf),
          `the step in job \`${job.id}\` that reaches the migration is conditional on ` +
            `\`${stepIf}\`, so a deploy can reach the app without the migration having run`,
        ).toBe(false);
      }

      // The job-level `if:` is the one that matters most: `if:
      // github.event_name == 'workflow_dispatch'` on the deploy job means no
      // merge to main ever migrates, and every step inside it looks correct.
      const jobIf = str(job.raw.if) ?? "";
      expect(
        humanControlled.test(jobIf),
        `job \`${job.id}\` reaches the migration but is conditional on \`${jobIf}\`, so a ` +
          "merge to main can deploy without migrating",
      ).toBe(false);
    }

    expect(
      carriers,
      "no workflow job runs the migration or brings up the stack that runs it " +
        `(migrate-shaped services: ${migrateServices.map((s) => s.name).join(", ") || "none"}), ` +
        "so nothing makes it run on every deploy",
    ).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------------- //
// Assertion 4 — no secret in the compose file or the workflow
// -------------------------------------------------------------------------- //

/**
 * Everything a value may legally be: an unresolved shell interpolation, a
 * required-with-no-default interpolation, or a GitHub expression. Anything left
 * over after stripping those is a literal committed to the repository.
 *
 * `${VAR:-postgres}` deliberately survives this stripping. A default password
 * in the compose file is still a password in the repository.
 */
function residualLiteral(value: string): string {
  return value
    .replace(/#[^\n]*$/gm, "") // trailing comments
    .replace(/\$\{\{[^}]*\}\}/g, "") // ${{ secrets.X }}
    .replace(/\$\{[A-Za-z_][A-Za-z0-9_]*:?\?[^}]*\}/g, "") // ${VAR:?msg} — no value
    .replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, "") // ${VAR}
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, "") // $VAR
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim();
}

/** Key names whose value is a secret by definition. */
const SECRET_KEY = /(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIALS?)$/i;

interface Finding {
  file: string;
  pattern: string;
  where: string;
}

/** Findings never carry the matched value. Test output goes into the CI log. */
function scanForSecrets(relative: string): Finding[] {
  const text = readRequired(relative);
  const findings: Finding[] = [];

  // (a) structured `key: value` pairs, including inside block scalars once the
  //     raw pass below picks them up.
  const doc = loadYaml(relative);
  for (const scalar of walkStrings(doc)) {
    if (!SECRET_KEY.test(scalar.key)) continue;
    if (residualLiteral(scalar.value) === "") continue;
    findings.push({ file: relative, pattern: "literal value on a secret-named key", where: scalar.path });
  }

  // (b) KEY=value / KEY: value anywhere in the raw text — catches shell
  //     assignments inside `run: |` blocks that (a) sees only as one string.
  const assignment =
    /(?:^|[\s"'([{-])([A-Za-z_][A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|ACCESS_?KEY))\s*[:=]([^\n]*)/gi;
  for (const match of text.matchAll(assignment)) {
    const key = match[1] ?? "";
    if (/_FILE$/i.test(key)) continue; // *_FILE points at a path, not a value
    if (residualLiteral(match[2] ?? "") === "") continue;
    findings.push({ file: relative, pattern: `literal assignment to ${key}`, where: "raw text" });
  }

  // (c) credentials embedded in a connection string.
  const urlWithCreds = /\b[a-z][a-z0-9+.-]*:\/\/([^\s:@/"'$]+):([^\s:@/"']+)@/gi;
  for (const match of text.matchAll(urlWithCreds)) {
    if ((match[2] ?? "").includes("$")) continue; // interpolated, not literal
    findings.push({ file: relative, pattern: "connection string with embedded credentials", where: "raw text" });
  }

  // (d) unmistakable credential shapes.
  const shapes: Array<[string, RegExp]> = [
    ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{16,}/],
    ["GitHub fine-grained PAT", /\bgithub_pat_[A-Za-z0-9_]{20,}/],
    ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
    ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ];
  for (const [name, pattern] of shapes) {
    if (pattern.test(text)) findings.push({ file: relative, pattern: name, where: "raw text" });
  }

  return findings;
}

function describeFindings(findings: Finding[]): string {
  // Names and locations only — never the matched text.
  return findings.map((f) => `${f.file}: ${f.pattern} (${f.where})`).join("; ");
}

describe("assertion 4 · no secret in the repository", () => {
  it.each([COMPOSE, WORKFLOW])("%s contains no hardcoded secret", (relative) => {
    const findings = scanForSecrets(relative);
    expect(findings.length, describeFindings(findings)).toBe(0);
  });

  it("POSTGRES_PASSWORD has no committed default", () => {
    // `${POSTGRES_PASSWORD:-postgres}` looks like configuration and is a
    // password in the repository. It is also the one that survives review.
    for (const relative of [COMPOSE, WORKFLOW]) {
      const text = readRequired(relative);
      const defaulted =
        /\$\{[A-Za-z_][A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY)[^}:]*:?[-=][^}]+\}/i;
      expect(defaulted.test(text), `${relative} gives a secret-named variable a default value`).toBe(
        false,
      );
    }
  });

  it("application config comes from an env file on the VM, not from the repository", () => {
    // PROXMOX.md:77-78 — "Application secrets live in an env file on this VM,
    // never in the repository."
    const services = composeServices();
    const usesEnvFile = services.some((s) => asList(s.raw.env_file).length > 0);
    const usesInterpolation = /\$\{[A-Za-z_][A-Za-z0-9_]*[:}?]/.test(readRequired(COMPOSE));
    expect(
      usesEnvFile || usesInterpolation,
      `${COMPOSE} neither declares an \`env_file:\` nor interpolates \`\${VAR}\`, so ` +
        "its configuration must be coming from literals in the repository",
    ).toBe(true);
  });

  it("no env file referenced by the compose stack is committed to the repository", () => {
    const referenced = new Set<string>();
    for (const service of composeServices()) {
      for (const entry of asList(service.raw.env_file)) {
        const file = typeof entry === "string" ? entry : isRec(entry) ? str(entry.path) : undefined;
        if (file !== undefined) referenced.add(file);
      }
    }
    for (const file of referenced) {
      const tracked = (() => {
        try {
          execFileSync("git", ["ls-files", "--error-unmatch", "--", file], {
            cwd: repoRoot,
            stdio: "ignore",
          });
          return true;
        } catch {
          return false;
        }
      })();
      expect(tracked, `${COMPOSE} reads env_file \`${file}\`, which is committed to the repo`).toBe(
        false,
      );
    }
  });

  it("the workflow takes no application secret from GitHub Actions secrets", () => {
    // The spec puts application secrets in an env file on the VM. A deploy that
    // also carries them through `secrets.*` re-creates the copy the design
    // removed. GITHUB_TOKEN is the runner's own credential, not app config.
    const text = readRequired(WORKFLOW);
    const referenced = [...text.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(
      (m) => m[1] ?? "",
    );
    const appSecrets = referenced.filter((name) => name !== "GITHUB_TOKEN");
    expect(
      appSecrets,
      `${WORKFLOW} reads ${appSecrets.length} GitHub secret(s) by name; application ` +
        "config belongs in the env file on the VM",
    ).toHaveLength(0);
  });

  it("the workflow never prints an env file or an environment secret into the log", () => {
    const text = readRequired(WORKFLOW);
    const leaks: Array<[string, RegExp]> = [
      ["cat of an env file", /\bcat\b[^\n]*\.env\b/i],
      ["echo of an env file", /\becho\b[^\n]*<[^\n]*\.env\b/i],
      ["echo of a secret variable", /\becho\b[^\n]*\$\{?[A-Za-z_]*(PASSWORD|SECRET|TOKEN|KEY)/i],
      ["printenv", /\bprintenv\b/],
      ["env dump", /(^|[\s;&|])env\s*(\||$)/m],
      ["shell xtrace", /\bset\s+-[a-z]*x/],
      ["docker compose config renders resolved secrets", /docker\s+compose[^\n]*\bconfig\b(?![^\n]*(-q|--quiet|--no-interpolate))/],
    ];
    const hits = leaks.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
    expect(hits, `${WORKFLOW} would print secrets into the job log: ${hits.join(", ")}`).toHaveLength(
      0,
    );
  });
});

// -------------------------------------------------------------------------- //
// PROXMOX.md:101-105 — the one line that still holds
// -------------------------------------------------------------------------- //

describe("runner isolation", () => {
  it.each([DOCKERFILE, COMPOSE, WORKFLOW])("%s never mounts /var/run/docker.sock", (relative) => {
    // Comments are stripped first: "this runner has no docker.sock" is a
    // statement about the property, not a breach of it. Anything the file
    // actually executes or mounts still counts.
    const text = relative === DOCKERFILE ? dockerfileCode() : yamlCode(relative);
    expect(
      /docker\.sock/.test(text),
      `${relative} references docker.sock. runner/PROXMOX.md:103 — no runner VM ` +
        "ever mounts /var/run/docker.sock into a job container, and that is one of " +
        "the two mistakes the doc calls irreversible.",
    ).toBe(false);
  });

  it("no compose service mounts the docker socket", () => {
    for (const service of composeServices()) {
      for (const entry of asList(service.raw.volumes)) {
        const text = typeof entry === "string" ? entry : isRec(entry) ? String(entry.source ?? "") : "";
        expect(
          /docker\.sock/.test(text),
          `service \`${service.name}\` mounts the docker socket`,
        ).toBe(false);
      }
    }
  });

  it("no compose service runs privileged", () => {
    for (const service of composeServices()) {
      expect(service.raw.privileged, `service \`${service.name}\` is privileged`).not.toBe(true);
    }
  });
});
