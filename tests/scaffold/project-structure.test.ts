// Assertions: the structural directories from CLAUDE.md exist and are
// committable (`lib/{kernel,modules,services,adapters}/.gitkeep` are named in
// the task's `produces`), and prisma/schema.prisma exists.
//
// The schema is also guarded against a paid boolean from the very first
// commit — CLAUDE.md rule 5: "Payment state is a recorded event, never a
// boolean. There is no `isPaid` column anywhere."
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const structuralDirs = ["lib/kernel", "lib/modules", "lib/services", "lib/adapters"];

describe("project structure", () => {
  it.each(structuralDirs)("%s exists and is a directory", (dir) => {
    const full = path.join(repoRoot, dir);
    expect(existsSync(full), `${dir} is missing`).toBe(true);
    expect(statSync(full).isDirectory(), `${dir} is not a directory`).toBe(true);
  });

  it.each(structuralDirs)("%s holds a .gitkeep so an empty tree survives a clone", (dir) => {
    expect(existsSync(path.join(repoRoot, dir, ".gitkeep")), `${dir}/.gitkeep is missing`).toBe(
      true,
    );
  });
});

describe("prisma schema", () => {
  const schemaPath = path.join(repoRoot, "prisma", "schema.prisma");

  it("prisma/schema.prisma exists and is not empty", () => {
    expect(existsSync(schemaPath), "prisma/schema.prisma is missing").toBe(true);
    expect(readFileSync(schemaPath, "utf8").trim()).not.toBe("");
  });

  it("declares no paid boolean — paid state is derived from Settlement rows", () => {
    const lines = readFileSync(schemaPath, "utf8").split("\n");
    const offenders = lines
      .map((line, i) => `${i + 1}: ${line.trim()}`)
      .filter((line) => /is_?paid/i.test(line));
    expect(offenders, "CLAUDE.md rule 5 — no isPaid/is_paid anywhere in the schema").toEqual([]);
  });
});
