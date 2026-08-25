-- Add indexes for referral-tree navigation and parent/order lookups.
-- Index creation is additive and does not rewrite or delete application rows.
CREATE INDEX "User_referredById_idx" ON "User"("referredById");
CREATE INDEX "User_usedReferralCodeId_idx" ON "User"("usedReferralCodeId");
CREATE INDEX "ReferralCode_createdByUserId_idx" ON "ReferralCode"("createdByUserId");
CREATE INDEX "Order_userId_idx" ON "Order"("userId");
