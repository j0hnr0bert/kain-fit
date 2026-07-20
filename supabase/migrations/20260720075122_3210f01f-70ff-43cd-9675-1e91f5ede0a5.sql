
-- Add source tiering + brand text + last verified date to food_records
ALTER TABLE public.food_records
  ADD COLUMN IF NOT EXISTS brand_name text,
  ADD COLUMN IF NOT EXISTS source_priority smallint,
  ADD COLUMN IF NOT EXISTS last_verified_date date;

-- Map source -> priority + default verified. Lower = higher trust.
CREATE OR REPLACE FUNCTION public.food_records_apply_source_tier()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s text := lower(coalesce(NEW.source, 'manual'));
BEGIN
  NEW.source := s;
  NEW.source_priority := CASE s
    WHEN 'philfct' THEN 1
    WHEN 'manufacturer' THEN 2
    WHEN 'restaurant' THEN 3
    WHEN 'openfoodfacts' THEN 4
    WHEN 'commercial_api' THEN 5
    ELSE 6 -- manual / unknown
  END;
  -- Only auto-set verified when caller didn't explicitly pass true.
  IF NEW.verified IS NULL OR NEW.verified = false THEN
    NEW.verified := s IN ('philfct','manufacturer','restaurant');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_food_records_source_tier ON public.food_records;
CREATE TRIGGER trg_food_records_source_tier
  BEFORE INSERT OR UPDATE OF source ON public.food_records
  FOR EACH ROW EXECUTE FUNCTION public.food_records_apply_source_tier();

-- Backfill existing rows.
UPDATE public.food_records
   SET source_priority = CASE lower(coalesce(source,'manual'))
     WHEN 'philfct' THEN 1
     WHEN 'manufacturer' THEN 2
     WHEN 'restaurant' THEN 3
     WHEN 'openfoodfacts' THEN 4
     WHEN 'commercial_api' THEN 5
     ELSE 6
   END
 WHERE source_priority IS NULL;

-- Guard the source enum values.
ALTER TABLE public.food_records
  DROP CONSTRAINT IF EXISTS food_records_source_check;
ALTER TABLE public.food_records
  ADD CONSTRAINT food_records_source_check
  CHECK (source IS NULL OR source IN ('philfct','manufacturer','restaurant','openfoodfacts','commercial_api','manual'));

-- Indexes to support ranked search + barcode fast-path.
CREATE INDEX IF NOT EXISTS idx_food_records_source_priority ON public.food_records (source_priority);
CREATE INDEX IF NOT EXISTS idx_food_records_barcode ON public.food_records (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_food_records_brand_name ON public.food_records (lower(brand_name)) WHERE brand_name IS NOT NULL;
