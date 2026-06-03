-- AlterTable
ALTER TABLE "Order" ADD COLUMN "channelMessageId" INTEGER;
ALTER TABLE "Order" ADD COLUMN "inviteExpiresAt" DATETIME;

-- CreateTable
CREATE TABLE "BotSettings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReferralCode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "createdByUserId" INTEGER,
    "createdByManagerId" INTEGER,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "loyaltyScore" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    CONSTRAINT "ReferralCode_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReferralCode_createdByManagerId_fkey" FOREIGN KEY ("createdByManagerId") REFERENCES "Manager" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ReferralCode" ("code", "createdAt", "createdByManagerId", "createdByUserId", "expiresAt", "id", "isActive", "maxUses", "usedCount") SELECT "code", "createdAt", "createdByManagerId", "createdByUserId", "expiresAt", "id", "isActive", "maxUses", "usedCount" FROM "ReferralCode";
DROP TABLE "ReferralCode";
ALTER TABLE "new_ReferralCode" RENAME TO "ReferralCode";
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "ReferralCode"("code");
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tgUserId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "locationLat" REAL,
    "locationLng" REAL,
    "locationText" TEXT,
    "address" TEXT,
    "referralCode" TEXT NOT NULL,
    "referredById" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "canCreateReferral" BOOLEAN NOT NULL DEFAULT false,
    "loyaltyScore" INTEGER NOT NULL DEFAULT 0,
    "loyaltyScoreOverride" INTEGER,
    "discountPercent" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    "usedReferralCodeId" INTEGER,
    CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_usedReferralCodeId_fkey" FOREIGN KEY ("usedReferralCodeId") REFERENCES "ReferralCode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("address", "createdAt", "firstName", "id", "isActive", "isVerified", "lastName", "lastSeenAt", "locationLat", "locationLng", "phone", "referralCode", "referredById", "tgUserId", "usedReferralCodeId", "username") SELECT "address", "createdAt", "firstName", "id", "isActive", "isVerified", "lastName", "lastSeenAt", "locationLat", "locationLng", "phone", "referralCode", "referredById", "tgUserId", "usedReferralCodeId", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_tgUserId_key" ON "User"("tgUserId");
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
