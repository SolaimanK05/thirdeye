from typing import Literal

from pydantic import BaseModel, ConfigDict

from thirdeye.ontology import Confidence, ModuleManifest, SourceReliability
from thirdeye.reads import SourceRecord

type HealthState = Literal[
    "fresh", "stale", "failed", "empty", "pending", "missing_key"
]


class Out(BaseModel):
    model_config = ConfigDict(frozen=True)


class Position(Out):
    lon: float
    lat: float


class SourceOut(Out):
    id: str
    url: str
    licence: str
    reliability: SourceReliability


class ProvenanceOut(Out):
    source_id: str
    source: str
    licence: str
    attribution: str
    freshness: str
    confidence: Confidence
    limitations: list[str]


def provenance_out(manifest: ModuleManifest) -> ProvenanceOut:
    p = manifest.provenance
    return ProvenanceOut(
        source_id=p.source_id,
        source=p.source,
        licence=p.licence,
        attribution=p.attribution,
        freshness=p.freshness,
        confidence=p.confidence,
        limitations=list(p.limitations),
    )


def source_out(record: SourceRecord) -> SourceOut:
    return SourceOut(
        id=record.source_id,
        url=record.source_url,
        licence=record.source_licence,
        reliability=record.source_reliability,
    )
