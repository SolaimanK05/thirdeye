from thirdeye.ontology import Confidence, Domain, ModuleManifest, Provenance

TWO_HOURS = 7_200

MANIFEST = ModuleManifest(
    id="satellites",
    name="Satellites",
    domain=Domain.MOVERS,
    kind="entities",
    cadence_seconds=86_400,
    zoom_range=(1, 3),
    requires_key=False,
    honor_last_fetch=True,
    min_retry_seconds=TWO_HOURS,
    provenance=Provenance(
        source_id="celestrak",
        source="CelesTrak, general perturbations (GP) orbital elements and satellite catalogue",
        licence="CelesTrak usage policy (free, one download per update)",
        attribution="CelesTrak",
        freshness="Element sets are downloaded once a day; positions are computed in the browser every second",
        confidence=Confidence.DERIVED,
        limitations=(
            "Positions are computed from orbital elements, not observed, and the elements lose accuracy within days.",
            "A satellite that manoeuvres, or is near the end of its life, can be well away from its computed position until new elements are published.",
            "Only the active satellites CelesTrak tracks are here: debris, spent rocket bodies and most military or secret objects are not.",
            "The elements describe the orbit's shape, not the satellite's attitude, so nothing here says what it is doing.",
        ),
    ),
)
