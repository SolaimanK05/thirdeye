import logging
import sys

import structlog

from thirdeye.config import Settings


def configure_logging(settings: Settings) -> None:
    level = logging.getLevelNamesMapping()[settings.log_level.upper()]
    renderer: structlog.typing.Processor
    if settings.log_format == "json":
        renderer = structlog.processors.JSONRenderer()
        exceptions: list[structlog.typing.Processor] = [
            structlog.processors.dict_tracebacks
        ]
    else:
        renderer = structlog.dev.ConsoleRenderer()
        exceptions = []
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    shared: list[structlog.typing.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
    ]
    route_database_logs(shared, exceptions, renderer, level)
    structlog.configure(
        processors=[*shared, *exceptions, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        cache_logger_on_first_use=True,
    )


DATABASE_LOGGERS = ("psycopg", "psycopg.pool")


def route_database_logs(
    shared: list[structlog.typing.Processor],
    exceptions: list[structlog.typing.Processor],
    renderer: structlog.typing.Processor,
    level: int,
) -> None:
    """Print psycopg and its pool in the app's log format, not as bare stdlib lines."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=[structlog.stdlib.add_logger_name, *shared],
            processors=[
                structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                *exceptions,
                renderer,
            ],
        )
    )
    for name in DATABASE_LOGGERS:
        logger = logging.getLogger(name)
        logger.handlers[:] = [handler]
        logger.setLevel(max(level, logging.WARNING))
        logger.propagate = False
