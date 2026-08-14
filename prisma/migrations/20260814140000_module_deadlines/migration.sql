-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('minor', 'major');

-- CreateTable
CREATE TABLE "DeadlineRegistration" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "deadlineType" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "jurisdictionId" TEXT NOT NULL,

    CONSTRAINT "DeadlineRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThresholdTable" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineType" TEXT NOT NULL,
    "businessDaysBefore" INTEGER NOT NULL,
    "severity" "AlertSeverity" NOT NULL,

    CONSTRAINT "ThresholdTable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeadlineRegistration_dueDate_idx" ON "DeadlineRegistration"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "DeadlineRegistration_entityType_entityId_deadlineType_key" ON "DeadlineRegistration"("entityType", "entityId", "deadlineType");

-- CreateIndex
CREATE UNIQUE INDEX "ThresholdTable_deadlineType_businessDaysBefore_key" ON "ThresholdTable"("deadlineType", "businessDaysBefore");

