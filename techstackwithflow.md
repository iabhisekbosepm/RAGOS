# CC-RAGOS — Tech Stack, Rationale & System Flow

Enterprise, self-hosted, explainable **multimodal RAG platform** (NotebookLM-style).
Core principle: **own lightweight orchestration** (FastAPI + Next.js) so every RAG step is inspectable —
the visualization/education layer is the USP. No heavy no-code platform in the loop.

> **History:** an earlier design used **Dify** (dropped — too heavy to self-host, corrupted the Docker VM)
> and planned **ColPali/Neo4j/Dia**. Those were replaced with lighter, host-native equivalents that
> actually run on the target machine (details below). We run our **own chat orchestration** and emit every
> pipeline step, which makes the "Explain the Pipeline" feature trivial.

---

## 1. Technology Stack & Why

### 1.1 Orchestration & Runtime
| Technology | Role | Why |
|---|---|---|
| **Own FastAPI orchestration** | Chat pipeline: guardrail → embed → retrieve → prompt → stream LLM → cite | Full control, every step observable (Learning Mode / playgrounds). No black box. |
| **Host-native (no Docker)** | Local runtime on macOS | colima corrupted its VM disk under the Docling build and filled the Mac. Native binaries + venvs are stable. `docker-compose.yml` retained for Linux/prod. |

### 1.2 Models — via OpenRouter (+ Deepgram for TTS)
| Technology | Role | Why |
|---|---|---|
| **OpenRouter** | Gateway for LLM + vision + embeddings + rerank | One key, many models; swap with zero code change (powers LLM Playground). |
| **DeepSeek / Claude / etc.** | Answer LLM (`LLM_MODEL`) | Config/playground choice, not hard-wired. |
| **Gemini 3 Flash (vision)** | Image captioning + visual-citation bbox | Strong doc/image understanding, cheap. |
| **text-embedding-3-large** | Dense text embeddings (3072-d) | High quality, no GPU ops. Chosen over `gemini-embedding-2` (tested worse for retrieval). |
| **Cohere rerank v3.5** (OpenRouter) | Reranking stage | Cross-encoder precision pass; graceful fallback if unavailable. |
| **Deepgram Aura-2** | Audio Overview TTS | API, no local weights, multi-voice. Replaced **Dia** (~6 GB + GPU, impractical here). |

> **Caveat:** OpenRouter embeddings are dense-only, so **hybrid** search pairs dense with an **in-process
> BM25** (`rank-bm25`) fused via RRF (see §1.3).

### 1.3 Retrieval & Storage
| Technology | Role | Why |
|---|---|---|
| **Qdrant** (native binary) | Vector DB | HNSW index (auto-built past 10k vectors; exact scan below). One source of truth for chat + viz. |
| **rank-bm25** (in-process) | Sparse/lexical signal for **hybrid** | Dense + BM25 fused with Reciprocal Rank Fusion. Move to Qdrant sparse vectors at scale. |
| **HyDE** | Retrieval strategy | LLM drafts a hypothetical answer → embed → search. |
| **History-aware retrieval** | Conversational RAG | Follow-ups condensed to a standalone query using chat history before retrieval (resolves "it"/"that"). |
| **Source subsetting** | Metadata filter | Qdrant payload index on `source`; chat can be scoped to a selected subset of documents. |
| **Contextual retrieval** | Ingest-time recall boost | Doc-level context blurb prepended to each chunk before embedding (Anthropic technique). |
| **Re-ingest dedup** | Versioning | Re-uploading a source deletes its prior chunks first — no duplicates. |
| **networkx** (in-process) | Knowledge graph + **GraphRAG** | LLM triple extraction → graph (JSON per workspace). Replaced **Neo4j** (JVM too heavy locally). |
| **SQLite** (`data/ccragos.db`) | Conversations, messages, study artifacts, workspace meta | Stdlib, no server. Swap → Postgres under multi-replica load. |

### 1.4 Ingestion & Chunking
| Technology | Role | Why |
|---|---|---|
| **Docling** | Parse PDF/DOCX/PPTX/HTML/CSV/XLSX/MD → markdown | Clean text extraction in a host venv. |
| **PyMuPDF** | Render PDF **pages → images** | Per-page text + image → visual citations on PDFs. |
| **Selectable chunkers** | `structure` (default) · `fixed` · `sentence` · `parent_child` · `semantic` | User picks per upload + size/overlap; different precision/context tradeoffs (`chunkers.py`). |
| **MCP client** (`mcp` SDK) | Pull data from a remote **MCP server** at ingest time | List resources → read selected → chunk/embed like any doc (streamable-HTTP, SSE fallback, optional bearer token). Data increasingly arrives via MCP. |
| **FastAPI (ingestion)** | Parse → chunk → embed → Qdrant, **streaming SSE** | Emits a stage event per step → live upload pipeline visualization. |

