ALTER TABLE public.food_records
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS common_serving_label text,
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS food_records_source_idx ON public.food_records(source) WHERE active;
CREATE INDEX IF NOT EXISTS food_records_verified_idx ON public.food_records(verified) WHERE active;

UPDATE public.food_records SET verified = (verification_status = 'verified') WHERE source IS NULL;