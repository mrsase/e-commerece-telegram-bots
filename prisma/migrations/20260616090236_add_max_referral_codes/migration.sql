-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "maxReferralCodes" INTEGER NOT NULL DEFAULT 3,
    "loyaltyScore" INTEGER NOT NULL DEFAULT 0,
    "loyaltyScoreOverride" INTEGER,
    "discountPercent" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    "usedReferralCodeId" INTEGER,
    CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_usedReferralCodeId_fkey" FOREIGN KEY ("usedReferralCodeId") REFERENCES "ReferralCode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("address", "canCreateReferral", "createdAt", "discountPercent", "firstName", "id", "isActive", "isVerified", "lastName", "lastSeenAt", "locationLat", "locationLng", "locationText", "loyaltyScore", "loyaltyScoreOverride", "phone", "referralCode", "referredById", "tgUserId", "usedReferralCodeId", "username") SELECT "address", "canCreateReferral", "createdAt", "discountPercent", "firstName", "id", "isActive", "isVerified", "lastName", "lastSeenAt", "locationLat", "locationLng", "locationText", "loyaltyScore", "loyaltyScoreOverride", "phone", "referralCode", "referredById", "tgUserId", "usedReferralCodeId", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_tgUserId_key" ON "User"("tgUserId");
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
