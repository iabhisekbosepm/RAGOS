"""CC-RAGOS Retriever + chat service.

Roles:
  1. Chat orchestration → POST /chat (grounded, streaming SSE, visible pipeline + citations)
  2. Read-only visualization APIs for the Next.js frontend (chunks, embeddings, playground)

Dense retrieval via Qdrant + OpenRouter embeddings; LLM answer via OpenRouter.
HyDE / GraphRAG / rerank / sparse are stubbed for later phases (clearly marked).
"""
import asyncio
import json
import logging
import re
import time
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, FieldCondition, Filter, MatchValue, VectorParams

from . import audio as audio_mod
from . import db
from . import evaluate as eval_mod
from . import graph as graph_mod
from . import obs
from . import prompts
from . import auth as auth_mod
from . import vision as vision_mod
from .auth import current_user, require_admin, require_editor, require_viewer
from .chat import build_messages, complete, condense_query, stream_llm
from .config import settings
from .embeddings import embed_one
from .retrieval import dense, run_strategy
from .study import generate as study_generate

app = FastAPI(title="CC-RAGOS Retriever", version="0.1.0")

# Browser (web app) calls the viz endpoints cross-origin (port 3000 → 8100).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

qdrant = QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key or None)

_log = logging.getLogger("ccragos.retriever")


@app.on_event("startup")
def _auth_startup() -> None:
    """Reject insecure defaults when auth is enforced; seed the first admin; warn if open."""
    auth_mod.validate_startup()  # raises → refuses to start with default secret/password when enabled
    if not settings.auth_enabled:
        _log.warning("AUTH DISABLED — all endpoints are open (set AUTH_ENABLED=true to enforce RBAC)")
    try:
        auth_mod.seed_admin()
    except Exception as exc:  # don't crash startup, but make it visible
        _log.error("seed_admin failed: %s", exc)


# ── Auth (self-contained JWT + RBAC) ─────────────────────────────────
class LoginRequest(BaseModel):
    username: str
    password: str


class NewUserRequest(BaseModel):
    username: str
    password: str
    role: str = "viewer"


class RoleUpdate(BaseModel):
    role: str


@app.get("/auth/config")
def auth_config() -> dict[str, Any]:
    """Public: tells the frontend whether auth is enforced."""
    return {"enabled": settings.auth_enabled}


# Lightweight in-memory login throttle: max N failures per IP per window.
_login_fails: dict[str, list[float]] = {}
_LOGIN_MAX = 8
_LOGIN_WINDOW = 300.0  # seconds


def _login_allowed(ip: str) -> bool:
    now = time.time()
    hits = [t for t in _login_fails.get(ip, []) if now - t < _LOGIN_WINDOW]
    _login_fails[ip] = hits
    return len(hits) < _LOGIN_MAX


@app.post("/auth/login")
def auth_login(req: LoginRequest, request: Request) -> dict[str, Any]:
    ip = request.client.host if request.client else "unknown"
    if not _login_allowed(ip):
        raise HTTPException(status_code=429, detail="too many attempts — try again later")
    user = db.get_user_by_username(req.username.strip())
    if not user:
        auth_mod.dummy_verify()  # equalize timing so unknown vs known users can't be distinguished
        _login_fails.setdefault(ip, []).append(time.time())
        raise HTTPException(status_code=401, detail="invalid username or password")
    if not auth_mod.verify_password(req.password, user["password_hash"]):
        _login_fails.setdefault(ip, []).append(time.time())
        raise HTTPException(status_code=401, detail="invalid username or password")
    _login_fails.pop(ip, None)  # reset on success
    token = auth_mod.make_token(user)
    return {"token": token, "user": {"id": user["id"], "username": user["username"], "role": user["role"]}}


@app.get("/auth/me")
def auth_me(user: dict = Depends(current_user)) -> dict[str, Any]:
    return {"user": user}


@app.get("/auth/users")
def auth_users(_: dict = Depends(require_admin)) -> dict[str, Any]:
    return {"users": db.list_users()}


@app.post("/auth/users")
def auth_create_user(req: NewUserRequest, _: dict = Depends(require_admin)) -> dict[str, Any]:
    if req.role not in auth_mod.ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {auth_mod.ROLES}")
    if not req.username.strip() or len(req.password) < 12:
        raise HTTPException(status_code=400, detail="username required and password must be ≥ 12 chars")
    if db.get_user_by_username(req.username.strip()):
        raise HTTPException(status_code=409, detail="username already exists")
    return db.create_user(req.username.strip(), auth_mod.hash_password(req.password), req.role)


