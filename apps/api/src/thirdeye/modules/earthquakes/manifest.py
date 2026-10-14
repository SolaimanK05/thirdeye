from thirdeye.ontology import Confidence, Domain, ModuleManifest, Provenance

MANIFEST = ModuleManifest(
    id="earthquakes",
    name="Earthquakes",
    domain=Domain.EARTH,
    cadence_seconds=60,
    zoom_range=(1, 4),
    requires_key=False,
    provenance=Provenance(
        source_id="usgs-earthquakes",
        source="USGS Earthquake Hazards Program, real-time GeoJSON feed (past day)",
        licence="Public domain (US Government work)",
        attribution="USGS",
        freshness="Feed regenerated every minute",
        confidence=Confidence.OBSERVED,
        limitations=(
            "Magnitudes are revised in the hours after an event.",
            "Detection density varies by region.",
            "Depth is least reliable for shallow offshore events.",
        ),
    ),
)
