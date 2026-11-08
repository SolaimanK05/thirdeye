import json
import logging
from collections.abc import Iterator

import pytest

from thirdeye.config import Settings
from thirdeye.logs import DATABASE_LOGGERS, configure_logging


def settings(**changes: str) -> Settings:
    return Settings(
        database_url="postgresql://test:test@127.0.0.1:1/test",
        _env_file=None,
        **changes,  # type: ignore[arg-type]
    )


@pytest.fixture(autouse=True)
def restore_loggers() -> Iterator[None]:
    yield
    for name in DATABASE_LOGGERS:
        logger = logging.getLogger(name)
        logger.handlers[:] = []
        logger.propagate = True
        logger.setLevel(logging.NOTSET)


def test_the_pool_s_warnings_come_out_in_the_app_s_json_format(
    capsys: pytest.CaptureFixture[str],
) -> None:
    configure_logging(settings(log_format="json"))
    logging.getLogger("psycopg.pool").warning("error connecting in 'thirdeye'")
    line = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert line["event"] == "error connecting in 'thirdeye'"
    assert line["level"] == "warning"
    assert line["logger"] == "psycopg.pool"
    assert "timestamp" in line


def test_the_pretty_format_has_no_bare_stdlib_line(
    capsys: pytest.CaptureFixture[str],
) -> None:
    configure_logging(settings(log_format="pretty"))
    logging.getLogger("psycopg.pool").warning("pool is unhappy")
    out = capsys.readouterr().out
    assert "pool is unhappy" in out
    assert "warning" in out


def test_database_chatter_below_warning_is_dropped(
    capsys: pytest.CaptureFixture[str],
) -> None:
    configure_logging(settings(log_level="debug", log_format="json"))
    logging.getLogger("psycopg").info("connection details")
    assert capsys.readouterr().out == ""


def test_database_logs_do_not_also_reach_the_root_logger(
    caplog: pytest.LogCaptureFixture,
) -> None:
    configure_logging(settings(log_format="json"))
    logging.getLogger("psycopg.pool").warning("only once")
    assert "only once" not in caplog.text