@app.patch("/auth/users/{uid}")
def auth_update_role(uid: str, req: RoleUpdate, admin: dict = Depends(require_admin)) -> dict[str, str]:
    if req.role not in auth_mod.ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {auth_mod.ROLES}")
    target = db.get_user(uid)
    if not target:
        raise HTTPException(status_code=404, detail="user not found")
    if uid == admin["id"] and req.role != "admin":
        raise HTTPException(status_code=400, detail="cannot change your own role")
    # Never leave the system without an admin.
    if target["role"] == "admin" and req.role != "admin":
        admins = sum(1 for u in db.list_users() if u["role"] == "admin")
        if admins <= 1:
            raise HTTPException(status_code=400, detail="cannot demote the last admin")
    db.update_user_role(uid, req.role)
    return {"status": "ok"}


@app.delete("/auth/users/{uid}")
def auth_delete_user(uid: str, admin: dict = Depends(require_admin)) -> dict[str, str]:
    if uid == admin["id"]:
        raise HTTPException(status_code=400, detail="cannot delete your own account")
    db.delete_user(uid)
    return {"status": "deleted"}


@app.middleware("http")
async def cors_safe_errors(request: Request, call_next):
    """Ensure unhandled errors still carry CORS headers (else the browser mislabels them 'CORS blocked')."""
    try:
        return await call_next(request)
    except Exception as e:  # noqa: BLE001
        _log.exception("unhandled error on %s %s", request.method, request.url.path)
        resp = JSONResponse({"error": "internal server error"}, status_code=500)  # don't leak internals
        origin = request.headers.get("origin")
        if origin in settings.cors_origins:
            resp.headers["Access-Control-Allow-Origin"] = origin
        return resp


# ── Chat orchestration ───────────────────────────────────────────────
class ChatRequest(BaseModel):
    query: str
    collection: str = settings.qdrant_collection
    top_k: int = 5
    model: str | None = None          # LLM Playground override
    prompt_style: str = "standard"    # Prompt Playground: standard | cot | concise
    strategy: str = "semantic"        # semantic | hybrid | hyde
    rerank: bool = False              # add a cross-encoder rerank stage
    conversation_id: str | None = None  # continue an existing chat (else a new one is created)
    sources: list[str] = []           # optional: restrict retrieval to these source documents
    images: list[str] = []            # optional: base64 data-URL reference images (vision-augmented retrieval)


def _sse(obj: dict[str, Any]) -> str:
    return f"data: {json.dumps(obj)}\n\n"


