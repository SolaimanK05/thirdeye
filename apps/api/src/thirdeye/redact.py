from thirdeye.config import Settings

REDACTED = "[redacted]"


def scrub(text: str, settings: Settings) -> str:
    for secret in settings.secret_values():
        text = text.replace(secret, REDACTED)
    return text
