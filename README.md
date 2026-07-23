# CC-RAGOS

Enterprise, self-hosted, explainable **multimodal RAG platform** (NotebookLM-style) — by **Abhisek Bose**.
**Own lightweight FastAPI orchestration** (no Dify) + a Next.js visualization layer = the USP.

- **PRD:** [`PRD-CC-RAGOS.md`](./PRD-CC-RAGOS.md)
- **Tech stack & flow:** [`techstackwithflow.md`](./techstackwithflow.md)
- **Scaling:** [`docs/SCALING.md`](./docs/SCALING.md) · **Eval:** [`docs/EVAL-IMPROVEMENTS.md`](./docs/EVAL-IMPROVEMENTS.md) · **Prompts:** [`prompts/README.md`](./prompts/README.md)

## Architecture

```
web (Next.js) ──► /api/chat  ──► retriever /chat (SSE) → steps + answer tokens + citations
      └─────────► retriever viz/tool APIs (chunks, embeddings/UMAP, playground, graph, study, audio, eval, analytics)
retriever (FastAPI)  condense(history) → guardrail gate → embed → retrieve (± rerank, ± source subset) → grounded prompt → stream LLM → citations
ingestion (FastAPI)  Docling / vision / PyMuPDF → chunk → contextualize → embed (OpenRouter) → Qdrant  (also MCP pull)
stores: Qdrant (vectors) · networkx (graph, per workspace) · SQLite (chats, study, eval, feedback)
```

Chat orchestration is ours (`services/retriever/app/chat.py` + `/chat`): every pipeline step is emitted
over SSE for the "Explain the Pipeline" USP. Prompts live in [`/prompts`](./prompts) as editable `.txt`
templates (loaded via each service's `app/prompts.py`).

## Stack decisions (locked)

| Concern | Choice |
|---|---|
| Orchestrator | **Own FastAPI** chat orchestration (Dify dropped — too heavy to self-host here) |
| Models | **OpenRouter** (LLM / vision / embeddings / rerank) |
| Embeddings | `text-embedding-3-large` (dense, 3072-d) + in-process **BM25** (`rank-bm25`) fused via RRF for hybrid |
| Retrieval | semantic · hybrid · HyDE · GraphRAG, ± Cohere rerank, ± source subset; history-aware + contextual retrieval |
| Multimodal | **vision-LLM caption + query-time bbox** (visual citations); ColPali deferred (GPU) |
| Vector DB | **Qdrant** (native binary, HNSW) |
| Graph | **networkx** in-process (per-workspace JSON); Neo4j deferred (JVM) |
| TTS | **Deepgram Aura-2** (Audio Overview); Dia dropped (~6 GB + GPU) |
| Store | **SQLite** (`data/ccragos.db`) → Postgres at scale |
| Guardrails | relevance gate + prompt-injection defense + scope + grounding |
| Observability | **Langfuse** (chat + ingestion traces, token cost); no-op if unset |
| SSO / RBAC | **Keycloak** — pending (P6) |

## Run (host-native — no Docker)

```bash
cp .env.example .env       # fill OPENROUTER_API_KEY (+ DEEPGRAM / LANGFUSE optional)
scripts/start-host.sh      # qdrant (native binary) + ingestion + retriever + web
```

Open http://localhost:3000. Stop:
```bash
pkill -f 'uvicorn app.main'; pkill -f 'bin/qdrant'; pkill -f 'next start'
```

- **Qdrant**: native binary `bin/qdrant`, data in `qdrant-storage/`.
- **Ingestion + Retriever**: share `.venv-ingestion` (python3.12); each has a `run-host.sh`.
- **Web**: `web/` via `npm run dev` (dev) or `next build`/`next start` (prod); host URLs in `web/.env.local`.

> `colima`/Docker was abandoned locally (the Docling/torch build corrupted its VM disk). The Docker
> files were removed in cleanup — re-add containerization when deploying to a Linux/prod host.
> `start-host.sh` runs the web in **production** (`next build` + `next start`) for fast loads.

## Verify

```bash
curl localhost:8100/health   # retriever → {"status":"ok"}
curl localhost:8101/health   # ingestion → {"status":"ok"}

# ingest a doc (streamed per-stage SSE)
curl -N -F "file=@sample.pdf" -F "collection=ccragos_chunks" localhost:8101/ingest/stream

# chat (own orchestration, SSE stream)
curl -N -X POST localhost:8100/chat -H "Content-Type: application/json" \
  -d '{"query":"...", "collection":"ccragos_chunks", "top_k":5}'
```

## Layout

```
services/retriever/    FastAPI: /chat (orchestration) + viz/tool APIs (chunks, embeddings/umap,
                       playground, graph, study, audio, eval, analytics, feedback)
services/ingestion/    FastAPI: /ingest/stream (Docling/vision/PyMuPDF → chunk → embed → Qdrant) + MCP pull
web/                   Next.js: 3-panel workspace (Sources · Chat · Studio) + tool pages + /learn tour
prompts/               editable .txt prompt templates (shared by both services)
scripts/start-host.sh  launch everything host-native
bin/qdrant             native Qdrant binary
data/ · qdrant-storage/ · graph-storage/ · media/   local state (gitignored)
```

## Scaling → see [`docs/SCALING.md`](./docs/SCALING.md) (Qdrant HNSW/indexing, sparse hybrid, quantization, caching, K8s, Postgres).

## Roadmap → see PRD §11 (Phases P0–P6). Only **SSO/RBAC (P6)** remains.
