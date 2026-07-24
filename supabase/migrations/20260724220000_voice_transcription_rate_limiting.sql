-- Voice transcription rate limiting, concurrency control and cost
-- protection (Stage 2.5 of the voice-input reliability sprint).
--
-- Durable, atomic, server-authoritative quota + single-flight lease for the
-- transcribe-voice Edge Function. Every limit value is passed in by the
-- caller (defaults shown below match supabase/functions/transcribe-voice/
-- rate-limit-config.ts) rather than hardcoded here twice, so there is one
-- source of truth for the actual numbers in production.
--
-- NOT applied to any remote database by this change. Additive only.
--
-- ============================================================
-- ROLLBACK (manual — this repo has no down-migration tooling; keep this
-- block as the exact reversal if this migration is ever applied and needs
-- to be undone):
--
--   drop function if exists public.cleanup_voice_transcription_data(integer, integer);
--   drop function if exists public.release_voice_transcription_lease(uuid, uuid);
--   drop function if exists public.acquire_voice_transcription_slot(
--     uuid, integer, integer, integer, integer, integer, integer, integer,
--     integer, integer, timestamptz);
--   drop table if exists public.voice_transcription_leases;
--   drop table if exists public.voice_transcription_requests;
--
-- Safe to run even mid-traffic: dropping these only makes the guard fail
-- closed (limiter_unavailable, see guard.ts) until the Edge Function is
-- also rolled back — it never leaves typed logging affected, and never
-- leaves a request able to bypass quota.
-- ============================================================

-- ============================================================
-- Ledger: one row per ACCEPTED client transcription request (i.e. a
-- request that passed quota + lease + made it to "meaningful server
-- processing" — see guard.ts's REQUEST PROCESSING ORDER). This is a true
-- rolling-window ledger, not a fixed bucket: the window boundary moves
-- with `now()` on every check, computed via a range scan over created_at.
-- Deliberately does NOT store a status/outcome column — whether the
-- underlying OpenAI call later succeeds or fails does not change whether
-- the attempt consumed quota (quota is consumed before the OpenAI call is
-- ever made), so a status column would only exist for observability,
-- which is handled by the Edge Function's structured logs instead of a
-- second write to this table (a second write would also complicate the
-- atomicity story below for no benefit).
-- ============================================================
create table if not exists public.voice_transcription_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_voice_transcription_requests_user_created
  on public.voice_transcription_requests (user_id, created_at desc);
create index if not exists idx_voice_transcription_requests_created
  on public.voice_transcription_requests (created_at desc);

alter table public.voice_transcription_requests enable row level security;
-- No policies defined: anon/authenticated get zero access (Postgres
-- default-deny), service_role bypasses RLS. Explicit revoke below is
-- belt-and-suspenders, matching the product_events precedent in this repo.
revoke all on public.voice_transcription_requests from anon, authenticated;
grant all on public.voice_transcription_requests to service_role;

-- ============================================================
-- Active-request lease: at most one row per user. Presence of a row
-- (with expires_at in the future) means that user has an in-flight
-- OpenAI call. lease_token is server-generated (never client-supplied)
-- so a request can only release the lease it itself acquired, even if
-- its own release runs late after the lease already expired and a
-- newer request acquired a fresh one.
-- ============================================================
create table if not exists public.voice_transcription_leases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lease_token uuid not null,
  expires_at timestamptz not null,
  acquired_at timestamptz not null default now()
);

create index if not exists idx_voice_transcription_leases_expires
  on public.voice_transcription_leases (expires_at);

alter table public.voice_transcription_leases enable row level security;
revoke all on public.voice_transcription_leases from anon, authenticated;
grant all on public.voice_transcription_leases to service_role;

