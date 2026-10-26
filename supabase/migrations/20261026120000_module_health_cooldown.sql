-- Rate-limited sources.
-- cooldown_until is set while a source has told us to wait; the layer keeps
-- serving its last good snapshot and fetched_at keeps saying when that was.
-- meta holds the worker's own numbers for the module (credits left, interval).

alter table public.module_health
  add column cooldown_until timestamptz,
  add column meta jsonb not null default '{}'::jsonb;
