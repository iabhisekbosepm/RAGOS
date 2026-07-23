"""Langfuse observability — lazy, optional. No-op if keys aren't configured."""
from .config import settings

_client = None
_init = False


def client():
    """Return a Langfuse client if configured, else None (tracing disabled)."""
    global _client, _init
    if _init:
        return _client
    _init = True
    if settings.langfuse_public_key and settings.langfuse_secret_key:
        try:
            from langfuse import Langfuse
            _client = Langfuse(
                public_key=settings.langfuse_public_key,
                secret_key=settings.langfuse_secret_key,
                host=settings.langfuse_host,
            )
        except Exception:
            _client = None
    return _client


def flush():
    if _client:
        try:
            _client.flush()
        except Exception:
            pass
