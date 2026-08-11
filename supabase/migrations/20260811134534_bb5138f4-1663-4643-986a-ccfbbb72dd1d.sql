ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS protein_target_updated_at TIMESTAMPTZ;

UPDATE public.profiles
SET protein_target_updated_at = now()
WHERE target_protein_g IS NOT NULL
  AND protein_target_updated_at IS NULL;

CREATE OR REPLACE FUNCTION public.touch_protein_target_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.target_protein_g IS DISTINCT FROM OLD.target_protein_g THEN
    NEW.protein_target_updated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_touch_protein_target_updated_at ON public.profiles;
CREATE TRIGGER trg_touch_protein_target_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_protein_target_updated_at();

ALTER TABLE public.kain_signal_insights
  DROP CONSTRAINT IF EXISTS kain_signal_insights_insight_type_check;

ALTER TABLE public.kain_signal_insights
  ADD CONSTRAINT kain_signal_insights_insight_type_check
  CHECK (insight_type IN (
    'protein_adherence',
    'logging_consistency',
    'behavior_milestone',
    'protein_calorie_relationship',
    'protein_meal_position',
    'weekday_weekend_pattern',
    'trend_shift'
  ));

-- Security: demo_usage is managed only through trusted server-side paths.
REVOKE ALL ON public.demo_usage FROM anon, authenticated;
GRANT ALL ON public.demo_usage TO service_role;