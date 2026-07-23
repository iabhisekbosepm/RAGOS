# CC-RAGOS — Scaling Guide (future reference)

Current setup is tuned for **workshop scale** (tens–hundreds of chunks, one machine, host-native).
This documents what to change as data and users grow. Nothing here is required today.

---

## 1. Vector database (Qdrant)

### Current state
- Collections: `VectorParams(size=3072, distance=Cosine)` — dense single-vector.
- Index: **HNSW** (Qdrant default) — `m=16`, `ef_construct=100`, `full_scan_threshold=10000`.
- `optimizer.indexing_threshold = 10000`.
- `payload_schema = {}` (no payload indexes).

### Why HNSW
HNSW (Hierarchical Navigable Small World) is the industry-standard approximate-nearest-neighbor
index: a navigable graph giving sub-linear search with high recall at high dimensions (our 3072-d
vectors). Same family used by Pinecone/Weaviate/Milvus.

### Why the index shows `indexed_vectors: 0` at small scale (not a bug)
Below `indexing_threshold` (10k vectors) Qdrant serves queries with **exact brute-force (flat) KNN** —
faster and 100% recall for small sets, where an HNSW graph would only add overhead + approximation.
Once a segment crosses the threshold, Qdrant **auto-builds HNSW** in the background. No code change.

### Tuning as you grow
| Concern | Change | When |
|---|---|---|
| Higher recall on large corpora | `hnsw_config.m` → 32–48, `ef_construct` → 200–400 | > ~100k vectors |
| Query-time recall/latency | set `ef` (search) per query (higher = better recall, slower) | tune empirically |
| Memory pressure | `on_disk: true` for vectors + HNSW | large collections |
| Memory cut 4–32× | **quantization** (scalar int8 / binary) + rescoring | > ~1M vectors |
| Build HNSW sooner | lower `indexing_threshold` | rarely needed |
| Faster builds | `max_indexing_threads` > 0 | big ingests |

### Payload (metadata) indexes
A **keyword payload index on `metadata.source`** is now created per collection (for **source subsetting** —
"chat over these documents"). Add more indexes if you filter by other fields (`type`, `page`, `date`,
tenant) at scale — otherwise those filters do a full scan.
```
PUT /collections/<c>/index  { "field_name": "metadata.type", "field_schema": "keyword" }
```

### Hybrid search at scale (sparse in Qdrant)
Today "hybrid" = dense (Qdrant) + **BM25 computed in-process** (`rank-bm25`) fused with RRF. That loads
all chunks into memory per query — fine at workshop scale, O(N) at large scale. To scale:
- Store **named sparse vectors** in Qdrant (BM25/SPLADE) alongside dense, and use Qdrant's native
  hybrid query (prefetch dense + sparse → fusion). Then hybrid is index-accelerated, not in-process.
- Generate sparse vectors at ingest (e.g. SPLADE, or Qdrant/FastEmbed BM25).

### Multimodal / ColPali (future)
Direct image embeddings (tested `gemini-embedding-2`) retrieved worse than caption-embedding; ColPali
(page-as-image late interaction) needs a GPU host + multi-vector storage (~1k vectors/page → big index).
Revisit on a GPU host with Qdrant **multi-vector** collections + quantization if visual retrieval quality
becomes the bottleneck.

---

## 2. Embeddings & models
- Embeddings via OpenRouter (`text-embedding-3-large`, 3072-d) — batch at ingest; cache by content hash
  to avoid re-embedding unchanged chunks.
- For zero-egress / cost at scale, self-host **BGE-M3** (dense+sparse in one model) behind the same API.
- LLM answers via OpenRouter (DeepSeek default) — add per-workspace rate limits + budget caps.

---

## 3. Services & deployment
- **Now:** host-native (native Qdrant binary, Python venvs, web via `next build` + `next start`) through
  `scripts/start-host.sh`.
- **Production:** re-introduce containerization (Dockerfiles were removed in cleanup) → **Kubernetes + Helm**:
  - Stateless, horizontally scale `retriever` + `ingestion` (bump uvicorn workers / replicas).
  - Externalize **Qdrant** (managed/clustered) and swap SQLite → **Postgres** for `data/ccragos.db`
    (conversations, messages, study/audio artifacts, workspaces) under real concurrency.
  - **Knowledge graph:** local uses an **in-process networkx** graph persisted to JSON per workspace
    (`graph-storage/`); at scale move to **Neo4j** (multi-hop, concurrent, large graphs).
  - **TTS/media:** Audio Overview uses **Deepgram Aura-2** (API). Put `media/` (images, PDF page renders,
    generated MP3s) on object storage (S3/GCS) + CDN instead of local disk.
- **Ingestion throughput:** move heavy parse/embed to a **task queue** (Celery/RQ/Arq) with workers;
  the streaming endpoint reports progress per stage.

---

