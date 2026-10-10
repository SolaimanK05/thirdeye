-- Indexes.

-- observation: rows arrive roughly in time order, so a tiny BRIN index is
-- enough for time-range scans. (entity_id, t) lookups use the primary key.
create index observation_t_brin on public.observation using brin (t);
create index observation_geom_gist on public.observation using gist (geom);

-- event: spatial queries, and "latest events for a module".
create index event_geom_gist on public.event using gist (geom);
create index event_module_t_start on public.event (module_id, t_start desc);

-- entity: exact identifier lookup, e.g. identifiers @> '{"imo": "9811000"}'.
-- No UNIQUE anywhere: weak keys (mmsi, icao24) repeat by design.
create index entity_identifiers_gin on public.entity using gin (identifiers jsonb_path_ops);

-- entity: fuzzy search over names and identifier values.
-- array_to_string() needs to be in a function because it is not immutable as index expression needs to be
-- Queries must use the same expression to hit the index, e.g.
--   where public.entity_search_text(names, identifiers) ilike '%given%'
create function public.entity_search_text(names text[], identifiers jsonb)
returns text
language sql
immutable
parallel safe
set search_path = ''
return array_to_string(names, ' ') || ' ' ||
       coalesce((select string_agg(value, ' ') from jsonb_each_text(identifiers)), '');

create index entity_search_trgm on public.entity
  using gin (public.entity_search_text(names, identifiers) extensions.gin_trgm_ops);
