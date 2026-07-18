
-- ============================================================
-- Food intelligence schema (phase 1)
-- ============================================================

-- Enum for verification status shared across catalog tables.
DO $$ BEGIN
  CREATE TYPE public.food_verification_status AS ENUM ('unverified', 'pending', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- food_sources ----------
CREATE TABLE IF NOT EXISTS public.food_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL UNIQUE,
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  license_name TEXT,
  license_url TEXT,
  attribution_text TEXT,
  import_method TEXT,
  last_imported_at TIMESTAMPTZ,
  source_version TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.food_sources TO anon, authenticated;
GRANT ALL ON public.food_sources TO service_role;
ALTER TABLE public.food_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "food_sources public read" ON public.food_sources FOR SELECT USING (enabled = TRUE OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'));
CREATE POLICY "food_sources admin write" ON public.food_sources FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'));
CREATE TRIGGER trg_food_sources_updated BEFORE UPDATE ON public.food_sources FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- brands ----------
CREATE TABLE IF NOT EXISTS public.brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  country_code TEXT,
  website TEXT,
  verification_status public.food_verification_status NOT NULL DEFAULT 'unverified',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.brands TO anon, authenticated;
GRANT ALL ON public.brands TO service_role;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brands public read" ON public.brands FOR SELECT USING (TRUE);
CREATE POLICY "brands admin write" ON public.brands FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'));
CREATE TRIGGER trg_brands_updated BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- restaurant_chains ----------
CREATE TABLE IF NOT EXISTS public.restaurant_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  country_code TEXT,
  official_nutrition_url TEXT,
  verification_status public.food_verification_status NOT NULL DEFAULT 'unverified',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.restaurant_chains TO anon, authenticated;
GRANT ALL ON public.restaurant_chains TO service_role;
ALTER TABLE public.restaurant_chains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "restaurant_chains public read" ON public.restaurant_chains FOR SELECT USING (TRUE);
CREATE POLICY "restaurant_chains admin write" ON public.restaurant_chains FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'));
CREATE TRIGGER trg_restaurant_chains_updated BEFORE UPDATE ON public.restaurant_chains FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- food_records ----------
CREATE TABLE IF NOT EXISTS public.food_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  local_name TEXT,
  food_type TEXT NOT NULL DEFAULT 'generic'
    CHECK (food_type IN ('generic','branded','restaurant','recipe','user_custom')),
  country_code TEXT NOT NULL DEFAULT 'PH',
  market_region TEXT,
  brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  restaurant_id UUID REFERENCES public.restaurant_chains(id) ON DELETE SET NULL,
  barcode TEXT,
  category TEXT NOT NULL,
  preparation_state TEXT NOT NULL DEFAULT 'n_a' CHECK (preparation_state IN ('raw','cooked','n_a')),
  preparation_variant TEXT,          -- e.g. skinless, skin_on, lean, fatty, carinderia, home_style, garlic
  edible_portion NUMERIC(4,3) NOT NULL DEFAULT 1.000 CHECK (edible_portion > 0 AND edible_portion <= 1),
  default_serving_grams NUMERIC(8,2),
  calories_per_100g NUMERIC(8,2) NOT NULL CHECK (calories_per_100g >= 0 AND calories_per_100g <= 1200),
  protein_per_100g NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (protein_per_100g >= 0 AND protein_per_100g <= 200),
  carbs_per_100g NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (carbs_per_100g >= 0 AND carbs_per_100g <= 200),
  fat_per_100g NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (fat_per_100g >= 0 AND fat_per_100g <= 200),
  fiber_per_100g NUMERIC(8,2),
  sugar_per_100g NUMERIC(8,2),
  sodium_mg_per_100g NUMERIC(8,2),
  source_id UUID REFERENCES public.food_sources(id) ON DELETE SET NULL,
  source_food_id TEXT,
  verification_status public.food_verification_status NOT NULL DEFAULT 'verified',
  confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.90 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INT NOT NULL DEFAULT 1,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (barcode)
);
CREATE INDEX IF NOT EXISTS food_records_active_idx ON public.food_records(active) WHERE active;
CREATE INDEX IF NOT EXISTS food_records_category_idx ON public.food_records(category);
CREATE INDEX IF NOT EXISTS food_records_food_type_idx ON public.food_records(food_type);
CREATE INDEX IF NOT EXISTS food_records_display_trgm ON public.food_records USING gin (lower(display_name) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS food_records_canonical_trgm ON public.food_records USING gin (lower(canonical_name) extensions.gin_trgm_ops);
GRANT SELECT ON public.food_records TO anon, authenticated;
GRANT ALL ON public.food_records TO service_role;
ALTER TABLE public.food_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "food_records public read" ON public.food_records FOR SELECT
  USING (active = TRUE OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'));
CREATE POLICY "food_records admin write" ON public.food_records FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'));
CREATE TRIGGER trg_food_records_updated BEFORE UPDATE ON public.food_records FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- food_aliases ----------
CREATE TABLE IF NOT EXISTS public.food_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_record_id UUID NOT NULL REFERENCES public.food_records(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  region TEXT,
  alias_type TEXT NOT NULL DEFAULT 'translation'
    CHECK (alias_type IN ('translation','nickname','misspelling','menu_name','brand_variant','canonical')),
  priority INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized_alias, food_record_id)
);
CREATE INDEX IF NOT EXISTS food_aliases_norm_idx ON public.food_aliases(normalized_alias);
CREATE INDEX IF NOT EXISTS food_aliases_trgm ON public.food_aliases USING gin (normalized_alias extensions.gin_trgm_ops);
GRANT SELECT ON public.food_aliases TO anon, authenticated;
GRANT ALL ON public.food_aliases TO service_role;
ALTER TABLE public.food_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "food_aliases public read" ON public.food_aliases FOR SELECT USING (TRUE);
CREATE POLICY "food_aliases admin write" ON public.food_aliases FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'));

-- ---------- serving_options ----------
CREATE TABLE IF NOT EXISTS public.serving_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_record_id UUID NOT NULL REFERENCES public.food_records(id) ON DELETE CASCADE,
  serving_name TEXT NOT NULL,
  grams NUMERIC(8,2) NOT NULL CHECK (grams > 0),
  household_measure TEXT,
  local_measure TEXT,
  verified BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (food_record_id, serving_name)
);
GRANT SELECT ON public.serving_options TO anon, authenticated;
GRANT ALL ON public.serving_options TO service_role;
ALTER TABLE public.serving_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "serving_options public read" ON public.serving_options FOR SELECT USING (TRUE);
CREATE POLICY "serving_options admin write" ON public.serving_options FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'));

-- ---------- recipe_profiles ----------
CREATE TABLE IF NOT EXISTS public.recipe_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_food_id UUID NOT NULL REFERENCES public.food_records(id) ON DELETE CASCADE,
  recipe_name TEXT NOT NULL,
  region TEXT,
  preparation_method TEXT,
  ingredient_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  cooked_yield_grams NUMERIC(8,2),
  oil_absorption_assumption NUMERIC(5,2),
  verification_status public.food_verification_status NOT NULL DEFAULT 'unverified',
  confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.80 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.recipe_profiles TO anon, authenticated;
GRANT ALL ON public.recipe_profiles TO service_role;
ALTER TABLE public.recipe_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recipe_profiles public read" ON public.recipe_profiles FOR SELECT USING (TRUE);
CREATE POLICY "recipe_profiles admin write" ON public.recipe_profiles FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'));
CREATE TRIGGER trg_recipe_profiles_updated BEFORE UPDATE ON public.recipe_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- food_revisions ----------
CREATE TABLE IF NOT EXISTS public.food_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_record_id UUID NOT NULL REFERENCES public.food_records(id) ON DELETE CASCADE,
  previous_values JSONB NOT NULL,
  proposed_values JSONB NOT NULL,
  change_reason TEXT,
  source_id UUID REFERENCES public.food_sources(id) ON DELETE SET NULL,
  submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  review_status public.food_verification_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_revisions TO authenticated;
GRANT ALL ON public.food_revisions TO service_role;
ALTER TABLE public.food_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "food_revisions admin read" ON public.food_revisions FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder') OR submitted_by = auth.uid());
CREATE POLICY "food_revisions user insert" ON public.food_revisions FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth.uid());
CREATE POLICY "food_revisions admin update" ON public.food_revisions FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'));