@app.post("/chat")
async def chat(req: ChatRequest, _user: dict = Depends(current_user)) -> StreamingResponse:
    """Stream a grounded answer with visible pipeline steps + citations (SSE). Persists to SQLite."""
    model = req.model or settings.llm_model
    # SQLite calls are blocking — keep them off the event loop in this async handler.
    conversation_id = req.conversation_id or await asyncio.to_thread(
        db.create_conversation, req.collection, req.query, _user["id"])
    prior = await asyncio.to_thread(db.get_messages, conversation_id)  # history BEFORE this turn
    await asyncio.to_thread(db.add_message, conversation_id, "user", req.query, {"strategy": req.strategy})

    lf = obs.client()
    root = lf.start_observation(
        name="chat", as_type="span", input=req.query,
        metadata={"workspace": req.collection, "strategy": req.strategy, "rerank": req.rerank,
                  "scoped_sources": len(req.sources), "conversation_id": conversation_id},
    ) if lf else None

    async def gen():
        answer_parts: list[str] = []
        sources: list = []
        try:
            yield _sse({"type": "conversation", "id": conversation_id})

            # ── History-aware: condense follow-up into a standalone retrieval query ──
            retrieval_query = req.query
            if prior:
                retrieval_query = await condense_query(prior, req.query, model)
                if retrieval_query.strip() != req.query.strip():
                    yield _sse({"type": "step", "step": "rewrite", "detail": retrieval_query[:80]})

            # ── Vision: only when reference image(s) are attached. Caption+OCR them,
            #    then fold the description into the retrieval query. No image → skipped. ──
            image_desc = ""
            if req.images:
                image_desc = await vision_mod.describe_all(req.images)
                if image_desc:
                    yield _sse({"type": "step", "step": "vision",
                                "detail": f"{len(req.images[:3])} image(s) · {settings.vision_model}"})
                    retrieval_query = f"{retrieval_query}\n\n[reference image]\n{image_desc}".strip()

            yield _sse({"type": "step", "step": "embedding", "detail": settings.embedding_model})

            # ── Guardrail: relevance gate (dense cosine probe, strategy-independent) ──
            probe = await dense(qdrant, retrieval_query, req.collection, 1, req.sources)
            relevance = float(probe[0]["score"]) if probe else 0.0
            yield _sse({"type": "step", "step": "guardrail",
                        "detail": f"relevance {relevance:.2f} / min {settings.relevance_threshold}"})
            if relevance < settings.relevance_threshold:
                msg = ("I can't answer that from this workspace's sources — it looks outside the scope "
                       "of the uploaded documents. Try rephrasing, or ask about this workspace's content.")
                yield _sse({"type": "token", "text": msg})
                yield _sse({"type": "citations", "records": []})
                yield _sse({"type": "done"})
                await asyncio.to_thread(db.add_message, conversation_id, "assistant", msg,
                                        {"citations": [], "out_of_scope": True})
                if root:
                    root.update(output=msg, metadata={"out_of_scope": True})
                return

            rspan = root.start_observation(name="retrieval", as_type="retriever", input=retrieval_query,
                                           metadata={"strategy": req.strategy, "relevance": round(relevance, 3)}) if root else None
            result = await run_strategy(
                qdrant, req.strategy, retrieval_query, req.collection, req.top_k, req.rerank, req.sources
            )
            sources = result if isinstance(result, list) else []
            if rspan:
                rspan.update(output=[{"title": s.get("title"), "score": s.get("score")} for s in sources])
                rspan.end()
            detail = f"{req.strategy} · top {len(sources)}"
            if req.rerank:
                detail += f" · reranked ({settings.rerank_model})"
            if req.sources:
                detail += f" · scoped to {len(req.sources)} source(s)"
            yield _sse({"type": "step", "step": "retrieval", "detail": detail})

            if not sources:
                msg = "I can't answer that from this workspace's sources."
                yield _sse({"type": "token", "text": msg})
                yield _sse({"type": "citations", "records": []})
                yield _sse({"type": "done"})
                await asyncio.to_thread(db.add_message, conversation_id, "assistant", msg, {"citations": []})
                if root:
                    root.update(output=msg)
                return

            # When images are attached, answer with the vision model so it can see them.
            gen_model = settings.vision_model if (req.images and image_desc) else model
            messages = build_messages(req.query, sources, req.prompt_style,
                                      images=req.images if (req.images and image_desc) else None)
            yield _sse({"type": "step", "step": "prompt", "detail": req.prompt_style})
            yield _sse({"type": "step", "step": "llm", "detail": gen_model})

            usage: dict = {}
            gspan = root.start_observation(name="generate", as_type="generation", model=gen_model,
                                           input=messages) if root else None
            async for tok in stream_llm(messages, gen_model, usage):
                answer_parts.append(tok)
                yield _sse({"type": "token", "text": tok})
            answer = "".join(answer_parts)
            if gspan:
                ud = {"input": usage.get("prompt_tokens", 0), "output": usage.get("completion_tokens", 0),
                      "total": usage.get("total_tokens", 0)} if usage else None
                gspan.update(output=answer, usage_details=ud)
                gspan.end()

            yield _sse({"type": "citations", "records": sources})
            yield _sse({"type": "done"})
            await asyncio.to_thread(db.add_message, conversation_id, "assistant", answer,
                                    {"citations": sources, "strategy": req.strategy, "model": model})
            if root:
                root.update(output=answer)
        except Exception as e:  # surface errors to the UI, never hang — full detail stays server-side
            _log.exception("chat stream failed (conversation %s)", conversation_id)
            detail = f"{type(e).__name__}: request failed — see server logs"
            yield _sse({"type": "error", "detail": detail})
            await asyncio.to_thread(db.add_message, conversation_id, "assistant",
                                    "".join(answer_parts) or f"[error: {detail}]", {"error": detail})
            if root:
                root.update(output=f"[error: {e}]", level="ERROR")
        finally:
            if root:
                root.end()
            obs.flush()

    return StreamingResponse(gen(), media_type="text/event-stream")


# ── Conversations (chat history) ─────────────────────────────────────
def _scope(user: dict) -> str | None:
    """None for admins (see all), else the user's id (see only own + legacy)."""
    return None if user["role"] == "admin" else user["id"]


