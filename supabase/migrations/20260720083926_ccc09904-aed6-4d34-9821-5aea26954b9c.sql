
-- Revoke public execute on SECURITY DEFINER function; only server admin client calls it
REVOKE EXECUTE ON FUNCTION public.log_signup_funnel_event(text, text, text, text) FROM anon, authenticated, PUBLIC;

-- Restrict food_match_cache reads to authenticated (internal heuristics)
DROP POLICY IF EXISTS "food_match_cache public read" ON public.food_match_cache;
CREATE POLICY "food_match_cache authenticated read"
  ON public.food_match_cache FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.food_match_cache FROM anon;

-- Restrict recipe_profiles reads to authenticated
DROP POLICY IF EXISTS "recipe_profiles public read" ON public.recipe_profiles;
CREATE POLICY "recipe_profiles authenticated read"
  ON public.recipe_profiles FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.recipe_profiles FROM anon;

-- Explicit admin/founder-only DELETE on food_submissions (documents intent for future changes)
CREATE POLICY "food_submissions admin delete"
  ON public.food_submissions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'founder'::app_role));
