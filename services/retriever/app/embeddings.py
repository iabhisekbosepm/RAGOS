"""OpenRouter embeddings client (dense). Hybrid sparse handled by Qdrant BM25 later."""
import httpx

from .config import settings


async def embed(texts: list[str]) -> list[list[float]]:
    """Return dense embeddings for a batch of texts via OpenRouter."""
    if not settings.openrouter_api_key:
        raise RuntimeError("OPENROUTER_API_KEY not set")
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{settings.openrouter_base_url}/embeddings",
            headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
            json={"model": settings.embedding_model, "input": texts},
        )
        resp.raise_for_status()
        data = resp.json()["data"]
    return [item["embedding"] for item in sorted(data, key=lambda d: d["index"])]


async def embed_one(text: str) -> list[float]:
    return (await embed([text]))[0]
