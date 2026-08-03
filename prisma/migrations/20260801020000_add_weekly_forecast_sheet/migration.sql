-- CreateTable
CREATE TABLE "WeeklyForecastSheet" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "fiscalPeriodId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyForecastSheet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyForecastSheet_fiscalPeriodId_weekNumber_idx" ON "WeeklyForecastSheet"("fiscalPeriodId", "weekNumber");

-- CreateIndex
CREATE INDEX "WeeklyForecastSheet_updatedById_idx" ON "WeeklyForecastSheet"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyForecastSheet_vendorId_fiscalPeriodId_weekNumber_key" ON "WeeklyForecastSheet"("vendorId", "fiscalPeriodId", "weekNumber");

-- AddForeignKey
ALTER TABLE "WeeklyForecastSheet" ADD CONSTRAINT "WeeklyForecastSheet_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyForecastSheet" ADD CONSTRAINT "WeeklyForecastSheet_fiscalPeriodId_fkey" FOREIGN KEY ("fiscalPeriodId") REFERENCES "FiscalPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyForecastSheet" ADD CONSTRAINT "WeeklyForecastSheet_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

