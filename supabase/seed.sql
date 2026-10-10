-- One source row per MVP module (Data Sources doc). Runs after every
-- `supabase db reset`. API keys never go here: they live in .env.

insert into public.source (id, module_id, url, licence, reliability) values
  ('usgs-earthquakes', 'earthquakes',
   'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
   'Public domain (US Government work)', 'primary'),
  ('nga-wpi', 'ports',
   'https://msi.nga.mil/Publications/WPI',
   'Public domain', 'primary'),
  ('nasa-firms', 'wildfires',
   'https://firms.modaps.eosdis.nasa.gov/api/area/csv/',
   'Open, attribution required', 'primary'),
  ('opensky', 'aircraft',
   'https://opensky-network.org/api/states/all',
   'OpenSky terms of use (research and non-commercial)', 'aggregated'),
  ('aisstream', 'vessels',
   'wss://stream.aisstream.io/v0/stream',
   'AISStream.io terms of use', 'aggregated'),
  ('celestrak', 'satellites',
   'https://celestrak.org/NORAD/elements/gp.php',
   'Free, attribution requested', 'aggregated')
on conflict (id) do update set
  module_id   = excluded.module_id,
  url         = excluded.url,
  licence     = excluded.licence,
  reliability = excluded.reliability;
