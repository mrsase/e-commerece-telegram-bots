ALTER TABLE "Announcement" ADD COLUMN "title" TEXT NOT NULL DEFAULT 'اطلاعیه فروشگاه ایرانی';
ALTER TABLE "Announcement" ADD COLUMN "discountType" TEXT;
ALTER TABLE "Announcement" ADD COLUMN "discountValue" INTEGER;

UPDATE "Announcement" SET "type" = 'GENERAL' WHERE "type" = 'PROMOTION';
