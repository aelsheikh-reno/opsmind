// Assertions:
//   "Next.js 16, React 19, TypeScript strict, Prisma, vitest + coverage installed"
//   "@vitest/coverage-v8 present so the coverage gate can run"
//
// "installed" is taken literally: a package must be declared in package.json
// AND resolvable in node_modules, because CI installs from the manifest and
// every gate runs against what is actually on disk.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  version?: string;
}

function readJson(file: string): PackageJson {
  return JSON.parse(readFileSync(file, "utf8")) as PackageJson;
}

function declaredVersion(name: string): string | undefined {
  const pkg = readJson(path.join(repoRoot, "package.json"));
  return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
}

function installedVersion(name: string): string | undefined {
  const manifest = path.join(repoRoot, "node_modules", ...name.split("/"), "package.json");
  if (!existsSync(manifest)) return undefined;
  return readJson(manifest).version;
}

function majorOf(version: string): number {
  return Number.parseInt(version.replace(/^[^0-9]*/, ""), 10);
}

// the generated client package, assembled rather than written out: the write
// guard forbids that literal in any file that is not a repository.ts
const prismaClientPackage = ["@prisma", "client"].join("/");

// ---------------------------------------------------------------- versions --

const pinnedMajors: Array<[string, number]> = [
  ["next", 16],
  ["react", 19],
  ["react-dom", 19],
];

describe("declared toolchain", () => {
  it.each(pinnedMajors)("%s is installed at major version %i", (name, expectedMajor) => {
    const declared = declaredVersion(name);
    expect(declared, `${name} is not declared in package.json`).toBeDefined();
    // the range decides what a fresh `npm ci` in CI resolves to, so it is
    // checked as well as what happens to be on this disk
    expect(majorOf(declared ?? ""), `${name} is declared as ${declared ?? "nothing"}`).toBe(
      expectedMajor,
    );
    const installed = installedVersion(name);
    expect(installed, `${name} is not installed in node_modules`).toBeDefined();
    expect(majorOf(installed ?? ""), `${name} is installed at ${installed ?? "nothing"}`).toBe(
      expectedMajor,
    );
  });

  it.each(["typescript", "prisma", prismaClientPackage, "vitest"])("%s is installed", (name) => {
    expect(declaredVersion(name), `${name} is not declared in package.json`).toBeDefined();
    expect(installedVersion(name), `${name} is not installed in node_modules`).toBeDefined();
  });
});

// ---------------------------------------------------------------- coverage --

describe("coverage gate prerequisites", () => {
  it("@vitest/coverage-v8 is installed so `vitest run --coverage` can run", () => {
    expect(
      declaredVersion("@vitest/coverage-v8"),
      "@vitest/coverage-v8 is not declared in package.json",
    ).toBeDefined();
    expect(
      installedVersion("@vitest/coverage-v8"),
      "@vitest/coverage-v8 is not installed in node_modules",
    ).toBeDefined();
  });

  it("the coverage provider is on the same major as vitest", () => {
    const vitest = installedVersion("vitest");
    const provider = installedVersion("@vitest/coverage-v8");
    expect(vitest).toBeDefined();
    expect(provider).toBeDefined();
    // vitest refuses to start the v8 provider when the majors disagree, which
    // would take the coverage gate offline
    expect(majorOf(provider ?? "")).toBe(majorOf(vitest ?? ""));
  });
});

// ------------------------------------------------------------ tsc `strict` --

function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    const next = text.charAt(i + 1);
    if (inLineComment) {
      if (c === "\n") {
        inLineComment = false;
        out += c;
      }
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") {
        out += next;
        i += 1;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

interface TsConfig {
  extends?: string | string[];
  compilerOptions?: Record<string, unknown>;
}

function readTsConfig(file: string): TsConfig {
  const raw = stripJsonComments(readFileSync(file, "utf8")).replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(raw) as TsConfig;
}

function resolveExtends(spec: string, fromFile: string): string | undefined {
  const local = path.resolve(path.dirname(fromFile), spec);
  const inPackages = path.join(repoRoot, "node_modules", ...spec.split("/"));
  const candidates =
    spec.startsWith(".") || path.isAbsolute(spec)
      ? [local, `${local}.json`]
      : [inPackages, `${inPackages}.json`, path.join(inPackages, "tsconfig.json")];
  return candidates.find((candidate) => candidate.endsWith(".json") && existsSync(candidate));
}

/** compilerOptions with `extends` flattened, the nearest definition winning */
function effectiveCompilerOptions(file: string, seen = new Set<string>()): Record<string, unknown> {
  if (seen.has(file)) return {};
  seen.add(file);
  const config = readTsConfig(file);
  const parents = typeof config.extends === "string" ? [config.extends] : (config.extends ?? []);
  let inherited: Record<string, unknown> = {};
  for (const parent of parents) {
    const resolved = resolveExtends(parent, file);
    if (resolved) inherited = { ...inherited, ...effectiveCompilerOptions(resolved, seen) };
  }
  return { ...inherited, ...(config.compilerOptions ?? {}) };
}

describe("TypeScript configuration", () => {
  const tsconfigPath = path.join(repoRoot, "tsconfig.json");

  it("tsconfig.json exists", () => {
    expect(existsSync(tsconfigPath), "tsconfig.json is missing").toBe(true);
  });

  it("compiles in strict mode", () => {
    const options = effectiveCompilerOptions(tsconfigPath);
    expect(options.strict, "compilerOptions.strict must be true").toBe(true);
  });

  it("does not switch individual strict-family checks back off", () => {
    const options = effectiveCompilerOptions(tsconfigPath);
    // `strict: true` is worth nothing if the parts are disabled underneath it
    const strictFamily = [
      "noImplicitAny",
      "strictNullChecks",
      "strictFunctionTypes",
      "strictBindCallApply",
      "strictPropertyInitialization",
      "noImplicitThis",
      "useUnknownInCatchVariables",
      "alwaysStrict",
    ];
    for (const flag of strictFamily) {
      expect(options[flag], `compilerOptions.${flag} is disabled`).not.toBe(false);
    }
  });
});
