-- Each offer belongs to the consumer (PARTNER_KEYS name) that made it; another consumer's request for
-- it answers 404. Offers made before consumers had names were all made by Kazi Connect, Sherehe's only
-- partner, so they are filed under 'kazi'.
ALTER TABLE offers ADD COLUMN partner text;
UPDATE offers SET partner = 'kazi' WHERE partner IS NULL;
ALTER TABLE offers ALTER COLUMN partner SET NOT NULL;
