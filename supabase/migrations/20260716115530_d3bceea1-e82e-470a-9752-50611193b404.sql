
ALTER TABLE public.food_entries
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS food_entries_user_client_request_id_key
  ON public.food_entries (user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS food_entries_user_logged_at_idx
  ON public.food_entries (user_id, logged_at DESC);

CREATE INDEX IF NOT EXISTS product_events_event_created_idx
  ON public.product_events (event_name, created_at DESC);