## 4. Data & retrieval quality
- **Chunking:** user-selectable per upload — `structure` (default), `fixed`, `sentence`,
  `parent_child` (small child embedded, larger parent returned), `semantic` (embeds sentences, splits
  where meaning shifts) — plus configurable size/overlap (`services/ingestion/app/chunkers.py`). At scale,
  A/B strategies against the eval golden set and tune per-doc size.
- **Reranking:** Cohere via OpenRouter now; self-host `bge-reranker-v2-m3` for volume/latency/egress.
- **Conversational RAG:** ✅ follow-ups are condensed to a standalone query using chat history before
  retrieval (extra LLM call per follow-up — cache/skip when the query is already standalone at scale).
- **Source subsetting:** ✅ chat can be scoped to selected documents via the `metadata.source` payload index.
- **Contextual retrieval (Anthropic):** ✅ a doc-level context blurb is prepended to each chunk before
  embedding (toggle). Cost = 1 LLM summary per document at ingest; for large docs, summarize per-section.
- **Re-ingest dedup:** ✅ re-uploading a source deletes its prior chunks first (no duplicates). At scale,
  key by content-hash to skip unchanged chunks and avoid re-embedding.
- **Multimodal:** visual citations use vision-LLM captioning + query-time bbox (no ColPali). For heavy
  visual corpora on a GPU host, revisit ColPali/ColQwen with Qdrant multi-vector + quantization.
- **Attach-image-in-chat:** ✅ when a user attaches image(s), a vision call captions+OCRs them (retrieval
  stays text-space via the caption) and generation switches to the vision model. Cost = **one extra vision
  call per image message** (capped at 3 images). At scale: cache captions by image content-hash, and cap
  image size/count per request to bound cost + latency.
- **Document list:** `/documents` aggregates distinct sources by scrolling all points (O(N), fine for
  workshop scale). At scale, maintain a `documents` table (Postgres) written at ingest instead of scanning.
- **Eval (R15):** ✅ built — golden set (auto-generated or manual) + **LLM-as-judge** metrics
  (faithfulness / answer-relevance / context-relevance) + latency + citation-rate, thresholds, persisted
  runs (`evaluate.py`, `/eval`). **Langfuse tracing is wired** (per-chat trace with retrieval + generation
  spans and token cost — `obs.py`, keys in `.env`). At scale: swap the judge for **Ragas/DeepEval** for
  standardized metrics, run eval in CI on a fixed golden set to catch regressions, and use Langfuse
  dashboards for latency/cost/drift. Re-run per strategy (semantic/hybrid/HyDE/GraphRAG ± rerank) to compare.
- **Analytics (R16):** ✅ built — refusal rate, avg citation confidence, most-cited + **unused documents**,
  strategy mix, recent questions, 👍/👎 feedback (`/analytics`, `/feedback`). At scale, pipe feedback into
  Langfuse **scores** and drive re-chunk/re-embed of weak/unused docs from these signals.

---

## 5. SQLite → Postgres note
`services/retriever/app/db.py` uses one SQLite connection + a lock — fine for one machine / low
concurrency. Under multiple retriever replicas, switch to Postgres (same schema) so writes aren't
serialized to a single file. Tables: `workspaces`, `conversations` (**+ `user_id` for per-user history**),
`messages`, `study_artifacts`, `eval_items`, `eval_runs`, `feedback`, **`users`** (bcrypt hash + role).
Only the retriever owns the user store; the ingestion service is stateless (it just validates the JWT).

---

## 6. Auth & RBAC (implemented) + hardening at scale — see PRD R23 / §1.8 of techstack
**Now (self-contained, no external IdP / no JVM):** bcrypt passwords + HS256 JWT signed with a shared
`AUTH_SECRET`; roles **viewer/editor/admin** enforced on **both** retriever and ingestion; upload=editor,
workspace + user management=admin; per-user chat history; `AUTH_ENABLED` flag (off=open for local).
Startup refuses insecure defaults when enabled; login has an in-memory rate-limit + anti-enumeration;
last-admin guard. (Replaced Keycloak — JVM too heavy for host-native.)

**What to change as users/replicas grow:**
- **Stateless JWT scales horizontally** — any replica validates a token with `AUTH_SECRET` (no shared
  session store). **Set the same `AUTH_SECRET` on every retriever + ingestion replica.**
- **Login rate-limit is per-process in-memory** (`_login_fails` dict) — move to **Redis** so the limit is
  shared across replicas (else N replicas = N× the attempts).
- **Users table → Postgres** with the rest of the schema (§5).
- **Tokens in `localStorage` → httpOnly, Secure, SameSite cookies** issued via a Next.js route (removes the
  XSS-token-theft path). Requires same-origin proxying of the retriever/ingestion calls (they're cross-origin
  today), or a gateway.
- **Per-conversation IDOR:** conversations are now owner-scoped, but legacy pre-auth chats are ownerless
  (visible to all) — backfill `user_id` or hide ownerless from non-admins if strict isolation is needed.
