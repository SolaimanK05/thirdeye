-- Entity identity.
-- Matching a batch of reports to stored entities looks them up by exact
-- identifier. Partial indexes keep each one to the entities that have the key.
-- No UNIQUE anywhere: weak keys (mmsi, icao24) repeat by design.

create index entity_imo on public.entity ((identifiers ->> 'imo'))
  where (identifiers ->> 'imo') is not null;
create index entity_mmsi on public.entity ((identifiers ->> 'mmsi'))
  where (identifiers ->> 'mmsi') is not null;
create index entity_icao24 on public.entity ((identifiers ->> 'icao24'))
  where (identifiers ->> 'icao24') is not null;
create index entity_norad_id on public.entity ((identifiers ->> 'norad_id'))
  where (identifiers ->> 'norad_id') is not null;
create index entity_wpi on public.entity ((identifiers ->> 'wpi'))
  where (identifiers ->> 'wpi') is not null;

-- The 24 hour window for weak-key matches.
create index entity_kind_last_seen on public.entity (kind, last_seen desc);

-- Observations carry the reported heading (degrees) next to the course.
alter table public.observation
  add column heading real check (heading >= 0 and heading < 360);