### 1.5 Multimodal (visual citations)
| Technology | Role | Why |
|---|---|---|
| **Vision LLM captioning** | Image → rich caption → embed for retrieval | Caption-embedding beat direct image embedding in testing. |
| **Query-time bbox** (`/visual-cite`) | Vision LLM returns the region answering the question | Highlights the answer on the source image/PDF page (amber box). Handles Gemini's 0-1000 coord scale. |
| **Attach reference image in chat** | Paste/upload/drop an image in the composer | Vision LLM captions **+ OCRs** it → the description augments the retrieval query (corpus stores images as embedded captions, so query & corpus meet in text space), and the raw image is handed to the vision model at generation so the answer "sees" it. No image → normal text chat, unchanged. Emits a `vision` pipeline step. |
| **ColPali** | *Deferred* — page-as-image late interaction | GPU-host upgrade only; multi-GB weights impractical locally. |

### 1.6 Frontend — the USP layer
| Technology | Role | Why |
|---|---|---|
| **Next.js + React + Tailwind** | 3-panel workspace (Sources · Chat · Studio) + tool pages | The differentiator. API route proxies the SSE chat; keeps keys server-side. Collapsible panels, persisted. |
| **Design system** | Fraunces (display) · Hanken Grotesk (UI) · IBM Plex Mono · warm-ink + amber/teal | Editorial-technical identity, not generic AI slop. |
| **react-force-graph-2d** | Knowledge-graph viz | Force-directed entity/relation graph. |
| **UMAP + SVG scatter** | Embedding Explorer | 2D projection; query point highlighted. |
| **react-markdown / mermaid** | Rendered answers + study diagrams | Markdown answers with citation chips; Mermaid for flowchart/mindmap/UML. |

### 1.7 Guardrails, Quality & Pending
| Technology | Role | Status |
|---|---|---|
| **Relevance gate + injection defense** | Block out-of-scope + prompt injection | **Done** (see §2.4) |
| **Ragas + DeepEval** | Faithfulness / recall / groundedness eval | Pending (R15) |
| **Langfuse** | Tracing / latency / **token cost** | ✅ Done — traces for **chat** (retrieval + generation spans) and **ingestion** (parse/contextualize/embed/index spans); no-op if unset |
| **Self-hosted JWT + RBAC** | Auth / roles | ✅ Done — bcrypt + HS256, users in SQLite; roles **viewer/editor/admin** guarded on **both** retriever & ingestion; role-aware UI; `AUTH_ENABLED` flag (off = open). Replaced **Keycloak** (JVM too heavy). See §1.8. |

### 1.8 Auth & RBAC (self-contained — no external IdP)
| Aspect | Choice | Why |
|---|---|---|
| **Passwords** | `bcrypt` | Standard, salted; rejects > 72 bytes explicitly. |
| **Tokens** | `PyJWT` **HS256**, signed with shared `AUTH_SECRET` | Stateless; retriever owns the user store, **ingestion validates the same JWT statelessly** (trusts the signed role claim). Required claims `exp/sub/iat`. |
| **Roles** | `viewer < editor < admin` | viewer = read + chat; editor = + create/ingest/delete; admin = + workspaces + user management. `require_role` FastAPI deps. |
| **Enforcement** | Both services | Retriever guards mutating/admin routes; **upload (ingestion) requires editor**; `/media` stays public so `<img>` visual citations load. |
| **Per-user data** | `conversations.user_id` | Chat history scoped per user (admins see all; legacy pre-auth chats are ownerless → visible to all). |
| **Toggle** | `AUTH_ENABLED` (default off) | Off → synthetic-admin open mode for local dev; **on → refuses to start with default secret/weak admin password**, login rate-limit + anti-enumeration, last-admin guard. |
| **Frontend** | JWT in `localStorage`, bearer attached to every backend call; role-aware UI + `/login` + admin **Users** page | Pragmatic for a cross-origin local app. Hardening TODO: httpOnly cookie. |
| **Future** | Optional **OIDC/Keycloak** adapter | Standard OIDC → prod SSO is a config swap, not a rewrite. |

---

## 2. How It Works — System Flow

### 2.1 High-level architecture
```
        ┌───────────────────────────────────────────────────────┐
        │   Next.js — Sources · Chat · Studio (Create + Inspect) │
        └──────┬───────────────────────────┬────────────────────┘
               │ /api/chat (SSE proxy)      │ direct (CORS): viz, docs, study, audio, graph
               ▼                            ▼
        ┌───────────────────────────┐   ┌───────────────────────────┐
        │  Retriever (FastAPI)      │   │  Ingestion (FastAPI)      │
        │  /chat (guardrail→…→cite) │   │  /ingest/stream (SSE)     │
        │  /playground /chunks      │   │  Docling · PyMuPDF · vision│
        │  /embeddings/umap /graph  │   │  selectable chunkers      │
        │  /study /audio /documents │   │  /visual-cite  · /media   │
        └───┬─────────────┬─────────┘   └──────────┬────────────────┘
        OpenRouter   Qdrant · networkx · SQLite     │
        · Deepgram        ▲──────────────────────────┘
```

