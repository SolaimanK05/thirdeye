-- Core tables
-- Every table gets RLS in the same migration, with no policies: only the
-- Python backend connects (as postgres), so nothing else can read or write.

-- ---------------------------------------------------------------- enums

create type public.entity_kind as enum (
  'vessel', 'aircraft', 'satellite', 'facility', 'org', 'place'
);

create type public.confidence as enum (
  'observed', 'reported', 'derived', 'inferred'
);

create type public.source_reliability as enum (
  'primary', 'aggregated', 'derived'
);

create type public.module_status as enum (
  'ok', 'failed'
);

-- ---------------------------------------------------------------- source
-- One row per module feed. Text ids ('usgs-earthquakes') keep seed.sql readable.

create table public.source (
  id          text primary key,
  module_id   text not null,
  url         text not null,
  licence     text not null,
  reliability public.source_reliability not null
);

-- ---------------------------------------------------------------- entity
-- A thing that persists for years. Positions live in observation, not here.

create table public.entity (
  id           uuid primary key default gen_random_uuid(),
  kind         public.entity_kind not null,
  names        text[] not null default '{}',
  identifiers  jsonb not null default '{}'
               check (jsonb_typeof(identifiers) = 'object'),
  attrs        jsonb not null default '{}'
               check (jsonb_typeof(attrs) = 'object'),
  first_seen   timestamptz not null,
  last_seen    timestamptz not null,
  source_id    text not null references public.source (id),
  retrieved_at timestamptz not null,
  check (last_seen >= first_seen)
);

-- ---------------------------------------------------------------- observation
-- An entity seen at a time and place. The primary key makes re-ingesting the
-- same fix a no-op (idempotent upserts) and also serves (entity_id, t) lookups.

create table public.observation (
  entity_id  uuid not null references public.entity (id) on delete cascade,
  t          timestamptz not null,
  source_id  text not null references public.source (id),
  geom       geometry(Point, 4326) not null
             check (st_x(geom) between -180 and 180 and st_y(geom) between -90 and 90),
  sog        real check (sog >= 0),                 -- speed over ground, knots
  cog        real check (cog >= 0 and cog < 360),   -- course over ground, degrees
  alt        real,                                  -- altitude, metres
  confidence public.confidence not null,
  primary key (entity_id, t, source_id)
);

-- ---------------------------------------------------------------- event
-- Something that happened. id is '<module_id>:<upstream id>' so the worker can
-- upsert by id and two feeds can never collide.

create table public.event (
  id           text primary key,
  module_id    text not null,
  category     text not null,
  geom         geometry(Geometry, 4326) not null,
  t_start      timestamptz not null,
  t_end        timestamptz,                         -- null while ongoing
  severity     real,                                -- scale is per module
  attrs        jsonb not null default '{}'
               check (jsonb_typeof(attrs) = 'object'),
  source_id    text not null references public.source (id),
  retrieved_at timestamptz not null,
  confidence   public.confidence not null,
  check (t_end is null or t_end >= t_start)
);

-- ---------------------------------------------------------------- watchlist_entry
-- Starred entities. One watchlist per instance.

create table public.watchlist_entry (
  entity_id uuid primary key references public.entity (id) on delete cascade,
  added_at  timestamptz not null default now(),
  note      text
);

-- ---------------------------------------------------------------- layer_snapshot
-- Latest ready-to-send payload per module.

create table public.layer_snapshot (
  module_id    text primary key,
  payload      jsonb not null check (jsonb_typeof(payload) = 'array'),
  fetched_at   timestamptz not null,
  record_count integer not null check (record_count >= 0)
);

-- ---------------------------------------------------------------- module_health

create table public.module_health (
  module_id    text primary key,
  status       public.module_status not null,
  fetched_at   timestamptz not null,
  record_count integer not null default 0 check (record_count >= 0),
  reason       text,
  check (status <> 'failed' or reason is not null)
);

-- ---------------------------------------------------------------- row level security

alter table public.source          enable row level security;
alter table public.entity          enable row level security;
alter table public.observation     enable row level security;
alter table public.event           enable row level security;
alter table public.watchlist_entry enable row level security;
alter table public.layer_snapshot  enable row level security;
alter table public.module_health   enable row level security;
