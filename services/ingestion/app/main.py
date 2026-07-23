"""CC-RAGOS Ingestion service.

Text path:  upload → Docling parse → chunk → OpenRouter embed → Qdrant upsert.
Image path: upload → save to media/ → vision-LLM caption → embed caption → Qdrant
            (payload flags type=image + image_url, enabling visual citations).
"""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

import httpx
from docling.document_converter import DocumentConverter
from fastapi import Depends, FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, FieldCondition, Filter, MatchValue, PayloadSchemaType, PointStruct, VectorParams,
)

from .config import settings
from .auth import current_user, require_editor
from . import chunkers
from . import mcp_client
from . import obs
from . import prompts
from . import vision

MEDIA_DIR = Path("media")

app = FastAPI(title="CC-RAGOS Ingestion", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
qdrant = QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key or None)
converter = DocumentConverter()

MEDIA_DIR.mkdir(exist_ok=True)
app.mount("/media", StaticFiles(directory="media"), name="media")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# Ingestion entry point is POST /ingest/stream (below) — it streams per-stage progress
# for the live pipeline UI and handles document / image / PDF paths.


class VisualCiteRequest(BaseModel):
    image_url: str   # e.g. /media/<coll>/<file>.png
    query: str


@app.post("/visual-cite")
async def visual_cite(req: VisualCiteRequest, _u: dict = Depends(current_user)) -> dict:
    """Return the bounding box of the region in the image that answers the query."""
    rel = req.image_url.lstrip("/").removeprefix("media/")
    path = MEDIA_DIR / rel
    if not path.exists():
        return {"error": "image not found", "bbox": [0, 0, 1, 1]}
    return await vision.locate(str(path), req.query)


# ── Streaming ingest (live pipeline visualization) ───────────────────
def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj)}\n\n"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.post("/ingest/stream")
async def ingest_stream(
    file: UploadFile = File(...),
    collection: str = Form(default=""),
    workspace: str = Form(default="default"),
    strategy: str = Form(default="structure"),
    chunk_size: int = Form(default=0),
    overlap: int = Form(default=0),
    contextual: bool = Form(default=True),
    _u: dict = Depends(require_editor),
) -> StreamingResponse:
    """Same pipeline as /ingest but emits an SSE event per stage for the UI. Editor+ only."""
    coll = collection or settings.qdrant_collection
    _ensure_collection(coll)
    ext = Path(file.filename or "").suffix.lower()
    fname = file.filename or "file"
    data = await file.read()
    kind = "image" if ext in vision.IMAGE_EXTS else "pdf" if ext == ".pdf" else "document"
    size = chunk_size or settings.chunk_size
    ov = overlap or settings.chunk_overlap

    lf = obs.client()
    root = lf.start_observation(name="ingest", as_type="span", input=fname,
                                metadata={"kind": kind, "collection": coll, "workspace": workspace,
                                          "strategy": strategy, "bytes": len(data)}) if lf else None

    async def gen():
        ingested = 0
        try:
            yield _sse({"stage": "received", "filename": fname, "kind": kind, "bytes": len(data)})
            _delete_source(coll, fname)  # re-ingest dedup: replace any prior version
            if kind == "image":
                async for ev in _stream_image(data, ext, coll, workspace, fname, root):
                    yield ev
            elif kind == "pdf":
                async for ev in _stream_pdf(data, coll, workspace, fname, root):
                    yield ev
            else:
                async for ev in _stream_document(data, ext, coll, workspace, fname, strategy, size, ov, contextual, root):
                    yield ev
        except Exception as e:
            yield _sse({"stage": "error", "detail": str(e)})
            if root:
                root.update(output=f"[error: {e}]", level="ERROR")
        finally:
            if root:
                root.end()
            obs.flush()

    return StreamingResponse(gen(), media_type="text/event-stream")


