from thirdeye.ontology import Confidence, Domain, ModuleManifest, Provenance

MANIFEST = ModuleManifest(
    id="ports",
    name="Ports",
    domain=Domain.INFRASTRUCTURE,
    kind="entities",
    cadence_seconds=604_800,
    zoom_range=(2, 4),
    requires_key=False,
    provenance=Provenance(
        source_id="nga-wpi",
        source="NGA Maritime Safety Information, World Port Index (Pub. 150)",
        licence="Public domain",
        attribution="NGA",
        freshness="Downloaded from the publisher once a week",
        confidence=Confidence.REPORTED,
        limitations=(
            "The index is a published reference compiled over many years: berths, depths and services change, and some ports have closed.",
            "Each position is one reference point for the port, not its berths or its limits.",
            "Harbour size is a category assigned by the publisher, not a measurement, so a small harbour can still be an important one.",
            "The file does not list every port in the world.",
        ),
    ),
)
