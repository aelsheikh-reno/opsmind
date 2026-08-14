// The single PrismaClient every repository imports.
//
// CLAUDE.md rule 3 says only a module's repository.ts may reach the database.
// This file is what those repositories reach it THROUGH: one client, one
// connection pool, constructed once. A repository that builds its own client
// gets its own pool, and seven modules doing that is seven pools against a
// database sized for one application.
//
// The globalThis guard is for development. Next.js hot reload re-evaluates
// modules on every edit, so a plain `new PrismaClient()` leaks a pool per
// reload until the database refuses connections. Caching on globalThis
// survives the reload; in production the module is evaluated once and the
// guard costs nothing.
import { PrismaClient } from "@prisma/client";

const globalForDb = globalThis as unknown as { db?: PrismaClient };

export const db: PrismaClient = globalForDb.db ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForDb.db = db;
