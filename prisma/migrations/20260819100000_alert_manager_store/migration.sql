-- CreateEnum
CREATE TYPE "AlertManagerSeverity" AS ENUM ('minor', 'major');

-- CreateEnum
CREATE TYPE "AlertState" AS ENUM ('firing', 'acknowledged', 'suppressed', 'resolved');

-- CreateEnum
CREATE TYPE "AlertEventKind" AS ENUM ('raised', 'reasserted', 'severity_raised', 'stale_marked', 'stale_cleared', 'acknowledged', 'suppressed', 'unsuppressed', 'resolved');

-- CreateEnum
CREATE TYPE "AlertSourceKind" AS ENUM ('repeating', 'direct', 'fire_only');

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "state" "AlertState" NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "severity" "AlertManagerSeverity" NOT NULL,
    "policyId" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertArea" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "area" TEXT NOT NULL,

    CONSTRAINT "AlertArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "kind" "AlertEventKind" NOT NULL,
    "fromState" "AlertState",
    "toState" "AlertState",
    "actor" TEXT,
    "runId" TEXT,
    "reason" TEXT,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertSource" (
    "sourceId" TEXT NOT NULL,
    "kind" "AlertSourceKind" NOT NULL,
    "expectedEvery" INTEGER,
    "lastRunAt" TIMESTAMP(3),
    "lastRunId" TEXT,

    CONSTRAINT "AlertSource_pkey" PRIMARY KEY ("sourceId")
);

-- CreateIndex
CREATE INDEX "Alert_sourceId_state_idx" ON "Alert"("sourceId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_sourceId_fingerprint_key" ON "Alert"("sourceId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "AlertArea_alertId_area_key" ON "AlertArea"("alertId", "area");

-- CreateIndex
CREATE INDEX "AlertEvent_alertId_at_idx" ON "AlertEvent"("alertId", "at");

-- AddForeignKey
ALTER TABLE "AlertArea" ADD CONSTRAINT "AlertArea_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

