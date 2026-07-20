
-- Restrict internal food_match_cache reads to admins/founders
DROP POLICY IF EXISTS "Authenticated users can read food_match_cache" ON public.food_match_cache;
DROP POLICY IF EXISTS "food_match_cache_authenticated_read" ON public.food_match_cache;
DROP POLICY IF EXISTS "Authenticated read food_match_cache" ON public.food_match_cache;

CREATE POLICY "Admins and founders can read food_match_cache"
ON public.food_match_cache
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'founder'));

-- Restrict recipe_profiles reads to admins/founders
DROP POLICY IF EXISTS "Authenticated users can read recipe_profiles" ON public.recipe_profiles;
DROP POLICY IF EXISTS "recipe_profiles_authenticated_read" ON public.recipe_profiles;
DROP POLICY IF EXISTS "Authenticated read recipe_profiles" ON public.recipe_profiles;

CREATE POLICY "Admins and founders can read recipe_profiles"
ON public.recipe_profiles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'founder'));