-- ---------- food_submissions ----------
CREATE TABLE IF NOT EXISTS public.food_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitting_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  barcode TEXT,
  product_name TEXT,
  brand TEXT,
  front_image_path TEXT,
  nutrition_label_image_path TEXT,
  serving_size TEXT,
  extracted_values JSONB,
  review_status public.food_verification_status NOT NULL DEFAULT 'pending',
  duplicate_candidate_id UUID REFERENCES public.food_records(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_submissions TO authenticated;
GRANT ALL ON public.food_submissions TO service_role;
ALTER TABLE public.food_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "food_submissions user read own" ON public.food_submissions FOR SELECT TO authenticated
  USING (submitting_user_id = auth.uid() OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'));
CREATE POLICY "food_submissions user insert" ON public.food_submissions FOR INSERT TO authenticated
  WITH CHECK (submitting_user_id = auth.uid());
CREATE POLICY "food_submissions admin update" ON public.food_submissions FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'));

-- ---------- food_match_cache ----------
CREATE TABLE IF NOT EXISTS public.food_match_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_query TEXT NOT NULL,
  preparation_state TEXT,
  matched_food_id UUID REFERENCES public.food_records(id) ON DELETE CASCADE,
  match_type TEXT,
  confidence_score NUMERIC(3,2),
  hit_count INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  database_version INT NOT NULL DEFAULT 1,
  UNIQUE (normalized_query, preparation_state)
);
CREATE INDEX IF NOT EXISTS food_match_cache_q_idx ON public.food_match_cache(normalized_query);
GRANT SELECT ON public.food_match_cache TO anon, authenticated;
GRANT ALL ON public.food_match_cache TO service_role;
ALTER TABLE public.food_match_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "food_match_cache public read" ON public.food_match_cache FOR SELECT USING (TRUE);
CREATE POLICY "food_match_cache admin write" ON public.food_match_cache FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'founder'));

