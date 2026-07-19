
INSERT INTO public.brands (name, normalized_name, country_code, verification_status) VALUES
  ('Lucky Me!', 'lucky me', 'PH', 'verified'),
  ('Nescafé', 'nescafe', 'PH', 'verified'),
  ('Bear Brand', 'bear brand', 'PH', 'verified'),
  ('Alaska', 'alaska', 'PH', 'verified'),
  ('Century Tuna', 'century tuna', 'PH', 'verified'),
  ('Argentina', 'argentina', 'PH', 'verified'),
  ('CDO', 'cdo', 'PH', 'verified'),
  ('Skyflakes', 'skyflakes', 'PH', 'verified'),
  ('Piattos', 'piattos', 'PH', 'verified'),
  ('Chippy', 'chippy', 'PH', 'verified'),
  ('San Miguel', 'san miguel', 'PH', 'verified')
ON CONFLICT (normalized_name) DO NOTHING;

INSERT INTO public.restaurant_chains (name, normalized_name, country_code, verification_status) VALUES
  ('Jollibee', 'jollibee', 'PH', 'verified'),
  ('McDonald''s Philippines', 'mcdonalds philippines', 'PH', 'verified'),
  ('Chowking', 'chowking', 'PH', 'verified'),
  ('Mang Inasal', 'mang inasal', 'PH', 'verified'),
  ('Goldilocks', 'goldilocks', 'PH', 'verified')
ON CONFLICT (normalized_name) DO NOTHING;

INSERT INTO public.food_records
  (canonical_name, display_name, food_type, country_code, brand_id, barcode, category,
   preparation_state, default_serving_grams,
   calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
   verification_status, confidence_score, active)
VALUES
  ('lucky_me_pancit_canton_original', 'Lucky Me! Pancit Canton Original', 'branded', 'PH',
   (SELECT id FROM public.brands WHERE normalized_name='lucky me'), '4807770271027', 'packaged',
   'n_a', 60, 485, 8.3, 68, 20, 'verified', 0.9, true),
  ('nescafe_3in1_original', 'Nescafé 3-in-1 Original', 'branded', 'PH',
   (SELECT id FROM public.brands WHERE normalized_name='nescafe'), '4800361381321', 'beverage',
   'n_a', 20, 440, 4, 78, 12, 'verified', 0.9, true),
  ('bear_brand_powdered_milk', 'Bear Brand Powdered Milk Drink', 'branded', 'PH',
   (SELECT id FROM public.brands WHERE normalized_name='bear brand'), '4800361286015', 'beverage',
   'n_a', 25, 490, 24, 40, 26, 'verified', 0.9, true),
  ('century_tuna_flakes_in_oil', 'Century Tuna Flakes in Oil', 'branded', 'PH',
   (SELECT id FROM public.brands WHERE normalized_name='century tuna'), '4800016641138', 'packaged',
   'n_a', 95, 198, 22, 0, 12, 'verified', 0.9, true),
  ('argentina_corned_beef', 'Argentina Corned Beef', 'branded', 'PH',
   (SELECT id FROM public.brands WHERE normalized_name='argentina'), '4800092272110', 'packaged',
   'n_a', 100, 250, 18, 3, 18, 'verified', 0.85, true),
  ('cdo_karne_norte', 'CDO Karne Norte', 'branded', 'PH',
   (SELECT id FROM public.brands WHERE normalized_name='cdo'), '4800098602015', 'packaged',
   'n_a', 100, 260, 15, 4, 20, 'verified', 0.85, true),
  ('skyflakes_crackers', 'Skyflakes Crackers', 'branded', 'PH',
   (SELECT id FROM public.brands WHERE normalized_name='skyflakes'), '4800016553424', 'packaged',
   'n_a', 25, 460, 8, 66, 18, 'verified', 0.9, true),
  ('piattos_cheese', 'Piattos Cheese', 'branded', 'PH',
   (SELECT id FROM public.brands WHERE normalized_name='piattos'), '4800194117128', 'packaged',
   'n_a', 40, 500, 5, 60, 27, 'verified', 0.85, true),
  ('chippy_bbq', 'Chippy Barbecue', 'branded', 'PH',
   (SELECT id FROM public.brands WHERE normalized_name='chippy'), '4800194113137', 'packaged',
   'n_a', 27, 520, 7, 60, 27, 'verified', 0.85, true),
  ('san_miguel_pale_pilsen', 'San Miguel Pale Pilsen', 'branded', 'PH',
   (SELECT id FROM public.brands WHERE normalized_name='san miguel'), '4800024107237', 'beverage',
   'n_a', 330, 42, 0.5, 3, 0, 'verified', 0.9, true)
ON CONFLICT (canonical_name) DO NOTHING;

INSERT INTO public.food_records
  (canonical_name, display_name, food_type, country_code, restaurant_id, category,
   preparation_state, default_serving_grams,
   calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
   verification_status, confidence_score, active)
