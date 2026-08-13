# syntax=docker/dockerfile:1
# The OpsMind application image, built on the staging VM by
# .github/workflows/deploy-staging.yml. Multi-stage: the shipped layer holds the
# Next.js standalone server, the Prisma schema/migrations and the Prisma CLI —
# nothing else.

FROM node:20-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# One guard for both Prisma steps — `generate` at build time and
# `migrate deploy` at deploy time — so the two can never drift.
#
# Prisma 5 exits 1 on a schema with no models and phase 0 deliberately has none
# (the kernel entities arrive with kernel-schema-base), which would otherwise
# make the image unbuildable. This is the same bootstrap guard as
# .github/workflows/gates.yml, including its refusal to treat a *missing* schema
# as "no models": skipping migrate deploy silently would start the app against
# an unmigrated database behind a green deploy — the one failure direction that
# hides. From the first model onwards both commands run and fail exactly as
# before; this is a bootstrap guard, not a relaxation.
COPY <<'SH' /usr/local/bin/prisma-step.sh
#!/bin/sh
set -eu
schemas=$(ls prisma/schema.prisma prisma/schema/*.prisma 2>/dev/null || true)
if [ -z "$schemas" ]; then
  echo "no .prisma schema found under prisma/ — refusing to skip 'prisma $*'" >&2
  exit 1
fi
# POSIX character classes, not \s and \w: busybox grep has no GNU extensions.
# Both layouts are matched so moving to prisma/schema/*.prisma later cannot
# disable this by deleting schema.prisma.
if ! grep -qE '^[[:space:]]*model[[:space:]]+[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\{' $schemas; then
  echo "no models declared yet — skipping 'prisma $*' (phase 0)"
  exit 0
fi
exec node node_modules/prisma/build/index.js "$@"
SH
RUN chmod +x /usr/local/bin/prisma-step.sh

# ── dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ── build ────────────────────────────────────────────────────────────────────
FROM base AS builder
# Sources first, then node_modules: there is no .dockerignore in the repository,
# so a workstation's host node_modules can land in the context. Copying the
# deps stage afterwards means the linux-musl install always wins.
COPY . .
COPY --from=deps /app/node_modules ./node_modules
RUN prisma-step.sh generate
RUN npm run build
# public/ and node_modules/.prisma need not exist yet, and COPY from a missing
# path fails the build.
RUN mkdir -p public node_modules/.prisma

# ── runtime ──────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Schema, migrations and the Prisma CLI: the `migrate` service in
# docker-compose.staging.yml runs `prisma migrate deploy` from this same image.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
