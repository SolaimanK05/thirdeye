import logging

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
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            *exceptions,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        cache_logger_on_first_use=True,
    )