- **Optional enterprise SSO:** add an **OIDC/Keycloak** adapter — because tokens are standard JWT, this is a
  config/adapter swap, not a rewrite. Then layer audit logging + secrets manager (not `.env`).

---

## 7. Guardrails (implemented) & tuning
Chat guardrails live in `services/retriever` (`chat.py` + `/chat`):
- **Out-of-scope gate** — dense-cosine relevance of query vs corpus < `RELEVANCE_THRESHOLD` (default 0.22)
  → refuse before the LLM. The threshold is **corpus- and embedding-model-dependent**: tune per deployment
  (raise for stricter scope; lower if valid questions get refused). Re-tune if you change the embedding model.
- **Prompt-injection defense** — SOURCES + question treated as untrusted, each source fenced; the model is
  instructed never to obey embedded instructions or reveal its prompt.
- **Scope + grounding** — answers only from workspace sources, else a refusal; every claim cited.
- At scale: consider a small **classifier/LLM-judge** relevance gate (more robust than a single cosine
  threshold across heterogeneous corpora), per-workspace thresholds, and logging refusals into Analytics (R16)
  to spot coverage gaps. Study/Audio generation currently trusts workspace content (lower risk) — add the
  same gate if untrusted external content is ever ingested for those flows.

---

## 8. Caching (not implemented — add at scale)

**Current state:** no caching anywhere in the RAG chat path. Every message runs the full pipeline live
(condense → relevance gate → embed → retrieve → rerank → LLM stream). This is **intentional at workshop
scale**: volume is low, correctness is unaffected, and — critically — this is an **explainable/teaching**
tool, so showing the real pipeline every time is a feature, not a cost. A cached answer can't stream or
show the live rewrite→retrieve→rerank→generate steps.

Caching is a **cost + latency optimization for high-volume, repetitive traffic** (e.g. a support bot). It
adds no capability. Add it only when query volume and repetition justify the extra complexity + a cache
store (Redis).

### Cache layers (ordered by value ÷ risk)

| Layer | What it does | Win | Risk / cost | Add when |
|---|---|---|---|---|
| **Query-embedding cache** | Cache `text → vector` (exact key). Skips the per-message embed (+ relevance-gate probe) on repeats. | Small, immediate. | **None** — text→vector is deterministic. No staleness. | First — safe & trivial. |
| **Ingest embedding cache** | Hash each chunk; skip re-embedding unchanged chunks on re-ingest. | Cuts re-ingest cost. | Low — keyed by content hash. Pairs with the existing re-ingest dedup (§4). | Frequent re-ingests / large corpora. |
| **Retrieval cache** | Cache retrieved chunk IDs per (query, workspace, strategy). | Skips vector search on repeats. | **Staleness** — must invalidate on ingest/delete for that workspace. | Repeated queries + stable corpus. |
| **Semantic answer cache** | If a new query is ≈ a past one (cosine > threshold), return the stored answer — skips retrieval **and** LLM entirely. | **Biggest** cost/latency win. | Highest: (a) **staleness** — invalidate per-workspace on ingest/delete; (b) **false hits** — a near-but-different question returns the wrong cached answer (threshold tuning); (c) no streaming / no live pipeline. | High repetitive volume (FAQ/support). |
| **Provider prompt caching** | Anthropic/OpenRouter cache the static prompt prefix. | Cheaper input tokens on shared prefixes. | None — provider-side, partly automatic. | Passthrough; nothing to build. |

### Implementation notes (when the time comes)
- **Store:** Redis (TTL + LRU eviction). Key embeddings by `sha256(text)`; key answers by the query
  embedding (semantic) or `sha256(normalized_query + workspace + strategy)` (exact).
- **Invalidation is the hard part.** Any ingest/delete/re-ingest into a workspace must **purge that
  workspace's retrieval + answer cache entries** — otherwise you serve answers from documents that changed.
  Namespace cache keys by `collection`/workspace so a workspace flush is one operation.
- **Preserve the teaching mode.** Add a **"bypass cache"** toggle (default on for the Studio/playground /
  Learning-Mode views) so the live pipeline is always demonstrable; serve from cache only on the plain
  chat path when explicitly enabled.
- **Semantic-cache threshold** is corpus- and embedding-model-dependent (like the relevance gate, §7) —
  tune empirically; too loose = wrong-answer false hits, too tight = no cache benefit.
- **Observability:** emit cache hit/miss to Langfuse so hit-rate and staleness incidents are visible; a
  low hit-rate means the cache isn't paying for its complexity.

### Recommended order
1. **Query-embedding cache** (safe, no staleness) — do this first.
2. **Ingest embedding cache by content-hash** — pairs with existing dedup.
3. **Semantic answer cache with per-workspace invalidation + bypass toggle** — only if traffic is genuinely
   repetitive; this is the one that needs the most care.
