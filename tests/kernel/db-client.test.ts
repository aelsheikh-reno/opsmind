// lib/db.ts is the single PrismaClient every repository imports. The thing
// worth pinning is not that it exists but that it is a SINGLETON: a repository
// that constructs its own client gets its own connection pool, and seven
// modules doing that is seven pools against a database sized for one
// application (data-ownership.md).
//
// Nothing here connects. Constructing a PrismaClient does not open a socket —
// the pool is created lazily on first query — so this runs with no database,
// which is what lets it sit in the unit suite rather than needing CI's Postgres.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("the shared database client", () => {
  it("exports one client, and the same one on every import", async () => {
    const first = await import("@/lib/db");
    const second = await import("@/lib/db");
    expect(first.db).toBeDefined();
    expect(second.db, "each import must yield the same client, not a new pool").toBe(first.db);
  });

  it("caches on globalThis outside production, so hot reload cannot leak pools", async () => {
    // Next.js re-evaluates modules on every edit in development. Without the
    // cache a plain `new PrismaClient()` leaks a pool per reload until the
    // database refuses connections.
    const { db } = await import("@/lib/db");
    const cached = (globalThis as unknown as { db?: unknown }).db;
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(cached, "the client is not cached on globalThis").toBe(db);
  });

  it("is the only file outside a repository that names the client package", () => {
    // The reason lib/db.ts is exempt in BOTH guards, asserted rather than
    // asserted-about: walk lib/ and app/ and confirm nothing else reaches the
    // client. check-boundaries.sh enforces this in CI; pinning it here means a
    // change to that script cannot quietly widen the rule without a red test.
    const roots = ["lib", "app"];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (entry.name === "repository.ts" || full === path.join("lib", "db.ts")) continue;
        if (/@\/lib\/db|@prisma\/client/.test(readFileSync(full, "utf8"))) offenders.push(full);
      }
    };
    for (const root of roots) if (existsSync(root)) walk(root);
    expect(offenders, "only lib/db.ts and a repository.ts may name the client").toEqual([]);
  });
});
