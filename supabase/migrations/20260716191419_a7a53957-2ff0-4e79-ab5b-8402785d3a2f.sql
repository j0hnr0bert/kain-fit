
DROP INDEX IF EXISTS public.verified_foods_name_trgm;
DROP EXTENSION IF EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
CREATE INDEX verified_foods_name_trgm ON public.verified_foods USING GIN (lower(name) extensions.gin_trgm_ops);
