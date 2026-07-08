-- Add user-level discount type/value. discountPercent remains for backward compatibility.
ALTER TABLE "User" ADD COLUMN "discountType" TEXT;
ALTER TABLE "User" ADD COLUMN "discountValue" INTEGER;

UPDATE "User"
SET "discountType" = 'PERCENT',
    "discountValue" = "discountPercent"
WHERE "discountPercent" IS NOT NULL;