-- ============================================================
-- Atomic acquire: checks the active lease, per-user rolling windows, and
-- project-wide rolling windows, then (only if every check passes) inserts
-- one ledger row and one lease row — all inside the same transaction.
--
-- CONCURRENCY GUARANTEE: pg_advisory_xact_lock is transaction-scoped
-- (released automatically at COMMIT/ROLLBACK, so a crashed connection can
-- never hold it) and blocks other callers taking the *same* lock key
-- until this transaction ends. Two locks are taken, always in the same
-- order (per-user, then global) by every caller, which rules out a
-- deadlock between concurrent calls:
--   1. a per-user lock (hashed from user_id) serializes every check+write
--      for THIS user — two simultaneous requests from the same user (two
--      tabs, two devices, a client retry) cannot both pass the lease/
--      short-window/daily-window checks before either has written; the
--      second one always sees the first one's row.
--   2. a fixed-key global lock serializes the project-wide hourly/daily
--      checks the same way, across ALL users and Edge Function instances.
-- This is deliberately NOT "SELECT count(...) then INSERT" without a
-- lock, which would allow two concurrent transactions to both read the
-- same under-limit count and both insert, exceeding the limit.
--
-- SECURITY DEFINER was deliberately NOT used. Every caller of this
-- function is the Edge Function's service-role client — never a
-- lower-privileged authenticated/anon session — so there is no privilege
-- to elevate; SECURITY INVOKER (the default) already runs as service_role,
-- which already bypasses RLS on these tables. Using DEFINER here would
-- only add search_path-hijack surface for no benefit. `set search_path`
-- is still pinned below as cheap, standard defense-in-depth regardless.
-- EXECUTE is revoked from PUBLIC and granted only to service_role, so
-- even if this reasoning is ever revisited, authenticated/anon callers
-- cannot invoke it directly.
-- ============================================================
create or replace function public.acquire_voice_transcription_slot(
  p_user_id uuid,
  p_short_window_seconds integer default 600,
  p_short_window_max integer default 10,
  p_daily_window_seconds integer default 86400,
  p_daily_window_max integer default 100,
  p_project_hourly_seconds integer default 3600,
  p_project_hourly_max integer default 1000,
  p_project_daily_seconds integer default 86400,
  p_project_daily_max integer default 5000,
  p_lease_seconds integer default 30,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_oldest timestamptz;
  v_retry_after integer;
  v_lease_expires timestamptz;
  v_token uuid;
begin
  if p_user_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  end if;

  perform pg_advisory_xact_lock(hashtext('voice_transcription_user'), hashtext(p_user_id::text));

  -- Reclaim an expired lease inline. Self-healing: a crashed Edge Function
  -- instance that never reached its `finally` release cannot lock this
  -- user out past p_lease_seconds, with no external cleanup job required
  -- for correctness.
  delete from public.voice_transcription_leases
    where user_id = p_user_id and expires_at < p_now;

  select expires_at into v_lease_expires
    from public.voice_transcription_leases where user_id = p_user_id;
  if v_lease_expires is not null then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'request_in_progress',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_lease_expires - p_now)))::int)
    );
  end if;

  select count(*), min(created_at) into v_count, v_oldest
    from public.voice_transcription_requests
    where user_id = p_user_id
      and created_at > p_now - make_interval(secs => p_short_window_seconds);
  if v_count >= p_short_window_max then
    v_retry_after := greatest(1, p_short_window_seconds - ceil(extract(epoch from (p_now - v_oldest)))::int);
    return jsonb_build_object('allowed', false, 'reason', 'rate_limited_short_window', 'retry_after_seconds', v_retry_after);
  end if;

  select count(*), min(created_at) into v_count, v_oldest
    from public.voice_transcription_requests
    where user_id = p_user_id
      and created_at > p_now - make_interval(secs => p_daily_window_seconds);
  if v_count >= p_daily_window_max then
    v_retry_after := greatest(1, p_daily_window_seconds - ceil(extract(epoch from (p_now - v_oldest)))::int);
    return jsonb_build_object('allowed', false, 'reason', 'rate_limited_daily', 'retry_after_seconds', v_retry_after);
  end if;

  perform pg_advisory_xact_lock(hashtext('voice_transcription_global'), 0);

  select count(*), min(created_at) into v_count, v_oldest
    from public.voice_transcription_requests
    where created_at > p_now - make_interval(secs => p_project_hourly_seconds);
  if v_count >= p_project_hourly_max then
    v_retry_after := greatest(1, p_project_hourly_seconds - ceil(extract(epoch from (p_now - v_oldest)))::int);
    return jsonb_build_object('allowed', false, 'reason', 'project_limit_reached', 'scope', 'hourly', 'retry_after_seconds', v_retry_after);
  end if;

  select count(*), min(created_at) into v_count, v_oldest
    from public.voice_transcription_requests
    where created_at > p_now - make_interval(secs => p_project_daily_seconds);
  if v_count >= p_project_daily_max then
    v_retry_after := greatest(1, p_project_daily_seconds - ceil(extract(epoch from (p_now - v_oldest)))::int);
    return jsonb_build_object('allowed', false, 'reason', 'project_limit_reached', 'scope', 'daily', 'retry_after_seconds', v_retry_after);
  end if;

  insert into public.voice_transcription_requests (user_id, created_at) values (p_user_id, p_now);

  v_token := gen_random_uuid();
  insert into public.voice_transcription_leases (user_id, lease_token, expires_at, acquired_at)
    values (p_user_id, v_token, p_now + make_interval(secs => p_lease_seconds), p_now);

  return jsonb_build_object('allowed', true, 'lease_token', v_token);
