ALTER TABLE "Forecast"
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "vendorId", "fiscalPeriodId", "weekNumber"
      ORDER BY "createdAt" DESC, id DESC
    ) AS rn
  FROM "Forecast"
)
DELETE FROM "Forecast"
WHERE id IN (
  SELECT id
  FROM ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "Forecast_vendorId_fiscalPeriodId_weekNumber_key"
ON "Forecast"("vendorId", "fiscalPeriodId", "weekNumber");
