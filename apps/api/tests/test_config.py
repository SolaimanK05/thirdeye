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
