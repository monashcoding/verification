ALTER TABLE "member_links" ADD COLUMN "card_number" text;--> statement-breakpoint
-- Backfill the stable identity from whichever roster row each link was made
-- against. Links whose roster row has no card number stay NULL and keep using
-- roster_id (there are no codes for a cardless row anyway).
UPDATE "member_links" ml
SET "card_number" = r."card_number"
FROM "roster" r
WHERE r."id" = ml."roster_id"
  AND ml."card_number" IS NULL;