VALUES
  ('jollibee_chickenjoy_1pc', 'Jollibee Chickenjoy (1 pc)', 'restaurant', 'PH',
   (SELECT id FROM public.restaurant_chains WHERE normalized_name='jollibee'), 'restaurant',
   'n_a', 120, 246, 22, 8, 15, 'verified', 0.85, true),
  ('jollibee_yumburger', 'Jollibee Yumburger', 'restaurant', 'PH',
   (SELECT id FROM public.restaurant_chains WHERE normalized_name='jollibee'), 'restaurant',
   'n_a', 106, 205, 10, 22, 9, 'verified', 0.85, true),
  ('jollibee_jolly_spaghetti', 'Jollibee Jolly Spaghetti', 'restaurant', 'PH',
   (SELECT id FROM public.restaurant_chains WHERE normalized_name='jollibee'), 'restaurant',
   'n_a', 280, 124, 5, 20, 3, 'verified', 0.85, true),
  ('jollibee_burger_steak', 'Jollibee Burger Steak (Regular)', 'restaurant', 'PH',
   (SELECT id FROM public.restaurant_chains WHERE normalized_name='jollibee'), 'restaurant',
   'n_a', 220, 159, 6, 21, 5, 'verified', 0.8, true),
  ('mcdo_cheeseburger', 'McDonald''s Cheeseburger', 'restaurant', 'PH',
   (SELECT id FROM public.restaurant_chains WHERE normalized_name='mcdonalds philippines'), 'restaurant',
   'n_a', 118, 255, 13, 27, 10, 'verified', 0.9, true),
  ('mcdo_mcspicy', 'McDonald''s McSpicy', 'restaurant', 'PH',
   (SELECT id FROM public.restaurant_chains WHERE normalized_name='mcdonalds philippines'), 'restaurant',
   'n_a', 174, 270, 12, 26, 14, 'verified', 0.85, true),
  ('mang_inasal_paa_regular', 'Mang Inasal Paa (Regular)', 'restaurant', 'PH',
   (SELECT id FROM public.restaurant_chains WHERE normalized_name='mang inasal'), 'restaurant',
   'n_a', 140, 236, 22, 2, 15, 'verified', 0.85, true),
  ('chowking_halohalo_regular', 'Chowking Halo-Halo (Regular)', 'restaurant', 'PH',
   (SELECT id FROM public.restaurant_chains WHERE normalized_name='chowking'), 'restaurant',
   'n_a', 500, 66, 2, 12, 1, 'verified', 0.8, true),
  ('goldilocks_mocha_cake_slice', 'Goldilocks Mocha Cake (1 slice)', 'restaurant', 'PH',
   (SELECT id FROM public.restaurant_chains WHERE normalized_name='goldilocks'), 'restaurant',
   'n_a', 100, 370, 4, 45, 18, 'verified', 0.8, true)
ON CONFLICT (canonical_name) DO NOTHING;

INSERT INTO public.food_aliases (food_record_id, alias, normalized_alias, language, alias_type, priority)
SELECT r.id, v.alias, lower(v.alias), 'en', v.atype, v.priority
FROM (VALUES
  ('lucky_me_pancit_canton_original', 'pancit canton', 'nickname', 20),
  ('lucky_me_pancit_canton_original', 'lucky me pancit canton', 'brand_variant', 10),
  ('lucky_me_pancit_canton_original', 'instant pancit canton', 'nickname', 30),
  ('nescafe_3in1_original', '3 in 1 coffee', 'nickname', 20),
  ('nescafe_3in1_original', 'nescafe 3in1', 'brand_variant', 10),
  ('nescafe_3in1_original', 'kape sachet', 'translation', 40),
  ('bear_brand_powdered_milk', 'bear brand milk', 'brand_variant', 10),
  ('bear_brand_powdered_milk', 'powdered milk', 'nickname', 40),
  ('century_tuna_flakes_in_oil', 'century tuna', 'brand_variant', 10),
  ('century_tuna_flakes_in_oil', 'canned tuna', 'nickname', 40),
  ('argentina_corned_beef', 'corned beef', 'nickname', 20),
  ('cdo_karne_norte', 'karne norte', 'nickname', 20),
  ('skyflakes_crackers', 'skyflakes', 'brand_variant', 10),
  ('piattos_cheese', 'piattos', 'brand_variant', 10),
  ('chippy_bbq', 'chippy', 'brand_variant', 10),
  ('san_miguel_pale_pilsen', 'san mig pale', 'nickname', 20),
  ('san_miguel_pale_pilsen', 'pale pilsen', 'nickname', 30),
  ('jollibee_chickenjoy_1pc', 'chickenjoy', 'menu_name', 10),
  ('jollibee_chickenjoy_1pc', 'jollibee chicken', 'nickname', 20),
  ('jollibee_yumburger', 'yumburger', 'menu_name', 10),
  ('jollibee_jolly_spaghetti', 'jolly spaghetti', 'menu_name', 10),
  ('jollibee_jolly_spaghetti', 'jollibee spaghetti', 'nickname', 20),
  ('jollibee_burger_steak', 'burger steak', 'menu_name', 20),
  ('mcdo_cheeseburger', 'mcdo cheeseburger', 'nickname', 10),
  ('mcdo_cheeseburger', 'cheeseburger mcdo', 'nickname', 20),
  ('mcdo_mcspicy', 'mcspicy', 'menu_name', 10),
  ('mang_inasal_paa_regular', 'mang inasal paa', 'menu_name', 10),
  ('mang_inasal_paa_regular', 'inasal paa', 'nickname', 20),
  ('chowking_halohalo_regular', 'chowking halo halo', 'menu_name', 10),
  ('chowking_halohalo_regular', 'halo halo chowking', 'nickname', 20),
  ('goldilocks_mocha_cake_slice', 'mocha cake', 'menu_name', 20),
  ('goldilocks_mocha_cake_slice', 'goldilocks mocha', 'brand_variant', 10)
) AS v(canonical, alias, atype, priority)
JOIN public.food_records r ON r.canonical_name = v.canonical
ON CONFLICT (normalized_alias, food_record_id) DO NOTHING;
