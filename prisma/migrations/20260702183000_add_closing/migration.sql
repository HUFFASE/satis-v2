ALTER TYPE "ImportDataType" ADD VALUE IF NOT EXISTS 'CLOSING';

CREATE TABLE IF NOT EXISTS "Closing" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "fiscalPeriodId" TEXT NOT NULL,
  "revenue" DECIMAL(18, 2) NOT NULL,
  "gp" DECIMAL(18, 2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Closing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Closing_vendorId_fiscalPeriodId_key"
  ON "Closing"("vendorId", "fiscalPeriodId");

CREATE INDEX IF NOT EXISTS "Closing_fiscalPeriodId_idx"
  ON "Closing"("fiscalPeriodId");

ALTER TABLE "Closing"
  ADD CONSTRAINT "Closing_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Closing"
  ADD CONSTRAINT "Closing_fiscalPeriodId_fkey"
  FOREIGN KEY ("fiscalPeriodId") REFERENCES "FiscalPeriod"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