async def _stream_document(data: bytes, ext: str, coll: str, workspace: str, fname: str,
                           strategy: str, size: int, overlap: int, contextual: bool = True, trace=None):
    yield _sse({"stage": "parsing", "detail": "Docling extracting text & layout"})
    pspan = trace.start_observation(name="parse", as_type="span", input=fname) if trace else None
    text = _parse_bytes(data, ext or ".bin")
    if pspan:
        pspan.update(output=f"{len(text)} chars"); pspan.end()
    yield _sse({"stage": "parsed", "detail": f"{len(text):,} characters"})

    yield _sse({"stage": "chunking", "detail": f"{strategy} · {size}/{overlap}"})
    if strategy == "semantic":
        items = await chunkers.semantic(text, size, _embed)
    else:
        items = chunkers.chunk(text, strategy, size, overlap)
    yield _sse({"stage": "chunked", "count": len(items)})
    if not items:
        yield _sse({"stage": "done", "ingested": 0, "collection": coll})
        if trace:
            trace.update(output="0 chunks")
        return

    doc_ctx = ""
    if contextual:
        yield _sse({"stage": "contextualizing", "detail": "doc-level context (contextual retrieval)"})
        cspan = trace.start_observation(name="contextualize", as_type="generation",
                                        model=settings.llm_model) if trace else None
        doc_ctx = await _doc_context(text)
        if cspan:
            cspan.update(output=doc_ctx); cspan.end()

    yield _sse({"stage": "embedding", "detail": settings.embedding_model, "count": len(items)})
    embed_texts = [f"{doc_ctx}\n\n{it['embed']}" if doc_ctx else it["embed"] for it in items]
    usage: dict = {}
    espan = trace.start_observation(name="embed", as_type="generation", model=settings.embedding_model,
                                    input=f"{len(items)} chunks") if trace else None
    vectors = await _embed(embed_texts, usage)
    if espan:
        espan.update(output=f"{len(vectors)} vectors", usage_details={"total": usage.get("total", 0)}); espan.end()
    yield _sse({"stage": "indexing", "detail": "upserting vectors into Qdrant"})
    ts = _now()
    ispan = trace.start_observation(name="index", as_type="span", input=f"{len(items)} points") if trace else None
    qdrant.upsert(collection_name=coll, points=[
        PointStruct(id=str(uuid.uuid4()), vector=v,
                    payload={"content": it["content"], "title": fname, "source": fname,
                             "metadata": {"workspace": workspace, "source": fname,
                                          "chunk_index": i, "type": "text",
                                          "chunk_strategy": strategy, "ingested_at": ts,
                                          "doc_context": doc_ctx or None}})
        for i, (it, v) in enumerate(zip(items, vectors))
    ])
    if ispan:
        ispan.end()
    if trace:
        trace.update(output=f"{len(items)} chunks indexed")
    yield _sse({"stage": "done", "ingested": len(items), "collection": coll, "kind": "document"})


async def _stream_image(data: bytes, ext: str, coll: str, workspace: str, fname: str, trace=None):
    coll_dir = MEDIA_DIR / coll
    coll_dir.mkdir(parents=True, exist_ok=True)
    out = coll_dir / f"{uuid.uuid4().hex}{ext}"
    out.write_bytes(data)
    image_url = f"/media/{coll}/{out.name}"
    yield _sse({"stage": "saving", "detail": "stored image", "image_url": image_url})

    yield _sse({"stage": "captioning", "detail": f"vision model ({settings.vision_model})"})
    caption = await vision.caption(str(out))
    content = f"[Image: {fname}]\n{caption}"
    yield _sse({"stage": "captioned", "detail": caption[:120]})

    yield _sse({"stage": "embedding", "detail": settings.embedding_model, "count": 1})
    vector = (await _embed([content]))[0]
    yield _sse({"stage": "indexing", "detail": "upserting into Qdrant"})
    qdrant.upsert(collection_name=coll, points=[PointStruct(
        id=str(uuid.uuid4()), vector=vector,
        payload={"content": content, "title": fname, "source": fname,
                 "metadata": {"workspace": workspace, "source": fname,
                              "type": "image", "image_url": image_url, "ingested_at": _now()}})])
    if trace:
        trace.update(output="1 image chunk")
    yield _sse({"stage": "done", "ingested": 1, "collection": coll, "kind": "image", "image_url": image_url})


async def _stream_pdf(data: bytes, coll: str, workspace: str, fname: str, trace=None, max_pages: int = 40):
    import fitz

    coll_dir = MEDIA_DIR / coll
    coll_dir.mkdir(parents=True, exist_ok=True)
    stem = uuid.uuid4().hex
    doc = fitz.open(stream=data, filetype="pdf")
    total = min(len(doc), max_pages)
    yield _sse({"stage": "rendering", "detail": f"{total} pages", "total": total})

    points = []
    for i in range(total):
        page = doc[i]
        text = page.get_text().strip()
        page.get_pixmap(dpi=120).save(str(coll_dir / f"{stem}_p{i + 1}.png"))
        image_url = f"/media/{coll}/{stem}_p{i + 1}.png"
        content = text or f"[Page {i + 1} of {fname} — image only]"
        vector = (await _embed([content[:6000]]))[0]
        points.append(PointStruct(id=str(uuid.uuid4()), vector=vector,
                      payload={"content": content, "title": f"{fname} p.{i + 1}", "source": fname,
                               "metadata": {"workspace": workspace, "source": fname,
                                            "type": "pdf_page", "page": i + 1, "image_url": image_url,
                                            "ingested_at": _now()}}))
        yield _sse({"stage": "page", "page": i + 1, "total": total})
    doc.close()
    yield _sse({"stage": "indexing", "detail": f"upserting {len(points)} pages"})
    if points:
        qdrant.upsert(collection_name=coll, points=points)
    if trace:
        trace.update(output=f"{len(points)} pages indexed")
    yield _sse({"stage": "done", "ingested": len(points), "collection": coll, "kind": "pdf"})


