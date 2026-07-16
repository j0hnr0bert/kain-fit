
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.verified_foods (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  category TEXT NOT NULL,
  default_serving_grams NUMERIC(8,2),
  kcal_per_100g NUMERIC(8,2) NOT NULL,
  protein_per_100g NUMERIC(8,2) NOT NULL DEFAULT 0,
  carbs_per_100g NUMERIC(8,2) NOT NULL DEFAULT 0,
  fat_per_100g NUMERIC(8,2) NOT NULL DEFAULT 0,
  preparation_state TEXT NOT NULL DEFAULT 'n_a' CHECK (preparation_state IN ('raw','cooked','n_a')),
  raw_to_cooked_ratio NUMERIC(6,3),
  source TEXT NOT NULL DEFAULT 'manual',
  source_notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kcal_per_100g >= 0 AND kcal_per_100g <= 1200),
  CHECK (protein_per_100g >= 0 AND protein_per_100g <= 200),
  CHECK (carbs_per_100g >= 0 AND carbs_per_100g <= 200),
  CHECK (fat_per_100g >= 0 AND fat_per_100g <= 200)
);

CREATE INDEX verified_foods_active_idx ON public.verified_foods (is_active) WHERE is_active;
CREATE INDEX verified_foods_category_idx ON public.verified_foods (category);
CREATE INDEX verified_foods_aliases_gin ON public.verified_foods USING GIN (aliases);
CREATE INDEX verified_foods_name_trgm ON public.verified_foods USING GIN (lower(name) public.gin_trgm_ops);

GRANT SELECT ON public.verified_foods TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.verified_foods TO authenticated;
GRANT ALL ON public.verified_foods TO service_role;

ALTER TABLE public.verified_foods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active verified foods"
  ON public.verified_foods FOR SELECT
  USING (is_active = true OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'founder'));

CREATE POLICY "Admins can insert verified foods"
  ON public.verified_foods FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'founder'));

CREATE POLICY "Admins can update verified foods"
  ON public.verified_foods FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'founder'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'founder'));

CREATE POLICY "Admins can delete verified foods"
  ON public.verified_foods FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'founder'));

CREATE TRIGGER update_verified_foods_updated_at
  BEFORE UPDATE ON public.verified_foods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.verified_foods
  (canonical_name, name, aliases, category, default_serving_grams,
   kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
   preparation_state, raw_to_cooked_ratio, source, source_notes)