### 2.2 Ingestion flow (streamed, per stage)
```
Upload (1..N files)
   ↓  document              image                 PDF
   Docling parse            save + vision caption  PyMuPDF: page text + page image
   ↓  chunk (chosen strategy: structure/fixed/sentence/parent_child/semantic)
   ↓  embed (OpenRouter)     embed caption          embed page text
   ↓  Qdrant upsert (metadata: source, type, page, image_url, chunk_strategy, ingested_at)
   → live SSE stages render as an animated pipeline in the UI
```

### 2.3 Chat flow (with guardrails)
```
User question (+ optional attached image) → /api/chat → retriever /chat (SSE)
   ├─ step rewrite     → if follow-up, condense with chat history → standalone query (conversational RAG)
   ├─ step vision      → ONLY if image(s) attached: caption + OCR → fold into the retrieval query
   │                     (generation then uses the vision model so the answer sees the image)
   ├─ step guardrail   → dense relevance probe; if < threshold → REFUSE (no LLM call)
   ├─ step embedding   → embed query
   ├─ step retrieval   → strategy: semantic | hybrid(BM25+dense RRF) | HyDE | GraphRAG  (+ optional rerank, + source subset filter)
   ├─ step prompt      → grounded, injection-hardened prompt (sources fenced as untrusted data)
   ├─ step llm         → stream answer tokens
   └─ citations        → retrieved chunks (+ image_url for visual citations)
   → events {conversation|step|token|citations|done|error}; persisted to SQLite
UI: markdown answer · clickable [n] citation chips · source cards · visual-citation bbox · pipeline chips
```

### 2.4 Guardrails (why no irrelevant/injected chat)
```
1. Relevance gate  — dense cosine of query vs corpus < RELEVANCE_THRESHOLD (0.22) → refuse before the LLM.
2. Injection armor — SOURCES + question labelled UNTRUSTED; each source fenced <source>…</source>;
                     model instructed to never obey embedded instructions or reveal its prompt.
3. Scope           — answers only about the workspace's documents; off-topic asks get a polite refusal.
4. Grounding       — answer only from sources or "I can't answer that from this workspace's sources";
                     every claim cited [n].
The guardrail decision is emitted as a pipeline step, so it's visible (on-brand explainability).
```

### 2.5 Visualization / Studio (the differentiator)
```
Inspect: Retrieval Playground (compare strategies) · Chunk Explorer · Embedding Explorer (UMAP) ·
         Knowledge Graph (networkx force graph) · pipeline chips ("Explain the Pipeline")
Create:  Audio Overview (Deepgram) · Flashcards · Quiz · Summary · Cheat Sheet · PRD ·
         Flowchart · Mind Map · UML — saved per workspace, downloadable
Library: every generated artifact for the workspace, one click to reopen it in its tool
UI:      Studio panel is a Create · Inspect · Library segmented switch (one group at a time,
         scroll-free); role-aware — viewers see Create/deletes locked with an "editor role" note
```
> **Nav:** Workspace · Documents · **Analytics** · Learn · Manage, plus signed-in user + role + Sign out
> (and an admin-only **Users** page). Uploading requires the **editor** role; workspace + user management
> require **admin**.

---

## 3. Locked Decisions
| Concern | Choice | Note |
|---|---|---|
| Orchestrator | Own FastAPI `/chat` | Dify dropped |
| Runtime | Host-native (no Docker locally) | native Qdrant binary + venvs + `npm run dev` |
| Models | OpenRouter (+ Deepgram TTS) | LLM + vision + embeddings + rerank |
| Text embeddings | `text-embedding-3-large` (dense) + in-process BM25 for hybrid | tested gemini-embedding-2 → worse |
| Multimodal | Vision-LLM caption + query-time bbox | ColPali deferred (GPU) |
| Graph | **networkx** (in-process JSON) | Neo4j deferred (JVM) |
| Reranker | Cohere v3.5 via OpenRouter | graceful fallback |
| Chunking | user-selectable (5 strategies) + size/overlap | per upload |
| TTS | **Deepgram Aura-2** | Dia dropped (~6 GB + GPU) |
| Store | SQLite | → Postgres at scale |
| Guardrails | relevance gate + injection defense + scope | done |
| Auth / RBAC | **self-hosted JWT (bcrypt + HS256), roles viewer/editor/admin** | done (Keycloak dropped — JVM) |
| Eval / Analytics | LLM-as-judge eval + Langfuse + analytics dashboard | done (Ragas = future swap-in) |

**Prompts** are centralized in [`/prompts`](./prompts) as editable `.txt` templates (loaded via each
service's `app/prompts.py`) — tune wording without touching code; see `prompts/README.md`.

See [`PRD-CC-RAGOS.md`](./PRD-CC-RAGOS.md) for requirements/roadmap, [`docs/SCALING.md`](./docs/SCALING.md)
for scale guidance, and [`README.md`](./README.md) to run it.
