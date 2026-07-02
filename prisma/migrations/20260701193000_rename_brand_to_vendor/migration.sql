DO $$
BEGIN
  IF to_regclass('"Brand"') IS NOT NULL AND to_regclass('"Vendor"') IS NULL THEN
    ALTER TABLE "Brand" RENAME TO "Vendor";
  END IF;

  IF to_regclass('"BrandAlias"') IS NOT NULL AND to_regclass('"VendorAlias"') IS NULL THEN
    ALTER TABLE "BrandAlias" RENAME TO "VendorAlias";
  END IF;

  IF to_regclass('"UserBrand"') IS NOT NULL AND to_regclass('"UserVendor"') IS NULL THEN
    ALTER TABLE "UserBrand" RENAME TO "UserVendor";
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Forecast"') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Forecast' AND column_name = 'brandId')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Forecast' AND column_name = 'vendorId') THEN
    ALTER TABLE "Forecast" RENAME COLUMN "brandId" TO "vendorId";
  END IF;

  IF to_regclass('"Target"') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Target' AND column_name = 'brandId')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Target' AND column_name = 'vendorId') THEN
    ALTER TABLE "Target" RENAME COLUMN "brandId" TO "vendorId";
  END IF;

  IF to_regclass('"Actual"') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Actual' AND column_name = 'brandId')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Actual' AND column_name = 'vendorId') THEN
    ALTER TABLE "Actual" RENAME COLUMN "brandId" TO "vendorId";
  END IF;

  IF to_regclass('"VendorAlias"') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'VendorAlias' AND column_name = 'brandId')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'VendorAlias' AND column_name = 'vendorId') THEN
    ALTER TABLE "VendorAlias" RENAME COLUMN "brandId" TO "vendorId";
  END IF;

  IF to_regclass('"UserVendor"') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'UserVendor' AND column_name = 'brandId')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'UserVendor' AND column_name = 'vendorId') THEN
    ALTER TABLE "UserVendor" RENAME COLUMN "brandId" TO "vendorId";
  END IF;
END $$;
