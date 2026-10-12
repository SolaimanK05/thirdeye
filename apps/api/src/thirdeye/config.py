from typing import Literal, NamedTuple

from pydantic import PostgresDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class BBox(NamedTuple):
    west: float
    south: float
    east: float
    north: float


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: PostgresDsn
    log_level: Literal["debug", "info", "warning", "error"] = "info"
    public_instance: bool = False
    region_bbox: BBox = BBox(west=78.0, south=5.0, east=100.0, north=24.0)
    modules_enabled: list[str] = []
    cors_origins: list[str] = ["http://localhost:3000"]

    @field_validator("log_level", mode="before")
    @classmethod
    def lowercase_log_level(cls, value: object) -> object:
        return value.lower() if isinstance(value, str) else value

    @field_validator("region_bbox")
    @classmethod
    def check_bbox(cls, box: BBox) -> BBox:
        if not -180 <= box.west <= 180 or not -180 <= box.east <= 180:
            raise ValueError("west and east must be between -180 and 180")
        if not -90 <= box.south <= 90 or not -90 <= box.north <= 90:
            raise ValueError("south and north must be between -90 and 90")
        if box.south >= box.north:
            raise ValueError(
                f"south ({box.south}) must be less than north ({box.north})"
            )
        if box.west >= box.east:
            raise ValueError(
                f"west ({box.west}) must be less than east ({box.east}); "
                "boxes crossing the 180° meridian are not supported"
            )
        return box
