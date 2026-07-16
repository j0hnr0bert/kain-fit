
-- Ops settings: single-row-per-key store
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can upsert settings"
  ON public.app_settings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Audit log
CREATE TABLE IF NOT EXISTS public.ops_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  key TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ops_audit_log TO authenticated;
GRANT ALL ON public.ops_audit_log TO service_role;

ALTER TABLE public.ops_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read audit log"
  ON public.ops_audit_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS ops_audit_log_created_at_idx
  ON public.ops_audit_log (created_at DESC);

-- Seed defaults (no-op on re-run)
INSERT INTO public.app_settings (key, value) VALUES
  ('pause_demo',           to_jsonb(false)),
  ('pause_ai',             to_jsonb(false)),
  ('db_only_mode',         to_jsonb(false)),
  ('demo_allowance',       to_jsonb(3)),
  ('high_demand_banner',   to_jsonb(''::text))
ON CONFLICT (key) DO NOTHING;
