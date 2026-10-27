from thirdeye.ontology import Confidence, Domain, ModuleManifest, Provenance

MANIFEST = ModuleManifest(
    id="vessels",
    name="Vessels",
    domain=Domain.MOVERS,
    kind="entities",
    cadence_seconds=0,
    zoom_range=(2, 4),
    requires_key=True,
    key_envs=("AISSTREAM_API_KEY",),
    observation_retention_seconds=3_600,
    snapshot_window_seconds=1_800,
    render_delay_seconds=180,
    heartbeat_seconds=60,
    provenance=Provenance(
        source_id="aisstream",
        source="AISStream, live AIS broadcasts from terrestrial and satellite receivers",
        licence="AISStream terms of use (free API key, no uptime guarantee)",
        attribution="AISStream",
        freshness="Streamed live and written in batches of a few seconds, so a position is the last one the vessel broadcast",
        confidence=Confidence.OBSERVED,
        limitations=(
            "AIS is self-reported. It can be switched off, spoofed, or set to a false identity.",
            "Coverage comes from shore stations and some satellites, so open ocean and some coasts have gaps; a missing vessel is not evidence that it is not there.",
            "Destination, ETA and navigational status are typed in by the crew and are often out of date or left at defaults.",
            "Small craft, and many naval and sensitive vessels, do not transmit AIS.",
            "The flag is read from the first three digits of the MMSI, so it names the country that issued the number, which can differ from the ship's registry.",
        ),
    ),
)
