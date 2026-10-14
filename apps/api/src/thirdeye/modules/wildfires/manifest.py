from thirdeye.ontology import Confidence, Domain, ModuleManifest, Provenance

MANIFEST = ModuleManifest(
    id="wildfires",
    name="Wildfires",
    domain=Domain.EARTH,
    cadence_seconds=10_800,
    zoom_range=(2, 4),
    requires_key=True,
    key_env="FIRMS_MAP_KEY",
    viewport_lookback_seconds=3 * 86_400,
    retention_seconds=4 * 86_400,
    provenance=Provenance(
        source_id="nasa-firms",
        source="NASA FIRMS, VIIRS S-NPP near real time active fire detections",
        licence="Open, attribution required",
        attribution="NASA FIRMS",
        freshness="Polled every 3 hours; detections arrive minutes to hours after a satellite pass",
        confidence=Confidence.DERIVED,
        limitations=(
            "A thermal anomaly is not a confirmed fire: gas flares, industrial heat and sun glint also trigger detections.",
            "Cloud cover hides fires entirely, so absence means not seen this pass.",
            "Each point is one 375 m pixel at the moment of a satellite overpass, not a fire perimeter.",
        ),
    ),
)
