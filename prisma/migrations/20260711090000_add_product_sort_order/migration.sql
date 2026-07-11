-- Keep catalogue order explicit instead of relying on product creation time.
ALTER TABLE "Product" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Preserve the existing newest-to-oldest catalogue order for products that already exist.
UPDATE "Product"
SET "sortOrder" = (SELECT MAX("id") FROM "Product") - "id" + 1
WHERE "sortOrder" = 0;
