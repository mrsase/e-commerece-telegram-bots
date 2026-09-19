-- Preserve the previous runtime fallback without performing writes during
-- every application startup. Existing profile names take precedence; users
-- without one receive a deterministic label based on their database id.
UPDATE "User"
SET "username" = COALESCE(
  NULLIF(TRIM("firstName"), ''),
  NULLIF(TRIM("lastName"), ''),
  'user_' || "id"
)
WHERE "username" IS NULL;