# ── MCP ingestion (pull data from a remote MCP server) ───────────────
class McpListRequest(BaseModel):
    url: str
    transport: str = "auto"        # auto | http | sse
    headers: dict[str, str] = {}   # e.g. {"Authorization": "Bearer <key>"}


@app.post("/mcp/list")
async def mcp_list(req: McpListRequest) -> dict:
    """List the resources exposed by an MCP server (for the user to pick)."""
    try:
        return {"resources": await mcp_client.list_resources(req.url, req.transport, req.headers)}
    except Exception as e:
        hint = await mcp_client.probe(req.url, req.headers)
        return {"error": f"{e}  ({hint})"}


class McpIngestRequest(BaseModel):
    url: str
    transport: str = "auto"
    headers: dict[str, str] = {}
    collection: str = ""
    workspace: str = "default"
    uris: list[str] = []
    strategy: str = "structure"
    chunk_size: int = 0
    overlap: int = 0


@app.post("/mcp/ingest/stream")
async def mcp_ingest_stream(req: McpIngestRequest, _u: dict = Depends(require_editor)) -> StreamingResponse:
    """Fetch selected MCP resources and index them, streaming per-resource pipeline stages. Editor+ only."""
    coll = req.collection or settings.qdrant_collection
    _ensure_collection(coll)
    size = req.chunk_size or settings.chunk_size
    ov = req.overlap or settings.chunk_overlap

    async def gen():
        try:
            yield _sse({"stage": "connecting", "detail": req.transport})
            total_chunks = 0
            ts = _now()
            for idx, uri in enumerate(req.uris):
                yield _sse({"stage": "resource_start", "uri": uri, "index": idx + 1, "total": len(req.uris)})
                r = await mcp_client.fetch_resource(req.url, req.transport, req.headers, uri)
                _delete_source(coll, r["name"])  # dedup: replace prior version of this resource
                items = chunkers.chunk(r["text"], req.strategy, size, ov)
                yield _sse({"stage": "resource_chunked", "uri": uri, "name": r["name"], "count": len(items)})
                if items:
                    vectors = await _embed([it["embed"] for it in items])
                    qdrant.upsert(collection_name=coll, points=[
                        PointStruct(id=str(uuid.uuid4()), vector=v,
                                    payload={"content": it["content"], "title": r["name"], "source": r["name"],
                                             "metadata": {"workspace": req.workspace, "source": r["name"],
                                                          "type": "mcp", "mcp_url": req.url, "uri": uri,
                                                          "chunk_index": i, "ingested_at": ts}})
                        for i, (it, v) in enumerate(zip(items, vectors))
                    ])
                    total_chunks += len(items)
                yield _sse({"stage": "resource_done", "uri": uri, "name": r["name"], "chunks": len(items)})
            yield _sse({"stage": "done", "ingested": total_chunks, "collection": coll,
                        "kind": "mcp", "resources": len(req.uris)})
        except Exception as e:
            yield _sse({"stage": "error", "detail": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream")


def _parse_bytes(data: bytes, suffix: str) -> str:
    with NamedTemporaryFile(delete=True, suffix=suffix) as tmp:
        tmp.write(data)
        tmp.flush()
        return converter.convert(tmp.name).document.export_to_markdown()


# ── internals ────────────────────────────────────────────────────────
async def _embed(texts: list[str], usage_out: dict | None = None) -> list[list[float]]:
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{settings.openrouter_base_url}/embeddings",
            headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
            json={"model": settings.embedding_model, "input": texts},
        )
        resp.raise_for_status()
        body = resp.json()
    if usage_out is not None and body.get("usage"):
        u = body["usage"]
        usage_out["total"] = usage_out.get("total", 0) + u.get("total_tokens", u.get("prompt_tokens", 0))
    return [d["embedding"] for d in sorted(body["data"], key=lambda x: x["index"])]


def _ensure_collection(name: str) -> None:
    if not qdrant.collection_exists(name):
        qdrant.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=settings.embedding_dim, distance=Distance.COSINE),
        )
    # Payload index on source → fast metadata filtering (source subsetting).
    try:
        qdrant.create_payload_index(name, field_name="metadata.source", field_schema=PayloadSchemaType.KEYWORD)
    except Exception:
        pass  # already indexed


def _delete_source(coll: str, source: str) -> None:
    """Re-ingest dedup: drop any existing chunks for this source before re-adding."""
    try:
        qdrant.delete(collection_name=coll, points_selector=Filter(
            must=[FieldCondition(key="metadata.source", match=MatchValue(value=source))]))
    except Exception:
        pass


async def _doc_context(text: str, model: str | None = None) -> str:
    """One short doc-level context blurb (Anthropic 'contextual retrieval') prepended to each chunk."""
    snippet = text[:6000]
    messages = [
        {"role": "system", "content": prompts.get("doc_context")},
        {"role": "user", "content": snippet},
    ]
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{settings.openrouter_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
                json={"model": model or settings.llm_model, "messages": messages, "max_tokens": 120},
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception:
        return ""
