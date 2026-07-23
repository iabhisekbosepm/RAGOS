"""Retrieval strategies for chat + the Retrieval Playground.

- semantic : dense vector search (Qdrant)
- hybrid   : dense + BM25 lexical, fused with Reciprocal Rank Fusion (RRF)
- hyde     : generate a hypothetical answer with the LLM, embed it, then dense search
- graphrag : stub (needs Neo4j — Phase 4)

BM25 runs in-process over the collection's chunks (fine for workshop-scale corpora;
for large corpora move sparse vectors into Qdrant). Each function returns a list of
{content, score, title, metadata} dicts.
"""
from typing import Any

import httpx
from qdrant_client.models import FieldCondition, Filter, MatchAny
from rank_bm25 import BM25Okapi

from . import prompts
from .chat import complete
from .config import settings
from .embeddings import embed_one


def _source_filter(sources: list[str] | None) -> Filter | None:
    """Restrict retrieval to a subset of source documents (NotebookLM-style scoping)."""
    if not sources:
        return None
    return Filter(must=[FieldCondition(key="metadata.source", match=MatchAny(any=list(sources)))])


async def rerank(query: str, records: list[dict], top_k: int) -> list[dict]:
    """Rerank candidates with a cross-encoder via OpenRouter's /rerank endpoint.

    Falls back to the original order (annotated) if rerank is unavailable, so the
    pipeline never breaks on a provider hiccup.
    """
    if not records:
        return records
    docs = [r["content"] for r in records]
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{settings.openrouter_base_url}/rerank",
                headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
                json={"model": settings.rerank_model, "query": query,
                      "documents": docs, "top_n": top_k},
            )
            resp.raise_for_status()
            results = resp.json()["results"]
        out = []
        for item in results:
            rec = dict(records[item["index"]])
            rec["score"] = round(float(item["relevance_score"]), 4)
            rec["reranked"] = True
            out.append(rec)
        return out
    except Exception as e:
        # Graceful fallback: keep original order, flag that rerank was skipped.
        for r in records[:top_k]:
            r["rerank_error"] = str(e)[:120]
        return records[:top_k]


def _payload_to_record(payload: dict, score: float) -> dict[str, Any]:
    return {
        "content": payload.get("content", ""),
        "score": score,
        "title": payload.get("title", payload.get("source", "")),
        "metadata": payload.get("metadata", {}) or {},
    }


async def dense(qdrant, query: str, collection: str, top_k: int, sources: list[str] | None = None) -> list[dict]:
    vector = await embed_one(query)
    hits = qdrant.search(
        collection_name=collection, query_vector=vector, limit=top_k, with_payload=True,
        query_filter=_source_filter(sources),
    )
    return [_payload_to_record(h.payload, float(h.score)) for h in hits]


def _all_chunks(qdrant, collection: str, sources: list[str] | None = None, limit: int = 2000) -> list[dict]:
    points, _ = qdrant.scroll(
        collection_name=collection, limit=limit, with_payload=True, with_vectors=False,
        scroll_filter=_source_filter(sources),
    )
    return [p.payload for p in points]


def _bm25(query: str, payloads: list[dict], top_k: int) -> list[tuple[dict, int]]:
    corpus = [(p.get("content", "") or "").lower().split() for p in payloads]
    if not any(corpus):
        return []
    bm = BM25Okapi(corpus)
    scores = bm.get_scores(query.lower().split())
    ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]
    return [(payloads[i], rank) for rank, i in enumerate(ranked)]


async def hybrid(qdrant, query: str, collection: str, top_k: int, sources: list[str] | None = None, k_rrf: int = 60) -> list[dict]:
    """Dense + BM25 fused with Reciprocal Rank Fusion."""
    dense_hits = await dense(qdrant, query, collection, top_k * 2, sources)
    payloads = _all_chunks(qdrant, collection, sources)
    bm25_hits = _bm25(query, payloads, top_k * 2)

    fused: dict[str, dict[str, Any]] = {}

    def add(content: str, rank: int, rec: dict):
        key = content[:120]
        entry = fused.setdefault(key, {"rec": rec, "rrf": 0.0})
        entry["rrf"] += 1.0 / (k_rrf + rank)

    for rank, r in enumerate(dense_hits):
        add(r["content"], rank, r)
    for payload, rank in bm25_hits:
        add(payload.get("content", ""), rank, _payload_to_record(payload, 0.0))

    ordered = sorted(fused.values(), key=lambda e: e["rrf"], reverse=True)[:top_k]
    return [{**e["rec"], "score": round(e["rrf"], 4)} for e in ordered]


async def hyde(qdrant, query: str, collection: str, top_k: int, sources: list[str] | None = None, model: str | None = None) -> list[dict]:
    """Hypothetical Document Embeddings: draft an answer, embed it, dense-search on it."""
    prompt = [
        {"role": "system", "content": prompts.get("hyde")},
        {"role": "user", "content": query},
    ]
    hypothetical = await complete(prompt, model or settings.llm_model, max_tokens=200)
    return await dense(qdrant, f"{query}\n\n{hypothetical}", collection, top_k, sources)


async def run_strategy(
    qdrant, strategy: str, query: str, collection: str, top_k: int,
    use_rerank: bool = False, sources: list[str] | None = None
) -> Any:
    # When reranking, pull a wider candidate set first, then let the reranker pick top_k.
    fetch_k = top_k * 4 if use_rerank else top_k
    if strategy == "semantic":
        hits = await dense(qdrant, query, collection, fetch_k, sources)
    elif strategy == "hybrid":
        hits = await hybrid(qdrant, query, collection, fetch_k, sources)
    elif strategy == "hyde":
        hits = await hyde(qdrant, query, collection, fetch_k, sources)
    elif strategy == "graphrag":
        from .graph import graphrag_search  # local import avoids load-order issues
        result = await graphrag_search(query, collection, fetch_k)
        hits = result if isinstance(result, list) else None
        if hits is None:
            return result  # {"todo": ...}
    else:
        return {"error": f"unknown strategy '{strategy}'"}
    if use_rerank:
        hits = await rerank(query, hits, top_k)
    return hits
