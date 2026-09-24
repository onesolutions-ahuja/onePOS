-- Global reference metadata only; safe to apply repeatedly.
ALTER TABLE ean_product_master ADD COLUMN IF NOT EXISTS image_url TEXT NULL;
ALTER TABLE ean_product_master ADD COLUMN IF NOT EXISTS source TEXT NULL;
