"""Minimal MCP client — pull data from a remote MCP server at ingestion time.

Supports Streamable HTTP and SSE transports (many servers expose `.../mcp/sse`) with
arbitrary custom headers (e.g. `Authorization: Bearer <key>`).
"""
from typing import Any, Awaitable, Callable

import httpx
from mcp import ClientSession
from pydantic import AnyUrl
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamablehttp_client


def _flatten(err: BaseException) -> str:
    """Unwrap anyio ExceptionGroups → the most specific underlying message(s)."""
    msgs: list[str] = []

    def rec(e: BaseException):
        subs = getattr(e, "exceptions", None)
        if subs:
            for s in subs:
                rec(s)
        else:
            msgs.append(f"{type(e).__name__}: {e}".strip().rstrip(": "))

    rec(err)
    return " · ".join(dict.fromkeys(m for m in msgs if m)) or type(err).__name__


async def probe(url: str, headers: dict | None) -> str:
    """Lightweight GET to reveal what the endpoint actually returns (status + content-type)."""
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as c:
            r = await c.get(url, headers={**(headers or {}), "Accept": "text/event-stream"})
            ct = r.headers.get("content-type", "?")
            return f"endpoint GET → HTTP {r.status_code}, {ct}"
    except Exception as e:  # noqa: BLE001
        return f"endpoint probe failed: {type(e).__name__}"

TRANSPORTS = {
    "http": [streamablehttp_client],
    "sse": [sse_client],
    "auto": [streamablehttp_client, sse_client],
}


async def _run(url: str, transport: str, headers: dict | None,
               fn: Callable[[ClientSession], Awaitable[Any]]) -> Any:
    """Open an MCP session with the chosen transport(s), run fn(session)."""
    last: Exception | None = None
    for client in TRANSPORTS.get(transport, TRANSPORTS["auto"]):
        try:
            async with client(url, headers=headers or None) as conn:
                read, write, *_ = conn  # streamable-http yields (read, write, get_session_id); sse yields 2
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    return await fn(session)
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(_flatten(last) if last else "MCP connection failed")


async def list_resources(url: str, transport: str = "auto", headers: dict | None = None) -> list[dict]:
    async def fn(s: ClientSession):
        res = await s.list_resources()
        return [{"uri": str(r.uri), "name": r.name or str(r.uri),
                 "mimeType": getattr(r, "mimeType", None), "description": getattr(r, "description", None)}
                for r in res.resources]
    return await _run(url, transport, headers, fn)


async def fetch_resource(url: str, transport: str, headers: dict | None, uri: str) -> dict:
    """Read a single resource → {uri, name, text}."""
    async def fn(s: ClientSession):
        listed = {str(r.uri): (r.name or str(r.uri)) for r in (await s.list_resources()).resources}
        res = await s.read_resource(AnyUrl(uri))
        text = "\n\n".join(getattr(c, "text", "") for c in res.contents if getattr(c, "text", ""))
        return {"uri": uri, "name": listed.get(uri, uri), "text": text}
    return await _run(url, transport, headers, fn)
