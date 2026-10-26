import pytest
from pydantic import ValidationError

from thirdeye.config import Settings

URL = "postgresql://test:test@127.0.0.1:1/test"


def test_malformed_database_url_fails() -> None:
    with pytest.raises(ValidationError, match="database_url"):
        Settings(database_url="not-a-url", _env_file=None)


def test_inverted_bbox_fails() -> None:
    with pytest.raises(ValidationError, match="south"):
        Settings(database_url=URL, region_bbox=(78, 24, 100, 5), _env_file=None)


def test_log_level_is_case_insensitive() -> None:
    assert (
        Settings(database_url=URL, log_level="INFO", _env_file=None).log_level == "info"
    )


def test_pool_min_above_max_fails() -> None:
    with pytest.raises(ValidationError, match="db_pool_min_size"):
        Settings(
            database_url=URL, db_pool_min_size=6, db_pool_max_size=5, _env_file=None
        )


def test_the_aircraft_box_follows_the_region_unless_set() -> None:
    settings = Settings(database_url=URL, region_bbox=(78, 5, 100, 24), _env_file=None)
    assert settings.aircraft_bbox == settings.region_bbox
    own = Settings(
        database_url=URL,
        region_bbox=(78, 5, 100, 24),
        opensky_bbox=(0, 0, 10, 10),
        _env_file=None,
    )
    assert own.aircraft_bbox == (0, 0, 10, 10)


def test_an_inverted_aircraft_box_fails() -> None:
    with pytest.raises(ValidationError, match="south"):
        Settings(database_url=URL, opensky_bbox=(0, 10, 10, 0), _env_file=None)


def test_the_governor_defaults_match_the_spec() -> None:
    settings = Settings(database_url=URL, _env_file=None)
    assert settings.budget_opensky_credits_day == 3800
    assert settings.governor_cooldown_min_s == 30
    assert settings.governor_cooldown_max_s == 1800


def test_a_cooldown_minimum_above_the_maximum_fails() -> None:
    with pytest.raises(ValidationError, match="governor_cooldown_min_s"):
        Settings(
            database_url=URL,
            governor_cooldown_min_s=100,
            governor_cooldown_max_s=10,
            _env_file=None,
        )


@pytest.mark.parametrize("value", [0, -5])
def test_a_budget_below_one_fails(value: int) -> None:
    with pytest.raises(ValidationError, match="budget_opensky_credits_day"):
        Settings(database_url=URL, budget_opensky_credits_day=value, _env_file=None)
