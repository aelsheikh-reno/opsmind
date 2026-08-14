-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "EntityRole" AS ENUM ('self', 'client', 'vendor');

-- CreateEnum
CREATE TYPE "ObligationType" AS ENUM ('vat', 'corporate_tax', 'social_insurance');

-- CreateEnum
CREATE TYPE "EnrolmentFrequency" AS ENUM ('monthly', 'quarterly', 'semiannual', 'annual');

-- CreateTable
CREATE TABLE "Jurisdiction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Jurisdiction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessCalendar" (
    "id" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "weekendMask" INTEGER[],

    CONSTRAINT "BusinessCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessHoliday" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "BusinessHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Regime" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jurisdictionId" TEXT NOT NULL,
    "obligationType" "ObligationType" NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(9,6) NOT NULL,
    "deadlineDays" INTEGER NOT NULL,
    "thresholds" JSONB,
    "brackets" JSONB,

    CONSTRAINT "Regime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalEntity" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "currency" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "role" "EntityRole" NOT NULL,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JurisdictionEnrolment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legalEntityId" TEXT NOT NULL,
    "regimeId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "frequency" "EnrolmentFrequency" NOT NULL,
    "anchor" DATE NOT NULL,
    "activeFrom" DATE NOT NULL,
    "activeTo" DATE,
    "sourceDocumentId" TEXT,

    CONSTRAINT "JurisdictionEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "status" TEXT NOT NULL DEFAULT 'processing',
    "filePath" TEXT,
    "fileHash" TEXT,
    "direction" "Direction" NOT NULL,
    "docType" TEXT,
    "confidence" DOUBLE PRECISION,
    "parties" TEXT,
    "summary" TEXT,
    "notes" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "renewalDeadline" TIMESTAMP(3),
    "amount" DECIMAL(18,3),
    "vatAmount" DECIMAL(18,3),
    "currency" TEXT,
    "paymentTerms" TEXT,
    "poStatus" TEXT DEFAULT 'open',
    "referenceNumber" TEXT,
    "issuingCountry" TEXT,
    "legalEntityId" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Jurisdiction_code_key" ON "Jurisdiction"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessCalendar_jurisdictionId_key" ON "BusinessCalendar"("jurisdictionId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessHoliday_calendarId_date_key" ON "BusinessHoliday"("calendarId", "date");

-- CreateIndex
CREATE INDEX "Regime_jurisdictionId_obligationType_idx" ON "Regime"("jurisdictionId", "obligationType");

-- CreateIndex
CREATE INDEX "JurisdictionEnrolment_regimeId_idx" ON "JurisdictionEnrolment"("regimeId");

-- CreateIndex
CREATE UNIQUE INDEX "JurisdictionEnrolment_legalEntityId_regimeId_key" ON "JurisdictionEnrolment"("legalEntityId", "regimeId");

-- CreateIndex
CREATE INDEX "Document_docType_idx" ON "Document"("docType");

-- CreateIndex
CREATE INDEX "Document_direction_idx" ON "Document"("direction");

-- CreateIndex
CREATE INDEX "Document_expiryDate_idx" ON "Document"("expiryDate");

-- AddForeignKey
ALTER TABLE "BusinessCalendar" ADD CONSTRAINT "BusinessCalendar_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessHoliday" ADD CONSTRAINT "BusinessHoliday_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "BusinessCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Regime" ADD CONSTRAINT "Regime_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JurisdictionEnrolment" ADD CONSTRAINT "JurisdictionEnrolment_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JurisdictionEnrolment" ADD CONSTRAINT "JurisdictionEnrolment_regimeId_fkey" FOREIGN KEY ("regimeId") REFERENCES "Regime"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JurisdictionEnrolment" ADD CONSTRAINT "JurisdictionEnrolment_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

