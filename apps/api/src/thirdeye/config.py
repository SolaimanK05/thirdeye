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
    instance_name: str = Field(default="thirdeye-local", min_length=1, max_length=64)
    region_bbox: BBox = BBox(west=78.0, south=5.0, east=100.0, north=24.0)
    modules_enabled: list[str] = []
    modules_default_on: list[str] | None = None
    firms_map_key: SecretStr | None = None
    firms_min_confidence: Literal["low", "nominal", "high"] = "high"
    firms_min_frp_mw: float = Field(default=0.0, ge=0, allow_inf_nan=False)
    aisstream_api_key: SecretStr | None = None
    opensky_client_id: SecretStr | None = None
    opensky_client_secret: SecretStr | None = None
    opensky_bbox: BBox | None = None
    budget_opensky_credits_day: int = Field(default=3800, ge=1)
    governor_cooldown_min_s: float = Field(default=30.0, gt=0, allow_inf_nan=False)
    governor_cooldown_max_s: float = Field(default=1800.0, gt=0, allow_inf_nan=False)
    cors_origins: list[str] = ["http://localhost:3000"]

    def has_key(self, key_env: str) -> bool:
        value = getattr(self, key_env.lower(), None)
        return isinstance(value, SecretStr) and bool(value.get_secret_value().strip())

    def secret_values(self) -> list[str]:
        secrets = (
            self.firms_map_key,
            self.aisstream_api_key,
            self.opensky_client_id,
            self.opensky_client_secret,
        )
        return [
            value
            for secret in secrets
            if secret is not None
            if (value := secret.get_secret_value().strip())
        ]

    @field_validator("log_level", mode="before")
    @classmethod
    def lowercase_log_level(cls, value: object) -> object:
        return value.lower() if isinstance(value, str) else value

    @property
    def aircraft_bbox(self) -> BBox:
        return self.opensky_bbox or self.region_bbox

    @field_validator("region_bbox", "opensky_bbox")
    @classmethod
    def check_bbox(cls, box: BBox | None) -> BBox | None:
        if box is None:
            return None
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
    def check_cooldown_window(self) -> Self:
        if self.governor_cooldown_min_s > self.governor_cooldown_max_s:
            raise ValueError(
                f"governor_cooldown_min_s ({self.governor_cooldown_min_s}) must not "
                f"exceed governor_cooldown_max_s ({self.governor_cooldown_max_s})"
            )
        return self

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
