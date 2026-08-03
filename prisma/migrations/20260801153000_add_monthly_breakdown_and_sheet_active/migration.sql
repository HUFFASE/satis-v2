-- Aylık kırılım kolonları (Target, Closing) + haftalık form aktif işareti.
-- Tamamı eklemeli: mevcut revenue/gp çeyrek toplamı olarak korunur, hiçbir
-- okuma noktası etkilenmez. IF NOT EXISTS elle eklendi (canlı DB'de tekrar
-- çalıştırılabilir olsun diye; projede migrate dev kullanılamıyor).

-- AlterTable
ALTER TABLE "Closing" ADD COLUMN IF NOT EXISTS "gpM1" DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS "gpM2" DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS "gpM3" DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS "revenueM1" DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS "revenueM2" DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS "revenueM3" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Target" ADD COLUMN IF NOT EXISTS "gpM1" DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS "gpM2" DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS "gpM3" DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS "revenueM1" DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS "revenueM2" DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS "revenueM3" DECIMAL(18,2);

-- AlterTable
-- Sabit varsayılan + PG 16 → tablo yeniden yazılmaz (metadata-only).
ALTER TABLE "WeeklyForecastSheet" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WeeklyForecastSheet_vendorId_fiscalPeriodId_isActive_idx" ON "WeeklyForecastSheet"("vendorId", "fiscalPeriodId", "isActive");
