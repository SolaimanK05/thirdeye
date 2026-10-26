from thirdeye.ontology import Confidence, Domain, ModuleManifest, Provenance

MANIFEST = ModuleManifest(
    id="aircraft",
    name="Aircraft",
    domain=Domain.MOVERS,
    kind="entities",
    cadence_seconds=30,
    zoom_range=(2, 4),
    requires_key=True,
    key_envs=("OPENSKY_CLIENT_ID", "OPENSKY_CLIENT_SECRET"),
    observation_retention_seconds=3_600,
    snapshot_window_seconds=600,
    provenance=Provenance(
        source_id="opensky",
        source="OpenSky Network, ADS-B and MLAT state vectors",
        licence="OpenSky terms of use (research and non-commercial)",
        attribution="OpenSky Network",
        freshness="Polled within a daily credit budget, so a worldwide view refreshes about every 90 seconds",
        confidence=Confidence.OBSERVED,
        limitations=(
            "Coverage comes from volunteer receivers: oceans, polar regions and parts of Africa and Asia have gaps, so a missing aircraft is not evidence that it is not flying.",
            "Some operators ask to be left out of public tracking, and many military aircraft do not broadcast, so this is not a full picture of the sky.",
            "A position is the last one received, already seconds to a minute old when it is drawn.",
            "A callsign is set by the crew and can be wrong or reused; the ICAO24 address identifies the transponder, not the owner.",
        ),
    ),
)