def _owns(user: dict, conversation_id: str) -> bool:
    if user["role"] == "admin":
        return True
    owner = db.conversation_owner(conversation_id)
    return owner is not None and owner in ("", user["id"])  # '' = legacy/ownerless


@app.get("/conversations")
def conversations(collection: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    return {"conversations": db.list_conversations(collection, _scope(user))}


@app.get("/conversations/{conversation_id}")
def conversation_detail(conversation_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    if not _owns(user, conversation_id):
        raise HTTPException(status_code=403, detail="not your conversation")
    return {"messages": db.get_messages(conversation_id)}


@app.delete("/conversations/{conversation_id}")
def conversation_delete(conversation_id: str, user: dict = Depends(current_user)) -> dict[str, str]:
    if not _owns(user, conversation_id):
        raise HTTPException(status_code=403, detail="not your conversation")
    db.delete_conversation(conversation_id)
    return {"status": "deleted"}


# ── Workspaces ───────────────────────────────────────────────────────
class WorkspaceRequest(BaseModel):
    collection: str
    name: str = ""


@app.get("/workspaces")
def workspaces(_: dict = Depends(require_viewer)) -> dict[str, Any]:
    """List workspaces (merges Qdrant collections with saved names + chunk counts)."""
    saved = {w["collection"]: w for w in db.list_workspaces()}
    existing = {c.name for c in qdrant.get_collections().collections}
    out = []
    for coll in sorted(existing | set(saved)):
        meta = saved.get(coll, {})
        count = qdrant.count(coll).count if coll in existing else 0
        out.append({"collection": coll, "name": meta.get("name", coll),
                    "chunks": count, "exists": coll in existing})
    return {"workspaces": out}


@app.post("/workspaces")
def workspace_create(req: WorkspaceRequest, _: dict = Depends(require_admin)) -> dict[str, Any]:
    # Collection names become Qdrant collections AND media/graph path components.
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", req.collection.strip()):
        raise HTTPException(status_code=400, detail="collection must match [A-Za-z0-9_-]{1,64}")
    if not qdrant.collection_exists(req.collection):
        qdrant.create_collection(
            collection_name=req.collection,
            vectors_config=VectorParams(size=settings.embedding_dim, distance=Distance.COSINE),
        )
    return db.upsert_workspace(req.collection, req.name or req.collection)


@app.delete("/workspaces/{collection}")
def workspace_delete(collection: str, _: dict = Depends(require_admin)) -> dict[str, str]:
    if qdrant.collection_exists(collection):
        qdrant.delete_collection(collection)
    db.delete_workspace(collection)
    return {"status": "deleted"}


# ── Study tools ──────────────────────────────────────────────────────
class StudyRequest(BaseModel):
    collection: str = settings.qdrant_collection
    tool: str = "flashcards"          # flashcards | quiz | summary
    count: int = 6
    topic: str = ""                   # optional: focus on a topic (else sample the corpus)
    model: str | None = None


@app.post("/study")
async def study(req: StudyRequest, _: dict = Depends(require_editor)) -> dict[str, Any]:
    """Generate a study artifact and persist it for later viewing/download."""
    if req.topic:
        records = await dense(qdrant, req.topic, req.collection, 8)
    else:
        points, _ = await asyncio.to_thread(
            qdrant.scroll, collection_name=req.collection, limit=12, with_payload=True, with_vectors=False
        )
        records = [{"content": p.payload.get("content", "")} for p in points]
    context = "\n\n".join(r["content"] for r in records)[:8000]
    if not context.strip():
        return {"error": "collection is empty"}
    result = await study_generate(req.tool, context, req.count, req.model)
    if "error" not in result:
        result["id"] = await asyncio.to_thread(db.save_study, req.collection, req.tool, req.topic, result)
    return result


class AudioRequest(BaseModel):
    collection: str = settings.qdrant_collection
    topic: str = ""
    model: str | None = None


@app.post("/audio")
async def audio(req: AudioRequest, _: dict = Depends(require_editor)) -> dict[str, Any]:
    """Generate a 2-speaker Audio Overview (script + MP3). Persisted as an artifact."""
    if req.topic:
        records = await dense(qdrant, req.topic, req.collection, 8)
    else:
        points, _ = await asyncio.to_thread(
            qdrant.scroll, collection_name=req.collection, limit=12, with_payload=True, with_vectors=False)
        records = [{"content": p.payload.get("content", "")} for p in points]
    context = "\n\n".join(r["content"] for r in records)[:8000]
    if not context.strip():
        return {"error": "collection is empty"}

    script = await audio_mod.make_script(context, req.model)
    if not script:
        return {"error": "could not generate script"}
    audio_url = await audio_mod.synthesize(script, req.collection)
    payload = {"tool": "audio", "script": script, "audio_url": audio_url,
               "note": None if audio_url else "Set DEEPGRAM_API_KEY to render audio (script only for now)."}
    payload["id"] = await asyncio.to_thread(db.save_study, req.collection, "audio", req.topic, payload)
    return payload


@app.get("/study/artifacts")
def study_list(collection: str, _: dict = Depends(require_viewer)) -> dict[str, Any]:
    return {"artifacts": db.list_study(collection)}


@app.get("/study/artifacts/{aid}")
def study_get(aid: str, _: dict = Depends(require_viewer)) -> dict[str, Any]:
    a = db.get_study(aid)
    return a or {"error": "not found"}


@app.delete("/study/artifacts/{aid}")
def study_del(aid: str, _: dict = Depends(require_editor)) -> dict[str, str]:
    db.delete_study(aid)
    return {"status": "deleted"}


# ── Evaluation (golden set + LLM-as-judge) ───────────────────────────
async def _answer(query: str, collection: str, strategy: str, rerank: bool, top_k: int = 5):
    """Non-streaming grounded answer (for eval). Returns (answer, contexts, latency_ms)."""
    t0 = time.perf_counter()
    result = await run_strategy(qdrant, strategy, query, collection, top_k, rerank)
    sources = result if isinstance(result, list) else []
    if not sources:
        return "I can't answer that from this workspace's sources.", [], (time.perf_counter() - t0) * 1000
    ans = await complete(build_messages(query, sources, "standard"), settings.llm_model, max_tokens=700)
    return ans, [s["content"] for s in sources], (time.perf_counter() - t0) * 1000


class EvalGenRequest(BaseModel):
    collection: str = settings.qdrant_collection
    count: int = 6


class EvalItemRequest(BaseModel):
    collection: str = settings.qdrant_collection
    question: str
    expected: str = ""


class EvalRunRequest(BaseModel):
    collection: str = settings.qdrant_collection
    strategy: str = "hybrid"
    rerank: bool = False
    top_k: int = 5


@app.post("/eval/generate")
async def eval_generate(req: EvalGenRequest, _: dict = Depends(require_editor)) -> dict[str, Any]:
    points, _ = await asyncio.to_thread(
        qdrant.scroll, collection_name=req.collection, limit=14, with_payload=True, with_vectors=False)
    context = "\n\n".join(p.payload.get("content", "") for p in points)[:9000]
    if not context.strip():
        return {"error": "collection is empty"}
    pairs = await eval_mod.generate_set(context, req.count)
    for p in pairs:
        db.add_eval_item(req.collection, p["question"], p.get("expected", ""))
    return {"added": len(pairs), "items": db.list_eval_items(req.collection)}


@app.get("/eval/items")
def eval_items(collection: str, _: dict = Depends(require_viewer)) -> dict[str, Any]:
    return {"items": db.list_eval_items(collection)}


@app.post("/eval/items")
def eval_add(req: EvalItemRequest, _: dict = Depends(require_editor)) -> dict[str, str]:
    return {"id": db.add_eval_item(req.collection, req.question, req.expected)}


@app.delete("/eval/items/{iid}")
def eval_del(iid: str, _: dict = Depends(require_editor)) -> dict[str, str]:
    db.delete_eval_item(iid)
    return {"status": "deleted"}


THRESHOLDS = {"faithfulness": 0.85, "answer_relevancy": 0.80, "context_relevance": 0.70}


@app.post("/eval/run")
async def eval_run(req: EvalRunRequest, _: dict = Depends(require_editor)) -> dict[str, Any]:
    items = db.list_eval_items(req.collection)
    if not items:
        return {"error": "no eval items — generate or add questions first"}
    results = []
    for it in items:
        answer, contexts, latency = await _answer(it["question"], req.collection, req.strategy, req.rerank, req.top_k)
        scores = await eval_mod.judge(it["question"], answer, contexts, it.get("expected", ""))
        results.append({"question": it["question"], "answer": answer, "latency_ms": round(latency),
                        "has_citations": bool(re.search(r"\[\d+\]", answer)), **scores})
    n = len(results)
    scored = [r for r in results if not r.get("errored")]  # exclude judge-parse failures from means
    ns = len(scored) or 1
    means = {k: round(sum(r[k] for r in scored) / ns, 3) for k in THRESHOLDS}
    summary = {
        "n": n, "scored": len(scored), "errored": n - len(scored), **means,
        "avg_latency_ms": round(sum(r["latency_ms"] for r in results) / n),
        "citation_rate": round(sum(1 for r in results if r["has_citations"]) / n, 2),
        "thresholds": THRESHOLDS,
        "pass": len(scored) > 0 and all(means[k] >= THRESHOLDS[k] for k in THRESHOLDS),
    }
    rid = db.save_eval_run(req.collection, req.strategy, req.rerank, summary, results)
    return {"id": rid, "summary": summary, "results": results}


@app.get("/eval/runs")
def eval_runs(collection: str, _: dict = Depends(require_viewer)) -> dict[str, Any]:
    return {"runs": db.list_eval_runs(collection)}


@app.get("/eval/runs/{rid}")
def eval_run_get(rid: str, _: dict = Depends(require_viewer)) -> dict[str, Any]:
    return db.get_eval_run(rid) or {"error": "not found"}


# ── Knowledge graph (GraphRAG) ───────────────────────────────────────
class GraphBuildRequest(BaseModel):
    collection: str = settings.qdrant_collection
    max_chunks: int = 20
    model: str | None = None


@app.post("/graph/build")
async def graph_build(req: GraphBuildRequest, _: dict = Depends(require_editor)) -> dict[str, Any]:
    """Extract entity/relation triples from the collection into a graph."""
    return await graph_mod.build(qdrant, req.collection, req.model, req.max_chunks)


@app.get("/graph")
def graph_get(collection: str, _: dict = Depends(require_viewer)) -> dict[str, Any]:
    """Nodes + edges for the graph visualization."""
    return graph_mod.graph_data(collection)


# ── Analytics + feedback ─────────────────────────────────────────────
class FeedbackRequest(BaseModel):
    collection: str = settings.qdrant_collection
    conversation_id: str = ""
    rating: int  # +1 / -1
    question: str = ""


@app.post("/feedback")
def feedback(req: FeedbackRequest, _: dict = Depends(require_viewer)) -> dict[str, str]:
    db.add_feedback(req.collection, req.conversation_id, req.rating, req.question)
    return {"status": "ok"}


@app.get("/analytics")
def analytics(collection: str, _: dict = Depends(require_viewer)) -> dict[str, Any]:
    """Usage + quality analytics for a workspace, derived from chat history + Qdrant."""
    from collections import Counter

    msgs = db.messages_for_collection(collection)
    users = [m for m in msgs if m["role"] == "user"]
    assts = [m for m in msgs if m["role"] == "assistant"]

    refusals = [m for m in assts if m["meta"].get("out_of_scope")
                or m["content"].startswith("I can't answer that from this workspace")]
    answered = [m for m in assts if m["meta"].get("citations")]
    confs = [max((c.get("score", 0) for c in m["meta"]["citations"]), default=0) for m in answered]
    avg_conf = round(sum(confs) / len(confs), 3) if confs else 0.0
    low_conf = [{"q": "", "score": round(s, 3)} for s in confs if s < 0.3]

    strategy_usage = Counter(u["meta"].get("strategy", "?") for u in users)
    cited = Counter()
    for m in answered:
        for c in m["meta"]["citations"]:
            if c.get("title"):
                cited[c["title"]] += 1

    # distinct source docs in the workspace (unused = never cited)
    sources = set()
    if qdrant.collection_exists(collection):
        points, _ = qdrant.scroll(collection_name=collection, limit=10000, with_payload=True, with_vectors=False)
        sources = {p.payload.get("metadata", {}).get("source") for p in points if p.payload.get("metadata")}
        sources.discard(None)
    unused = sorted(sources - set(cited))

    fb = db.feedback_counts(collection)
    return {
        "conversations": len(db.list_conversations(collection)),
        "questions": len(users),
        "answers": len(assts),
        "refusals": len(refusals),
        "refusal_rate": round(len(refusals) / len(assts), 2) if assts else 0.0,
        "avg_confidence": avg_conf,
        "low_confidence_answers": len(low_conf),
        "strategy_usage": dict(strategy_usage),
        "top_cited": cited.most_common(8),
        "unused_documents": unused,
        "recent_questions": [u["content"] for u in users[-15:]][::-1],
        "feedback": fb,
    }


# ── Document library ─────────────────────────────────────────────────
@app.get("/documents")
def documents(collection: str, _: dict = Depends(require_viewer)) -> dict[str, Any]:
    """List distinct source documents in a workspace (aggregated from Qdrant)."""
    if not qdrant.collection_exists(collection):
        return {"documents": []}
    points, _ = qdrant.scroll(collection_name=collection, limit=10000,
                              with_payload=True, with_vectors=False)
    agg: dict[str, dict[str, Any]] = {}
    for p in points:
        m = p.payload.get("metadata", {}) or {}
        src = m.get("source") or p.payload.get("source", "unknown")
        d = agg.setdefault(src, {"source": src, "type": m.get("type", "text"),
                                 "chunks": 0, "pages": set(), "image_url": None, "ingested_at": None})
        d["chunks"] += 1
        if m.get("page"):
            d["pages"].add(m["page"])
        if m.get("type") in ("image", "pdf_page") and not d["image_url"]:
            d["image_url"] = m.get("image_url")
        if m.get("ingested_at"):
            d["ingested_at"] = max(d["ingested_at"] or "", m["ingested_at"])
    docs = [{**d, "pages": len(d["pages"])} for d in agg.values()]
    docs.sort(key=lambda x: x.get("ingested_at") or "", reverse=True)
    return {"documents": docs}


@app.delete("/documents")
def delete_document(collection: str, source: str, _: dict = Depends(require_editor)) -> dict[str, str]:
    """Delete all chunks of one document from a workspace."""
    if qdrant.collection_exists(collection):
        qdrant.delete(collection_name=collection, points_selector=Filter(
            must=[FieldCondition(key="metadata.source", match=MatchValue(value=source))]))
    return {"status": "deleted", "source": source}


_suggest_cache: dict[str, tuple[int, list[str]]] = {}


@app.get("/suggestions")
async def suggestions(collection: str, _: dict = Depends(require_viewer)) -> dict[str, Any]:
    """Workspace-specific starter questions (LLM-generated from sample chunks, cached).

    Cache is keyed by the workspace's chunk count, so it refreshes when documents change.
    """
    if not await asyncio.to_thread(qdrant.collection_exists, collection):
        return {"suggestions": []}
    total = (await asyncio.to_thread(qdrant.count, collection_name=collection)).count
    if total == 0:
        return {"suggestions": []}
    cached = _suggest_cache.get(collection)
    if cached and cached[0] == total:
        return {"suggestions": cached[1], "cached": True}

    points, _ = await asyncio.to_thread(qdrant.scroll, collection_name=collection, limit=12,
                                        with_payload=True, with_vectors=False)
    sample = "\n\n".join((p.payload.get("content", "") or "")[:400] for p in points)
    if not sample.strip():
        return {"suggestions": []}
    try:
        raw = await complete(
            [{"role": "system", "content": prompts.get("chat_suggestions")},
             {"role": "user", "content": sample}],
            settings.llm_model, max_tokens=300,
        )
        cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
        m = re.search(r"\[.*\]", cleaned, re.DOTALL)
        qs = [str(q).strip() for q in json.loads(m.group(0) if m else cleaned) if str(q).strip()][:4]
    except Exception as e:
        _log.warning("suggestion generation failed for %s: %s", collection, e)
        qs = []
    if qs:
        _suggest_cache[collection] = (total, qs)
    return {"suggestions": qs}


@app.get("/document")
def document_view(collection: str, source: str, _: dict = Depends(require_viewer)) -> dict[str, Any]:
    """Full view payload for one document: image, ordered PDF pages, or extracted text.

    Images keep their original file; PDFs keep per-page renders; plain documents keep
    only parsed text (no original stored) — so text is returned for reading.
    """
    if not qdrant.collection_exists(collection):
        return {"source": source, "type": None, "image_url": None, "pages": [], "text": "", "chunks": 0}
    points, _ = qdrant.scroll(
        collection_name=collection, limit=10000, with_payload=True, with_vectors=False,
        scroll_filter=Filter(must=[FieldCondition(key="metadata.source", match=MatchValue(value=source))]),
    )
    dtype, image_url = "text", None
    pages: dict[int, str] = {}
    texts: list[tuple[int, str]] = []
    for p in points:
        m = p.payload.get("metadata", {}) or {}
        t = m.get("type", "text")
        if t == "image":
            dtype = "image"
            image_url = image_url or m.get("image_url")
        elif t == "pdf_page":
            dtype = "pdf"
            if m.get("image_url"):
                pages[int(m.get("page") or 0)] = m["image_url"]
        idx = m.get("chunk_index")
        texts.append((idx if isinstance(idx, int) else 0, p.payload.get("content", "")))
    texts.sort(key=lambda x: x[0])
    return {
        "source": source,
        "type": dtype,
        "image_url": image_url,
        "pages": [{"page": k, "image_url": v} for k, v in sorted(pages.items())],
        "text": "\n\n".join(t for _, t in texts),
        "chunks": len(points),
    }


# ── Visualization APIs (frontend) ────────────────────────────────────
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/chunks")
def list_chunks(collection: str, limit: int = 100, _: dict = Depends(require_viewer)) -> dict[str, Any]:
    """Chunk Explorer: list chunks + metadata for a collection/document."""
    points, _ = qdrant.scroll(
        collection_name=collection, limit=min(limit, 1000), with_payload=True, with_vectors=False
    )
    return {
        "chunks": [
            {"id": str(p.id), "content": p.payload.get("content", ""),
             "metadata": p.payload.get("metadata", {})}
            for p in points
        ]
    }


@app.get("/embeddings/umap")
async def embeddings_umap(collection: str, limit: int = 500, query: str = "",
                          _: dict = Depends(require_viewer)) -> dict[str, Any]:
    """Embedding Explorer: project chunk vectors to 2D via UMAP.

    Optional `query` is embedded and projected alongside (flagged is_query) so the
    frontend can show where a question lands relative to the corpus.
    """
    import numpy as np

    points, _pt = await asyncio.to_thread(
        qdrant.scroll, collection_name=collection, limit=min(limit, 1000),
        with_payload=True, with_vectors=True,
    )
    # Named-vector collections return dicts and points can lack vectors — keep plain lists only.
    points = [p for p in points if isinstance(p.vector, list)]
    if not points:
        return {"points": []}

    vectors = [p.vector for p in points]
    labels = [
        {
            "id": str(p.id),
            "content": (p.payload.get("content", "") or "")[:160],
            "source": p.payload.get("metadata", {}).get("source", ""),
            "is_query": False,
        }
        for p in points
    ]

    if query:
        vectors = vectors + [await embed_one(query)]
        labels.append({"id": "__query__", "content": query, "source": "", "is_query": True})

    # UMAP fit is CPU-heavy — keep it off the event loop.
    coords = await asyncio.to_thread(_project_2d, np.array(vectors, dtype="float32"))
    return {
        "points": [
            {**lbl, "x": float(c[0]), "y": float(c[1])} for lbl, c in zip(labels, coords)
        ]
    }


def _project_2d(mat) -> Any:
    """UMAP to 2D, with graceful fallback for tiny corpora."""
    import numpy as np

    n = mat.shape[0]
    if n < 4:
        # Too few points for UMAP — use first 2 principal directions (or zeros).
        centered = mat - mat.mean(axis=0, keepdims=True)
        try:
            _, _, vt = np.linalg.svd(centered, full_matrices=False)
            return centered @ vt[:2].T
        except Exception:
            return np.zeros((n, 2), dtype="float32")
    import umap

    reducer = umap.UMAP(
        n_components=2, n_neighbors=min(15, n - 1), min_dist=0.1, metric="cosine"
    )
    return reducer.fit_transform(mat)


Strategy = Literal["semantic", "hybrid", "hyde", "graphrag"]


class PlaygroundRequest(BaseModel):
    collection: str
    query: str
    strategies: list[Strategy] = ["semantic"]
    top_k: int = 5
    rerank: bool = False


@app.post("/playground/compare")
async def playground_compare(req: PlaygroundRequest, _: dict = Depends(require_viewer)) -> dict[str, Any]:
    """Retrieval Playground: run one query through N strategies, return side-by-side."""
    results: dict[str, Any] = {}
    for strat in req.strategies:
        try:
            results[strat] = await run_strategy(
                qdrant, strat, req.query, req.collection, min(req.top_k, 20), req.rerank
            )
        except Exception as e:
            _log.exception("playground strategy %s failed", strat)
            results[strat] = {"error": f"{type(e).__name__}: strategy failed — see server logs"}
    return {"query": req.query, "results": results}
