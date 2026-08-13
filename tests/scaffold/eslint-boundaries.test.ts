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

function isOff(setting: unknown): boolean {
  const severity = Array.isArray(setting) ? (setting as unknown[])[0] : setting;
  return severity === "off" || severity === 0;
}

async function loadFlatConfig(file: string): Promise<unknown[]> {
  const loaded: { default?: unknown } = await import(pathToFileURL(file).href);
  const config = loaded.default;
  return Array.isArray(config) ? (config as unknown[]) : [];
}

let templateBlocks: FlatEntry[] = [];
let projectConfig: unknown[] = [];
let projectBlocks: FlatEntry[] = [];

beforeAll(async () => {
  templateBlocks = (await loadFlatConfig(templatePath)).filter(isBoundaryBlock);
  projectConfig = await loadFlatConfig(projectPath);
  projectBlocks = projectConfig.filter(isBoundaryBlock);
});

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
