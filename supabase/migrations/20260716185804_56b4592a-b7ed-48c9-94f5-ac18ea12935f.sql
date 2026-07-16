
-- Manual macro targets and profile-updated tracking on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS manual_targets_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS target_calories integer,
  ADD COLUMN IF NOT EXISTS target_protein_g integer,
  ADD COLUMN IF NOT EXISTS target_carbs_g integer,
  ADD COLUMN IF NOT EXISTS target_fat_g integer,
  ADD COLUMN IF NOT EXISTS profile_details_updated_at timestamptz;

-- Broad validation ranges. Immutable checks are fine here (constant bounds).
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS target_calories_range,
  DROP CONSTRAINT IF EXISTS target_protein_range,
  DROP CONSTRAINT IF EXISTS target_carbs_range,
  DROP CONSTRAINT IF EXISTS target_fat_range;

ALTER TABLE public.profiles
  ADD CONSTRAINT target_calories_range
    CHECK (target_calories IS NULL OR (target_calories >= 500 AND target_calories <= 10000)),
  ADD CONSTRAINT target_protein_range
    CHECK (target_protein_g IS NULL OR (target_protein_g >= 0 AND target_protein_g <= 1000)),
  ADD CONSTRAINT target_carbs_range
    CHECK (target_carbs_g IS NULL OR (target_carbs_g >= 0 AND target_carbs_g <= 1000)),
  ADD CONSTRAINT target_fat_range
    CHECK (target_fat_g IS NULL OR (target_fat_g >= 0 AND target_fat_g <= 1000));

-- Beta usage limits managed via app_settings. Founder can tune without redeploy.
INSERT INTO public.app_settings (key, value) VALUES
  ('beta_limits_enabled', 'true'::jsonb),
  ('beta_daily_submission_cap', '20'::jsonb),
  ('beta_max_input_length', '500'::jsonb),
  ('beta_max_foods_per_submission', '10'::jsonb)
ON CONFLICT (key) DO NOTHING;
