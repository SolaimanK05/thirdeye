from functools import lru_cache
from typing import Literal, NamedTuple, Self

from pydantic import (
    Field,
    PostgresDsn,
    SecretStr,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict


class BBox(NamedTuple):
    west: float
    south: float
    east: float
    north: float


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: PostgresDsn
    db_pool_min_size: int = Field(default=1, ge=0)
    db_pool_max_size: int = Field(default=5, ge=1)
    db_timeout_seconds: float = Field(default=5.0, gt=0)
    log_level: Literal["debug", "info", "warning", "error"] = "info"
    log_format: Literal["pretty", "json"] = "pretty"
    public_instance: bool = False
    region_bbox: BBox = BBox(west=78.0, south=5.0, east=100.0, north=24.0)
    modules_enabled: list[str] = []
    modules_default_on: list[str] | None = None
    firms_map_key: SecretStr | None = None
    aisstream_api_key: SecretStr | None = None
    cors_origins: list[str] = ["http://localhost:3000"]

    def has_key(self, key_env: str) -> bool:
        value = getattr(self, key_env.lower(), None)
        return isinstance(value, SecretStr) and bool(value.get_secret_value().strip())

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

    @model_validator(mode="after")
    def check_pool_sizes(self) -> Self:
        if self.db_pool_min_size > self.db_pool_max_size:
            raise ValueError(
                f"db_pool_min_size ({self.db_pool_min_size}) must not exceed "
                f"db_pool_max_size ({self.db_pool_max_size})"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