VALUES
  ('rice_white_cooked','White rice (cooked)',
    ARRAY['rice','white rice','cooked rice','kanin','sinangag','plain rice','1 cup rice'],
    'grain', 158, 130, 2.7, 28, 0.3, 'cooked', 2.5, 'usda','FDC 168878'),
  ('rice_white_raw','White rice (raw, uncooked)',
    ARRAY['uncooked rice','dry rice','raw rice','bigas'],
    'grain', 45, 365, 7.1, 80, 0.7, 'raw', 2.5, 'usda','FDC 169756'),
  ('rice_brown_cooked','Brown rice (cooked)',
    ARRAY['brown rice','red rice','whole grain rice'],
    'grain', 195, 123, 2.7, 25.6, 1.0, 'cooked', 2.5, 'usda','FDC 169704'),
  ('oats_cooked','Oatmeal (cooked)',
    ARRAY['oatmeal','porridge','cooked oats','1 cup oatmeal'],
    'grain', 234, 71, 2.5, 12, 1.5, 'cooked', 2.8, 'usda','FDC 173904'),
  ('oats_raw','Rolled oats (dry)',
    ARRAY['rolled oats','raw oats','dry oats','oats'],
    'grain', 40, 379, 13.2, 67.7, 6.5, 'raw', 2.8, 'usda','FDC 173905'),
  ('pasta_cooked','Pasta (cooked)',
    ARRAY['spaghetti cooked','pasta','noodles cooked','macaroni cooked'],
    'grain', 140, 158, 5.8, 30.9, 0.9, 'cooked', 2.4, 'usda','FDC 168927'),
  ('pasta_raw','Pasta (dry)',
    ARRAY['dry pasta','uncooked pasta','raw spaghetti','dry spaghetti'],
    'grain', 56, 371, 13, 74.7, 1.5, 'raw', 2.4, 'usda','FDC 168928'),
  ('bread_white','White bread',
    ARRAY['sliced bread','tasty bread','loaf bread'],
    'grain', 28, 265, 9, 49, 3.2, 'n_a', NULL, 'usda','FDC 172686'),
  ('pandesal','Pandesal',
    ARRAY['pan de sal','filipino bread roll'],
    'grain', 30, 297, 8, 55, 4, 'n_a', NULL, 'philfct','FNRI-PhilFCT'),
  ('chicken_breast_cooked','Chicken breast (cooked, skinless)',
    ARRAY['chicken breast','grilled chicken','boiled chicken','pechuga','chicken fillet'],
    'meat', 100, 165, 31, 0, 3.6, 'cooked', NULL, 'usda','FDC 171477'),
  ('chicken_breast_raw','Chicken breast (raw, skinless)',
    ARRAY['raw chicken','chicken raw'],
    'meat', 120, 120, 22.5, 0, 2.6, 'raw', 0.75, 'usda','FDC 171077'),
  ('pork_belly_cooked','Pork belly (cooked)',
    ARRAY['liempo','pork belly','lechon kawali','crispy pork belly'],
    'meat', 100, 518, 9.3, 0, 53, 'cooked', NULL, 'usda','FDC 167896'),
  ('pork_lean_cooked','Pork lean (cooked)',
    ARRAY['pork chop','pork lean','lean pork'],
    'meat', 100, 242, 27, 0, 14, 'cooked', NULL, 'usda','FDC 167832'),
  ('beef_lean_cooked','Beef lean (cooked)',
    ARRAY['beef','ground beef cooked','lean beef','beef steak'],
    'meat', 100, 250, 26, 0, 15, 'cooked', NULL, 'usda','FDC 173109'),
  ('bangus_grilled','Bangus (grilled)',
    ARRAY['grilled bangus','milkfish','inihaw na bangus'],
    'fish', 100, 148, 20, 0, 6.7, 'cooked', NULL, 'philfct','FNRI-PhilFCT'),
  ('tilapia_cooked','Tilapia (cooked)',
    ARRAY['tilapia','fried tilapia','grilled tilapia'],
    'fish', 100, 128, 26, 0, 2.7, 'cooked', NULL, 'usda','FDC 175168'),
  ('tuna_canned','Canned tuna (in water)',
    ARRAY['tuna','canned tuna','tuna flakes'],
    'fish', 100, 116, 25.5, 0, 0.8, 'n_a', NULL, 'usda','FDC 173706'),
  ('egg_whole','Egg (whole, boiled)',
    ARRAY['egg','boiled egg','itlog','hard boiled egg','1 egg'],
    'protein', 50, 155, 12.6, 1.1, 10.6, 'cooked', NULL, 'usda','FDC 171287'),
  ('egg_fried','Egg (fried)',
    ARRAY['fried egg','sunny side up','pritong itlog'],
    'protein', 50, 196, 13.6, 0.8, 15.3, 'cooked', NULL, 'usda','FDC 173424'),
  ('adobo_chicken','Chicken adobo',
    ARRAY['adobo','chicken adobo','pork adobo','adobong manok'],
    'dish', 200, 190, 15, 3, 13, 'cooked', NULL, 'philfct','FNRI estimate'),
  ('sinigang_pork','Pork sinigang',
    ARRAY['sinigang','pork sinigang','sinigang na baboy'],
    'dish', 350, 90, 7, 4, 5, 'cooked', NULL, 'philfct','FNRI estimate'),
  ('tinola_chicken','Chicken tinola',
    ARRAY['tinola','chicken tinola','tinolang manok'],
    'dish', 350, 75, 8, 3, 3.5, 'cooked', NULL, 'philfct','FNRI estimate'),
  ('sisig_pork','Pork sisig',
    ARRAY['sisig','pork sisig'],
    'dish', 150, 280, 18, 3, 22, 'cooked', NULL, 'philfct','FNRI estimate'),
  ('lechon_kawali','Lechon kawali',
    ARRAY['lechon kawali','crispy pata','deep fried pork belly'],
    'dish', 150, 470, 15, 0, 45, 'cooked', NULL, 'philfct','FNRI estimate'),
  ('pancit_canton','Pancit canton',
    ARRAY['pancit','pancit canton','stir fried noodles'],
    'dish', 200, 175, 6, 22, 7, 'cooked', NULL, 'philfct','FNRI estimate'),
  ('banana','Banana',
    ARRAY['banana','saging','1 banana','saba','lakatan'],
    'fruit', 118, 89, 1.1, 22.8, 0.3, 'n_a', NULL, 'usda','FDC 173944'),
  ('apple','Apple',
    ARRAY['apple','1 apple','mansanas'],
    'fruit', 182, 52, 0.3, 13.8, 0.2, 'n_a', NULL, 'usda','FDC 171688'),
  ('mango_ripe','Ripe mango',
    ARRAY['mango','ripe mango','manggang hinog'],
    'fruit', 165, 60, 0.8, 15, 0.4, 'n_a', NULL, 'usda','FDC 169910'),
  ('coke_regular','Coca-Cola (regular)',
    ARRAY['coke','coca cola','soda','softdrink','1 can coke'],
    'beverage', 330, 42, 0, 10.6, 0, 'n_a', NULL, 'manual','label estimate'),
  ('milk_whole','Whole milk',
    ARRAY['milk','whole milk','fresh milk','gatas'],
    'beverage', 240, 61, 3.2, 4.8, 3.3, 'n_a', NULL, 'usda','FDC 171265'),
  ('taho','Taho',
    ARRAY['taho','soft tofu with syrup and sago'],
    'snack', 240, 90, 4, 14, 2, 'n_a', NULL, 'philfct','FNRI estimate');
