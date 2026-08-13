// Assertion: "npm test runs vitest; npm run lint runs eslint"
//
// package.json is read as DATA at runtime. The scaffold is the subject under
// test here, so the config file is the fixture.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

interface PackageJson {
  scripts?: Record<string, string>;
}

function readPackageJson(): PackageJson {
  const raw = readFileSync(path.join(repoRoot, "package.json"), "utf8");
  return JSON.parse(raw) as PackageJson;
}

describe("npm scripts", () => {
  it("defines a `test` script, so `npm test` has something to run", () => {
    const scripts = readPackageJson().scripts ?? {};
    expect(Object.keys(scripts)).toContain("test");
    expect((scripts.test ?? "").trim()).not.toBe("");
  });

  it("wires `npm test` to vitest", () => {
    const script = readPackageJson().scripts?.test ?? "";
    expect(script).toMatch(/\bvitest\b/);
    // a placeholder or another runner would satisfy "a test script exists"
    // while making the tests gate meaningless
    expect(script).not.toMatch(/\bjest\b/);
    expect(script).not.toMatch(/no test specified/i);
    expect(script).not.toMatch(/\bexit 1\b/);
  });

  it("defines a `lint` script, so `npm run lint` has something to run", () => {
    const scripts = readPackageJson().scripts ?? {};
    expect(Object.keys(scripts)).toContain("lint");
    expect((scripts.lint ?? "").trim()).not.toBe("");
  });

  it("wires `npm run lint` to eslint, not to the removed `next lint`", () => {
    const script = readPackageJson().scripts?.lint ?? "";
    expect(script).toMatch(/\beslint\b/);
    // `next lint` was removed in Next.js 16; it would not run eslint at all
    expect(script).not.toMatch(/\bnext\s+lint\b/);
  });
});