-- ============================================================
-- Seed data
-- ============================================================

INSERT INTO public.food_sources (source_name, source_type, license_name, attribution_text, enabled)
VALUES ('kainfit_manual_seed_v1','manual','internal','KainFit founder-curated Filipino food seed, phase 1.', TRUE)
ON CONFLICT (source_name) DO NOTHING;

-- Helper: seed food_records + one canonical alias.
-- Columns:
--   canonical_name, display_name, category, prep_state, prep_variant,
--   default_serving_grams, kcal, protein, carbs, fat
DO $$
DECLARE
  src_id UUID;
  rec_id UUID;
  r RECORD;
BEGIN
  SELECT id INTO src_id FROM public.food_sources WHERE source_name = 'kainfit_manual_seed_v1';

  FOR r IN
    SELECT * FROM (VALUES
      -- ---------------- Generic staples ----------------
      ('rice_white_cooked','White rice (cooked)','grain','cooked',NULL,158, 130,2.7,28.2,0.3),
      ('rice_white_raw','White rice (raw, uncooked)','grain','raw',NULL,45, 365,7.1,80.0,0.7),
      ('rice_brown_cooked','Brown rice (cooked)','grain','cooked',NULL,195, 123,2.7,25.6,1.0),
      ('rice_brown_raw','Brown rice (raw, uncooked)','grain','raw',NULL,45, 370,7.9,77.2,2.9),
      ('garlic_rice','Garlic rice (sinangag)','grain','cooked','garlic',158, 180,3.2,29.0,5.0),
      ('fried_rice','Fried rice','grain','cooked',NULL,158, 200,3.5,30.0,6.5),
      ('pandesal','Pandesal','bread','n_a',NULL,25, 300,8.5,55.0,4.0),
      ('bread_white','White bread','bread','n_a',NULL,28, 265,9.0,49.0,3.2),
      ('egg_boiled','Egg, boiled','egg','cooked',NULL,50, 155,12.6,1.1,10.6),
      ('egg_fried','Egg, fried (in oil)','egg','cooked',NULL,55, 200,13.6,0.8,15.3),
      ('egg_scrambled','Egg, scrambled','egg','cooked',NULL,60, 165,11.0,1.6,12.2),
      -- ---------------- Meats ----------------
      ('chicken_breast_raw','Chicken breast, skinless (raw)','meat','raw',NULL,150, 120,22.5,0.0,2.6),
      ('chicken_breast_cooked','Chicken breast, skinless (cooked)','meat','cooked',NULL,120, 165,31.0,0.0,3.6),
      ('chicken_thigh_raw','Chicken thigh, skinless (raw)','meat','raw',NULL,150, 143,17.4,0.0,8.0),
      ('chicken_thigh_cooked','Chicken thigh, skinless (cooked)','meat','cooked',NULL,120, 209,26.0,0.0,10.9),
      ('pork_belly_raw','Pork belly (raw)','meat','raw',NULL,150, 518,9.3,0.0,53.0),
      ('pork_belly_cooked','Pork belly (cooked)','meat','cooked',NULL,120, 545,10.4,0.0,55.7),
      ('pork_shoulder_raw','Pork shoulder (raw)','meat','raw',NULL,150, 220,17.4,0.0,16.4),
      ('pork_shoulder_cooked','Pork shoulder (cooked)','meat','cooked',NULL,120, 269,24.5,0.0,18.6),
      ('beef_sirloin_raw','Beef sirloin (raw)','meat','raw',NULL,150, 200,20.0,0.0,13.0),
      ('beef_sirloin_cooked','Beef sirloin (cooked)','meat','cooked',NULL,120, 240,28.0,0.0,14.0),
      -- ---------------- Fish + tofu + legumes ----------------
      ('tilapia_raw','Tilapia (raw)','fish','raw',NULL,150, 96,20.1,0.0,1.7),
      ('tilapia_cooked','Tilapia (cooked)','fish','cooked',NULL,120, 128,26.2,0.0,2.7),
      ('bangus_raw','Bangus / milkfish (raw)','fish','raw',NULL,150, 148,20.5,0.0,6.7),
      ('bangus_cooked','Bangus / milkfish (cooked)','fish','cooked',NULL,120, 195,25.0,0.0,10.0),
      ('galunggong_raw','Galunggong / mackerel scad (raw)','fish','raw',NULL,150, 130,22.0,0.0,4.5),
      ('galunggong_fried','Galunggong, fried','fish','cooked','fried',120, 210,24.0,1.0,12.5),
      ('tuna_canned_drained','Tuna, canned in water, drained','fish','n_a',NULL,90, 116,25.5,0.0,1.0),
      ('tofu_firm','Tofu, firm','plant_protein','n_a',NULL,100, 144,15.8,2.8,8.7),
      ('mung_beans_cooked','Mung beans / mongo (cooked)','legume','cooked',NULL,200, 105,7.0,19.2,0.4),
      -- ---------------- Vegetables ----------------
      ('kangkong_cooked','Kangkong / water spinach (cooked)','vegetable','cooked',NULL,90, 26,2.6,3.9,0.3),
      ('malunggay_leaves','Malunggay leaves (cooked)','vegetable','cooked',NULL,80, 40,3.7,5.7,0.3),
      ('sitaw_cooked','Sitaw / string beans (cooked)','vegetable','cooked',NULL,100, 47,2.8,8.4,0.4),
      ('talong_grilled','Talong / eggplant, grilled','vegetable','cooked',NULL,90, 35,0.8,8.6,0.2),
      ('ampalaya_cooked','Ampalaya / bitter gourd (cooked)','vegetable','cooked',NULL,90, 19,0.9,4.3,0.2),
      ('kalabasa_cooked','Kalabasa / squash (cooked)','vegetable','cooked',NULL,100, 34,1.0,8.6,0.1),
      -- ---------------- Fruits ----------------
      ('banana_lakatan','Banana, lakatan','fruit','n_a',NULL,120, 89,1.1,22.8,0.3),
      ('mango_ripe','Mango, ripe','fruit','n_a',NULL,165, 60,0.8,15.0,0.4),
      ('papaya_ripe','Papaya, ripe','fruit','n_a',NULL,145, 43,0.5,10.8,0.3),
      ('pineapple','Pineapple','fruit','n_a',NULL,165, 50,0.5,13.1,0.1),
      -- ---------------- Prepared Filipino dishes (canonical + variants) ----------------
      ('chicken_adobo_skinless','Chicken adobo, skinless (home-style)','filipino_dish','cooked','skinless',180, 165,18.0,3.0,8.5),
      ('chicken_adobo_skin_on','Chicken adobo, skin-on (home-style)','filipino_dish','cooked','skin_on',180, 215,17.0,3.0,14.5),
      ('chicken_adobo_carinderia','Chicken adobo, carinderia-style','filipino_dish','cooked','carinderia',180, 235,15.0,4.0,17.5),
      ('pork_adobo_lean','Pork adobo, lean (home-style)','filipino_dish','cooked','lean',180, 210,17.5,3.0,14.0),
      ('pork_adobo_fatty','Pork adobo, fatty (home-style)','filipino_dish','cooked','fatty',180, 320,15.0,3.0,28.0),
      ('sinigang_baboy','Sinigang na baboy','filipino_dish','cooked',NULL,300, 95,7.5,4.0,5.5),
      ('sinigang_bangus','Sinigang na bangus','filipino_dish','cooked',NULL,300, 85,9.5,3.5,3.5),
      ('tinola','Tinolang manok','filipino_dish','cooked',NULL,300, 80,8.0,3.5,3.8),
      ('nilaga_baka','Nilagang baka','filipino_dish','cooked',NULL,300, 110,11.0,4.5,5.5),
      ('bulalo','Bulalo','filipino_dish','cooked',NULL,350, 130,10.5,3.0,8.5),
      ('kare_kare','Kare-kare','filipino_dish','cooked',NULL,250, 195,10.0,10.0,13.0),
      ('sisig','Sisig','filipino_dish','cooked',NULL,180, 280,17.0,3.0,22.0),
      ('bistek_tagalog','Bistek Tagalog','filipino_dish','cooked',NULL,180, 200,20.0,4.0,11.0),
      ('chicken_inasal','Chicken inasal','filipino_dish','cooked',NULL,220, 210,25.0,2.0,11.5),
      ('lechon_kawali','Lechon kawali','filipino_dish','cooked',NULL,150, 385,20.0,0.5,33.0),
      ('lechon','Lechon (roasted pig)','filipino_dish','cooked',NULL,150, 375,22.0,0.0,31.0),
      ('dinuguan','Dinuguan','filipino_dish','cooked',NULL,240, 175,13.0,4.0,12.0),
      ('pinakbet','Pinakbet','filipino_dish','cooked',NULL,220, 90,4.0,10.0,4.0),
      ('laing','Laing','filipino_dish','cooked',NULL,180, 175,4.0,8.0,14.5),
      ('bicol_express','Bicol Express','filipino_dish','cooked',NULL,180, 235,10.0,6.0,19.0),
      ('caldereta','Caldereta','filipino_dish','cooked',NULL,250, 195,13.0,8.0,12.0),
      ('menudo','Menudo','filipino_dish','cooked',NULL,250, 175,11.0,10.0,10.0),
      ('afritada','Afritada','filipino_dish','cooked',NULL,250, 170,11.0,10.0,9.5),
      ('tocino','Tocino (pork)','filipino_dish','cooked',NULL,120, 280,15.0,10.0,20.0),
      ('tapa','Beef tapa','filipino_dish','cooked',NULL,120, 245,25.0,4.0,14.0),
      ('longganisa_pork','Longganisa (pork)','filipino_dish','cooked',NULL,60, 330,14.0,10.0,26.0),
      ('lumpia_shanghai','Lumpiang Shanghai','filipino_dish','cooked',NULL,25, 285,10.0,22.0,17.5),
      ('lumpia_ubod','Fresh lumpia (ubod)','filipino_dish','cooked',NULL,130, 135,5.5,17.0,4.5),
      ('pancit_canton','Pancit canton','filipino_dish','cooked',NULL,180, 190,7.5,26.0,6.5),
      ('pancit_bihon','Pancit bihon','filipino_dish','cooked',NULL,180, 175,6.0,28.0,4.5),
      ('pancit_palabok','Pancit palabok','filipino_dish','cooked',NULL,200, 205,9.0,28.0,6.5),
      ('arroz_caldo','Arroz caldo','filipino_dish','cooked',NULL,300, 85,4.0,13.0,2.0),
      ('lugaw','Lugaw (plain rice porridge)','filipino_dish','cooked',NULL,300, 55,1.2,11.5,0.4),
      ('champorado','Champorado','filipino_dish','cooked',NULL,240, 130,2.5,25.0,2.5),
      ('turon','Turon','filipino_dish','cooked',NULL,80, 245,2.0,42.0,8.5),
      ('halo_halo','Halo-halo','filipino_dish','cooked',NULL,350, 130,2.5,25.0,2.5),
      ('embutido','Embutido','filipino_dish','cooked',NULL,120, 230,13.0,8.0,16.0),
      ('paksiw_lechon','Paksiw na lechon','filipino_dish','cooked',NULL,180, 265,17.0,5.0,20.0),
      ('ginataang_gulay','Ginataang gulay','filipino_dish','cooked',NULL,220, 130,3.5,9.5,9.0)
    ) AS t(canonical_name, display_name, category, prep_state, prep_variant, dsg, kcal, prot, carb, fat)
  LOOP
    INSERT INTO public.food_records (
      canonical_name, display_name, category, food_type,
      preparation_state, preparation_variant, default_serving_grams,
      calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
      source_id, verification_status, confidence_score
    ) VALUES (
      r.canonical_name, r.display_name, r.category,
      CASE WHEN r.category = 'filipino_dish' THEN 'recipe' ELSE 'generic' END,
      r.prep_state, r.prep_variant, r.dsg, r.kcal, r.prot, r.carb, r.fat,
      src_id, 'verified', 0.92
    )
    ON CONFLICT (canonical_name) DO NOTHING
    RETURNING id INTO rec_id;

    -- Canonical alias = display_name lowercased (skip if row already existed)
    IF rec_id IS NOT NULL THEN
      INSERT INTO public.food_aliases (food_record_id, alias, normalized_alias, language, alias_type, priority)
      VALUES (rec_id, r.display_name, lower(r.display_name), 'en', 'canonical', 10)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- Additional user-phrasing aliases
