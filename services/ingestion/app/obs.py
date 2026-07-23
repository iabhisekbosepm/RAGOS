"""Langfuse observability — lazy, optional. No-op if keys aren't configured."""
import logging

from .config import settings

_log = logging.getLogger(__name__)
_client = None
_init = False


def client():
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
        except Exception as e:
            _log.warning("Langfuse init failed — tracing disabled: %s", e)
            _client = None
    return _client


def flush():
    if _client:
        try:
            _client.flush()
        except Exception as e:
            _log.debug("Langfuse flush failed: %s", e)
