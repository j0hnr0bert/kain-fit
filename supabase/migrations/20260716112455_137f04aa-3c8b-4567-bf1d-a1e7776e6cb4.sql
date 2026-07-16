REVOKE EXECUTE ON FUNCTION public.get_food_parse_cache(TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.put_food_parse_cache(TEXT, TEXT, JSONB, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_food_parse_cache_stats() FROM anon;