DO $$
DECLARE
  a RECORD;
  fid UUID;
BEGIN
  FOR a IN
    SELECT * FROM (VALUES
      ('rice_white_cooked','white rice','en','translation'),
      ('rice_white_cooked','kanin','tl','translation'),
      ('rice_white_cooked','plain rice','en','nickname'),
      ('rice_white_cooked','cooked rice','en','nickname'),
      ('rice_white_cooked','steamed rice','en','nickname'),
      ('rice_brown_cooked','brown rice','en','translation'),
      ('rice_brown_cooked','brown rice cooked','en','nickname'),
      ('garlic_rice','sinangag','tl','translation'),
      ('garlic_rice','sinangag rice','tl','nickname'),
      ('pandesal','pan de sal','tl','nickname'),
      ('pandesal','pan desal','tl','misspelling'),
      ('egg_boiled','boiled egg','en','translation'),
      ('egg_boiled','hard boiled egg','en','nickname'),
      ('egg_boiled','itlog na pinakuluan','tl','translation'),
      ('egg_fried','fried egg','en','translation'),
      ('egg_fried','sunny side up','en','nickname'),
      ('egg_fried','pritong itlog','tl','translation'),
      ('egg_scrambled','scrambled egg','en','translation'),
      ('egg_scrambled','scrambled eggs','en','translation'),
      ('chicken_breast_cooked','chicken breast','en','nickname'),
      ('chicken_breast_cooked','grilled chicken breast','en','nickname'),
      ('chicken_thigh_cooked','chicken thigh','en','nickname'),
      ('pork_belly_cooked','pork belly','en','nickname'),
      ('pork_belly_cooked','liempo','tl','translation'),
      ('pork_shoulder_cooked','pork shoulder','en','nickname'),
      ('pork_shoulder_cooked','kasim','tl','translation'),
      ('tilapia_cooked','tilapia','en','nickname'),
      ('bangus_cooked','bangus','tl','translation'),
      ('bangus_cooked','milkfish','en','translation'),
      ('galunggong_fried','galunggong','tl','translation'),
      ('galunggong_fried','fried galunggong','tl','nickname'),
      ('tuna_canned_drained','canned tuna','en','translation'),
      ('tuna_canned_drained','tuna in water','en','nickname'),
      ('tofu_firm','tofu','en','translation'),
      ('tofu_firm','tokwa','tl','translation'),
      ('mung_beans_cooked','mongo','tl','translation'),
      ('mung_beans_cooked','monggo','tl','misspelling'),
      ('mung_beans_cooked','mung beans','en','translation'),
      ('kangkong_cooked','kangkong','tl','translation'),
      ('kangkong_cooked','water spinach','en','translation'),
      ('malunggay_leaves','malunggay','tl','translation'),
      ('malunggay_leaves','moringa','en','translation'),
      ('sitaw_cooked','sitaw','tl','translation'),
      ('sitaw_cooked','string beans','en','translation'),
      ('talong_grilled','talong','tl','translation'),
      ('talong_grilled','eggplant','en','translation'),
      ('ampalaya_cooked','ampalaya','tl','translation'),
      ('ampalaya_cooked','bitter gourd','en','translation'),
      ('kalabasa_cooked','kalabasa','tl','translation'),
      ('kalabasa_cooked','squash','en','translation'),
      ('banana_lakatan','banana','en','translation'),
      ('banana_lakatan','saging','tl','translation'),
      ('banana_lakatan','lakatan','tl','nickname'),
      ('mango_ripe','mango','en','translation'),
      ('mango_ripe','mangga','tl','translation'),
      ('papaya_ripe','papaya','en','translation'),
      ('pineapple','pinya','tl','translation'),
      -- Dishes
      ('chicken_adobo_skinless','chicken adobo','en','nickname'),
      ('chicken_adobo_skinless','adobong manok','tl','translation'),
      ('chicken_adobo_skinless','adobo manok','tl','nickname'),
      ('chicken_adobo_skin_on','chicken adobo skin on','en','nickname'),
      ('chicken_adobo_skin_on','chicken adobo with skin','en','nickname'),
      ('pork_adobo_lean','pork adobo','en','nickname'),
      ('pork_adobo_lean','adobong baboy','tl','translation'),
      ('pork_adobo_fatty','pork adobo fatty','en','nickname'),
      ('pork_adobo_fatty','fatty pork adobo','en','nickname'),
      ('sinigang_baboy','sinigang','tl','nickname'),
      ('sinigang_baboy','pork sinigang','en','translation'),
      ('sinigang_baboy','sinigang na baboy','tl','translation'),
      ('sinigang_bangus','sinigang na bangus','tl','translation'),
      ('sinigang_bangus','fish sinigang','en','translation'),
      ('tinola','tinolang manok','tl','translation'),
      ('tinola','chicken tinola','en','translation'),
      ('nilaga_baka','nilagang baka','tl','translation'),
      ('nilaga_baka','beef nilaga','en','translation'),
      ('bulalo','bulalo soup','en','nickname'),
      ('kare_kare','kare kare','en','misspelling'),
      ('kare_kare','karekare','en','misspelling'),
      ('sisig','pork sisig','en','translation'),
      ('bistek_tagalog','bistek','tl','nickname'),
      ('bistek_tagalog','beef steak filipino','en','nickname'),
      ('chicken_inasal','inasal','tl','nickname'),
      ('chicken_inasal','inasal na manok','tl','translation'),
      ('lechon_kawali','lechon kawali','tl','translation'),
      ('lechon_kawali','crispy pork belly','en','nickname'),
      ('lechon','lechon baboy','tl','translation'),
      ('lechon','roasted pig','en','translation'),
      ('dinuguan','dinuguan','tl','translation'),
      ('dinuguan','pork blood stew','en','translation'),
      ('pinakbet','pakbet','tl','misspelling'),
      ('laing','laing','tl','translation'),
      ('bicol_express','bicol express','tl','translation'),
      ('caldereta','kaldereta','tl','misspelling'),
      ('caldereta','beef caldereta','en','translation'),
      ('menudo','pork menudo','en','translation'),
      ('afritada','chicken afritada','en','translation'),
      ('tocino','pork tocino','tl','translation'),
      ('tapa','beef tapa','en','translation'),
      ('tapa','tapsilog beef','en','nickname'),
      ('longganisa_pork','longganisa','tl','translation'),
      ('longganisa_pork','longsilog sausage','tl','nickname'),
      ('lumpia_shanghai','lumpiang shanghai','tl','translation'),
      ('lumpia_shanghai','shanghai rolls','en','nickname'),
      ('lumpia_ubod','fresh lumpia','en','translation'),
      ('lumpia_ubod','lumpiang ubod','tl','translation'),
      ('pancit_canton','canton','tl','nickname'),
      ('pancit_bihon','bihon','tl','nickname'),
      ('pancit_palabok','palabok','tl','nickname'),
      ('arroz_caldo','goto','tl','nickname'),
      ('arroz_caldo','arroz caldo','tl','translation'),
      ('lugaw','plain lugaw','tl','translation'),
      ('champorado','tsampurado','tl','misspelling'),
      ('turon','banana turon','en','translation'),
      ('halo_halo','halohalo','tl','misspelling'),
      ('halo_halo','halo halo','tl','nickname'),
      ('embutido','filipino embutido','en','translation')
    ) AS t(canonical, alias, lang, atype)
  LOOP
    SELECT id INTO fid FROM public.food_records WHERE canonical_name = a.canonical;
    IF fid IS NOT NULL THEN
      INSERT INTO public.food_aliases (food_record_id, alias, normalized_alias, language, alias_type, priority)
      VALUES (fid, a.alias, lower(a.alias), a.lang, a.atype, 50)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- Common household servings for staples.
