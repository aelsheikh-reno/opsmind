-- CreateEnum
CREATE TYPE "RetentionBasis" AS ENUM ('end_of_financial_year', 'end_of_tax_period', 'document_date');

-- CreateEnum
CREATE TYPE "ErasureMode" AS ENUM ('redact_personal', 'full_delete');

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "jobTitle" TEXT,
    "department" TEXT,
    "nationality" TEXT,
    "managerId" TEXT,
    "contractStart" DATE,
    "contractEnd" DATE,
    "exitDate" DATE,
    "exitReason" TEXT,
    "employmentType" TEXT NOT NULL DEFAULT 'fulltime',
    "weeklyHours" DECIMAL(6,2) NOT NULL DEFAULT 40,
    "payslipInContractCurrency" BOOLEAN NOT NULL DEFAULT false,
    "documentId" TEXT,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonEnrolment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "personId" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "obligationType" "ObligationType" NOT NULL,
    "identifier" TEXT NOT NULL,
    "activeFrom" DATE NOT NULL,
    "activeTo" DATE,

    CONSTRAINT "PersonEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'credentials',
    "providerSub" TEXT,
    "passwordHash" TEXT,
    "personId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentType" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "retentionYears" INTEGER NOT NULL DEFAULT 7,
    "retentionBasis" "RetentionBasis" NOT NULL,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "erasureMode" "ErasureMode" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "DocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "asOf" DATE NOT NULL,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityLabel" TEXT,
    "details" JSONB,
    "actorUserId" TEXT,
    "actorName" TEXT,
    "appliedRetentionYears" INTEGER,
    "appliedRetentionBasis" "RetentionBasis",
    "appliedErasureMode" "ErasureMode",
    "redactedAt" TIMESTAMP(3),
    "redactedBy" TEXT,
    "redactionReason" TEXT,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_documentId_key" ON "Person"("documentId");

-- CreateIndex
CREATE INDEX "Person_managerId_idx" ON "Person"("managerId");

-- CreateIndex
CREATE INDEX "PersonEnrolment_personId_jurisdictionId_obligationType_idx" ON "PersonEnrolment"("personId", "jurisdictionId", "obligationType");

-- CreateIndex
CREATE INDEX "PersonEnrolment_jurisdictionId_idx" ON "PersonEnrolment"("jurisdictionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_personId_key" ON "User"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "User_provider_providerSub_key" ON "User"("provider", "providerSub");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentType_type_key" ON "DocumentType"("type");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_base_quote_asOf_key" ON "FxRate"("base", "quote", "asOf");

-- CreateIndex
CREATE INDEX "AuditEntry_entityType_entityId_idx" ON "AuditEntry"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEntry_createdAt_idx" ON "AuditEntry"("createdAt");

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonEnrolment" ADD CONSTRAINT "PersonEnrolment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonEnrolment" ADD CONSTRAINT "PersonEnrolment_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

