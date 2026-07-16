-- Shared, anonymous cache of AI food-parse results.
-- Key: sha256 of lowercased+trimmed input + meal hint. No user_id, no PII.
CREATE TABLE public.food_parse_cache (
  cache_key TEXT PRIMARY KEY,
  meal_hint TEXT NOT NULL,
  items JSONB NOT NULL,
  input_language TEXT,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days')
);

CREATE INDEX food_parse_cache_expires_idx ON public.food_parse_cache (expires_at);

-- Writes flow through SECURITY DEFINER RPCs below; deny direct access.
GRANT ALL ON public.food_parse_cache TO service_role;

ALTER TABLE public.food_parse_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "food_parse_cache deny anon"
  ON public.food_parse_cache
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false) WITH CHECK (false);

CREATE POLICY "food_parse_cache deny authenticated"
  ON public.food_parse_cache
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (false) WITH CHECK (false);

-- Look up a live cache entry and bump hit stats atomically.
CREATE OR REPLACE FUNCTION public.get_food_parse_cache(_key TEXT)
RETURNS TABLE (items JSONB, input_language TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.food_parse_cache c
     SET hit_count = c.hit_count + 1,
         last_hit_at = now()
   WHERE c.cache_key = _key
     AND c.expires_at > now()
  RETURNING c.items, c.input_language;
END;
$$;

-- Upsert a fresh cache entry.
CREATE OR REPLACE FUNCTION public.put_food_parse_cache(
  _key TEXT,
  _meal_hint TEXT,
  _items JSONB,
  _input_language TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.food_parse_cache (cache_key, meal_hint, items, input_language, expires_at)
  VALUES (_key, _meal_hint, _items, _input_language, now() + INTERVAL '30 days')
  ON CONFLICT (cache_key) DO UPDATE
    SET items = EXCLUDED.items,
        input_language = EXCLUDED.input_language,
        meal_hint = EXCLUDED.meal_hint,
        expires_at = now() + INTERVAL '30 days';
END;
$$;

-- Founder diagnostics: cache size + recent hit rate.
CREATE OR REPLACE FUNCTION public.get_food_parse_cache_stats()
RETURNS TABLE (
  total_entries BIGINT,
  live_entries BIGINT,
  total_hits BIGINT,
  hits_last_24h BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::BIGINT AS total_entries,
    COUNT(*) FILTER (WHERE expires_at > now())::BIGINT AS live_entries,
    COALESCE(SUM(hit_count), 0)::BIGINT AS total_hits,
    COALESCE(SUM(hit_count) FILTER (WHERE last_hit_at > now() - INTERVAL '24 hours'), 0)::BIGINT AS hits_last_24h
  FROM public.food_parse_cache;
$$;

REVOKE ALL ON FUNCTION public.get_food_parse_cache(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.put_food_parse_cache(TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_food_parse_cache_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_food_parse_cache(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.put_food_parse_cache(TEXT, TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_food_parse_cache_stats() TO service_role, authenticated;