DO $$
DECLARE
  s RECORD;
  fid UUID;
BEGIN
  FOR s IN
    SELECT * FROM (VALUES
      ('rice_white_cooked','1 cup', 158, '1 cup', '1 tasa'),
      ('rice_white_cooked','half cup', 79, '1/2 cup', 'kalahating tasa'),
      ('rice_white_cooked','1 bowl', 200, '1 bowl', '1 mangkok'),
      ('rice_brown_cooked','1 cup', 195, '1 cup', '1 tasa'),
      ('garlic_rice','1 cup', 158, '1 cup', '1 tasa'),
      ('pandesal','1 piece', 25, '1 piece', '1 piraso'),
      ('bread_white','1 slice', 28, '1 slice', '1 hiwa'),
      ('egg_boiled','1 piece', 50, '1 large egg', '1 itlog'),
      ('egg_fried','1 piece', 55, '1 large egg', '1 itlog'),
      ('egg_scrambled','1 serving', 60, '1 egg scrambled', '1 itlog'),
      ('chicken_adobo_skinless','1 serving', 180, '1 serving', '1 bahagi'),
      ('sinigang_baboy','1 bowl', 300, '1 bowl', '1 mangkok'),
      ('tinola','1 bowl', 300, '1 bowl', '1 mangkok'),
      ('bulalo','1 bowl', 350, '1 bowl', '1 mangkok'),
      ('lumpia_shanghai','1 piece', 25, '1 piece', '1 piraso'),
      ('pancit_canton','1 serving', 180, '1 serving', '1 bahagi'),
      ('turon','1 piece', 80, '1 piece', '1 piraso')
    ) AS t(canonical, sname, grams, hh, local)
  LOOP
    SELECT id INTO fid FROM public.food_records WHERE canonical_name = s.canonical;
    IF fid IS NOT NULL THEN
      INSERT INTO public.serving_options (food_record_id, serving_name, grams, household_measure, local_measure)
      VALUES (fid, s.sname, s.grams, s.hh, s.local)
      ON CONFLICT (food_record_id, serving_name) DO NOTHING;
    END IF;
  END LOOP;
END $$;