end;
$$;

revoke all on function public.acquire_voice_transcription_slot(
  uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer, timestamptz
) from public;
grant execute on function public.acquire_voice_transcription_slot(
  uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer, timestamptz
) to service_role;

-- ============================================================
-- Release: deletes the lease only if the token still matches (see the
-- lease-token comment on the table above). Called from the Edge
-- Function's `finally` block. If this call itself fails (e.g. the
-- limiter database is briefly unreachable), the lease simply expires on
-- its own after p_lease_seconds — never a permanent lock.
-- ============================================================
create or replace function public.release_voice_transcription_lease(
  p_user_id uuid,
  p_lease_token uuid
)
returns void
language sql
set search_path = public, pg_temp
as $$
  delete from public.voice_transcription_leases
    where user_id = p_user_id and lease_token = p_lease_token;
$$;

revoke all on function public.release_voice_transcription_lease(uuid, uuid) from public;
grant execute on function public.release_voice_transcription_lease(uuid, uuid) to service_role;

-- ============================================================
-- Cleanup: storage hygiene only, never a correctness requirement — the
-- rolling-window queries above already ignore rows outside their window
-- regardless of whether old rows have been physically deleted, and
-- expired leases are already reclaimed inline by acquire(). NOT scheduled
-- by this migration (no pg_cron call added) — invoking this on a
-- schedule is an operational decision for after deployment approval.
-- At the configured defaults, retained rows are bounded by the project
-- daily circuit breaker itself (at most ~5,000 rows/day before the
-- breaker trips), so expected steady-state table size is a few thousand
-- rows — trivial for Postgres, no partitioning needed at beta volume.
-- ============================================================
create or replace function public.cleanup_voice_transcription_data(
  p_request_retention_seconds integer default 90000, -- 25h: safety margin past the 24h daily window
  p_lease_retention_seconds integer default 3600 -- 1h: safety margin past the 30s lease expiry
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  delete from public.voice_transcription_requests
    where created_at < now() - make_interval(secs => p_request_retention_seconds);
  delete from public.voice_transcription_leases
    where expires_at < now() - make_interval(secs => p_lease_retention_seconds);
end;
$$;

revoke all on function public.cleanup_voice_transcription_data(integer, integer) from public;
grant execute on function public.cleanup_voice_transcription_data(integer, integer) to service_role;
