# PRD — CC-RAGOS

*Enterprise Multimodal NotebookLM-style RAG Platform — custom FastAPI orchestration + Next.js viz*

---

# PART A — CORE PRD

## 1. Document Metadata

| Field | Value |
|---|---|
| **Product / Feature name** | CC-RAGOS (KnowledgeOS) |
| **Author / Owner** | abhisek.bose@codeclouds.com |
| **Stakeholders** | Eng lead, ML/RAG engineer, Frontend, DevOps/Platform, Design, PM, Security/Compliance |
| **Status** | Draft |
| **Version** | v0.2 |
| **Last updated** | 2026-07-22 |
| **Related links** | `README.md`; `techstackwithflow.md`; OpenRouter docs; Qdrant docs |

---

## 2. TL;DR

CC-RAGOS is an enterprise, self-hosted platform where teams upload any knowledge source (PDF, Office,
images, diagrams, code, audio, web, YouTube) into a workspace and chat with it using multiple RAG
strategies. Unlike NotebookLM, it **exposes the RAG internals** — chunks, embeddings, retrieval steps,
citations, and knowledge graph — and lets users **compare retrieval/LLM/prompt strategies side by side**,
making it both a production knowledge assistant and a teaching platform. It is built on a **custom
lightweight FastAPI orchestration** (embed → retrieve → grounded prompt → stream LLM → citations, with
model routing via OpenRouter) and a **Next.js visualization layer** for the USP — fully self-hostable,
no heavy no-code platform in the loop.

---

## 3. Problem & Why Now

- **What is the problem?** Enterprise knowledge is scattered across PDFs, decks, spreadsheets, diagrams,
  screenshots, code, and recordings. Existing tools (NotebookLM, generic RAG chatbots) are black boxes —
  users can't see *why* an answer was produced, can't trust citations for images/diagrams, and teams can't
  learn or tune the retrieval pipeline. Data also can't leave the premises for regulated clients.
- **Who has it?** Internal teams (Engineering, Product, Sales, HR) and, longer term, clients needing a
  private knowledge assistant. Also trainees/engineers learning modern RAG.
- **Why now?** RAG tooling matured in 2026 — OpenRouter serves LLM + vision + embeddings through one
  gateway, and a lightweight custom orchestration over Qdrant is fast, cheap, and fully self-hostable —
  no dependency on a heavy platform.
- **What happens if we do nothing?** Continued reliance on SaaS black boxes (data egress, no multimodal
  citations, no explainability, no on-prem option) and no reusable internal RAG platform.
- **Evidence** Direct company need for enterprise knowledge tooling; NotebookLM's inability to do visual
  citations, retrieval transparency, GraphRAG, or self-hosting; regulated-client data-residency demand.

---

## 4. Goals & Success Metrics (Hypothesis)

> **Hypothesis:** We believe that building an explainable, multimodal, self-hosted RAG platform for
> enterprise teams will result in trusted, faster knowledge retrieval and internal RAG capability, measured
> by answer faithfulness, adoption, and citation-trust — right if we hit the targets below within 2 quarters
> of GA.

| Goal | Metric | Baseline | Target | How measured |
|---|---|---|---|---|
| Trustworthy answers | Faithfulness / groundedness | n/a | ≥ 0.85 | Ragas/DeepEval on golden set |
| Retrieval quality | Recall@5 on golden set | n/a | ≥ 0.80 | Eval pipeline |
| Adoption | Weekly active users | 0 | ≥ 60% of pilot team | Analytics |
| Responsiveness | Chat first-token latency | n/a | < 2s p50 | Langfuse traces |
| Citation trust | % answers with correct clickable citation | n/a | ≥ 90% | QA sampling |
| Cost control | Avg cost / answered query | n/a | within budget | OpenRouter usage |

- **How will we know if we were wrong?** Faithfulness < 0.7, low adoption, or users ignoring citations.
- **Guardrail metrics:** hallucination rate must not exceed baseline; no cross-workspace data leakage;
  latency p95 must not exceed 6s.

---

## 5. Non-Goals / Out of Scope

- Not cloning NotebookLM feature-for-feature.
- Not depending on a heavy no-code platform — own the orchestration (lightweight FastAPI).
- Not building a public multi-tenant SaaS in v1 (enterprise self-hosted first).
- Not fine-tuning custom foundation models (prompting + RAG + off-the-shelf models only).
- Not a general chat assistant without grounded sources.
- Deferred: mobile app, marketplace of community workflows, real-time collaborative editing.

---

## 6. Users & Key Scenarios

| Persona | Who they are | Job-to-be-done | Key pain |
|---|---|---|---|
| Knowledge worker | PM/Sales/HR/Eng | Ask questions across many docs, get cited answers | Info scattered; can't trust answers |
| RAG engineer / trainee | Learning/tuning RAG | Inspect & compare retrieval/LLM/prompt strategies | Existing tools hide internals |
| Workspace admin | Team lead / IT | Manage sources, permissions, models, eval | No control/observability in SaaS |
| Compliance owner | Security/Legal | Keep data on-prem, auditable | SaaS data egress |

**Key scenarios**
1. As a knowledge worker, I upload a PRD + diagram and ask "explain this checkout flow," getting a cited
   answer with the diagram region highlighted.
2. As a RAG trainee, I run the same query through Semantic / Hybrid / HyDE / GraphRAG and compare results.
3. As an engineer, I open the Chunk Explorer and Embedding Explorer to see how a document was indexed.
4. As an admin, I upload a workspace's sources, pick models via OpenRouter, and view eval + analytics.
5. As a user, I generate flashcards, a quiz, and a 2-speaker audio overview from selected sources.

---

## 7. Requirements

*P0 = launch blocker, P1 = important, P2 = nice-to-have.*

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| R1 | Workspaces with permissions, sources, settings | P0 | ✅ Create workspace; **self-hosted JWT auth + RBAC** (viewer/editor/admin) isolates actions; per-user chat history |
| R2 | Document library: upload PDF/docx/pptx/md/html/csv/xlsx/images **+ pull from an MCP endpoint** | P0 | Files/MCP resources ingest into KB; visible in library |
| R3 | Cited chat via own FastAPI orchestration (streaming SSE) | P0 | Streamed answer + citation cards (source, score) + visible pipeline steps |
| R4 | Hybrid retrieval (dense+sparse) + reranking | P0 | Configurable per workspace; measurable recall gain |
| R5 | OpenRouter model routing (LLM + vision + embeddings) | P0 | Models selectable; chat works end-to-end |
| R6 | Chunk Explorer | P1 | View chunk text/metadata/tokens/similarity per doc |
| R7 | Embedding Explorer (UMAP scatter + NN highlight) | P1 | Interactive projection; query highlights neighbors |
| R8 | Retrieval Playground (Semantic/Hybrid/HyDE/GraphRAG side-by-side) | P1 | Same query, 4 strategies compared |
| R9 | LLM & Prompt Playgrounds | P1 | Swap model/prompt; compare latency/cost/quality/citations |
| R10 | Learning Mode ("Explain the Pipeline") | P1 | Step trace from own `/chat` SSE step events (embedding→retrieval→prompt→llm) |
| R11 | Multimodal RAG + visual (bbox) citations **+ attach reference image in chat** | P1 | Image/diagram question highlights source region; user can paste/upload an image → vision caption+OCR augments the retrieval query and the vision LLM sees the image |
| R12 | Knowledge Graph + GraphRAG | P2 | Graph viz; "what depends on X" answered from graph |
| R13 | Study tools (flashcards/quiz/MCQ/PRD/UML/Mermaid/mind maps) | P2 | Generated from selected sources |
| R14 | Audio Overview (multi-speaker podcast via TTS) | P2 | 2-voice podcast generated + playable |
| R15 | Eval dashboard + observability | P1 | ✅ **Eval + observability done** — LLM-as-judge eval (faithfulness/answer-rel/context-rel, thresholds, persisted runs) **+ Langfuse tracing** (per-chat trace: retrieval + generation spans, token cost). Ragas/DeepEval = future swap-in |
| R16 | Analytics + feedback loop | P2 | ✅ Dashboard: questions/conversations, refusal (out-of-scope) rate, avg citation confidence, most-cited + **unused documents**, strategy mix, recent questions, 👍/👎 feedback from chat |
| R17 | Guardrails: out-of-scope gate + prompt-injection defense + scope | P0 | Off-topic/injection refused; prompt not leaked; decision shown as pipeline step |
| R18 | Selectable chunking (structure/fixed/sentence/parent-child/semantic) + size/overlap | P1 | User picks per upload; strategy stored in chunk metadata |
| R19 | Conversational RAG (history-aware retrieval) | P1 | Follow-ups condensed to a standalone query using chat history before retrieval; "rewrite" pipeline step |
| R20 | Metadata filtering + source subsetting | P1 | Qdrant payload index on source; per-source include toggles → chat scoped to selected docs |
| R21 | Re-ingest dedup / versioning | P1 | Re-uploading a source deletes its prior chunks (no duplicates); applies to files + MCP |
| R22 | Contextual retrieval (Anthropic) | P2 | Doc-level context prepended to each chunk before embedding (toggle); stored in chunk metadata |
| R23 | Auth + RBAC (self-hosted JWT) | P0 | ✅ Login + roles **viewer/editor/admin**; bcrypt passwords, HS256 JWT; guards on both retriever + ingestion; upload=editor, create/delete workspace + user-mgmt=admin; role-aware UI; `AUTH_ENABLED` flag (off = open) |

**Build status:** R1–R23 **✅ done** (R15 eval = LLM-as-judge + Langfuse tracing wired; Ragas = future
swap-in). R9 = in-chat model/prompt selectors (dedicated compare grid pending). **Auth/RBAC now shipped**
as a self-contained JWT layer (Keycloak dropped — too heavy/JVM). Remaining hardening: httpOnly-cookie
tokens (currently localStorage) and HA/Helm for prod.

**Non-functional (critical):**
- **Performance:** chat first-token < 2s p50; retrieval < 500ms p50.
- **Security/privacy:** self-hosted; no data egress beyond configured model provider; per-workspace RBAC;
  secrets in env vars; audit logging.
- **Accessibility:** WCAG 2.1 AA for the web app.

---

## 8. Solution & UX

- **Proposed solution — own lightweight stack:**
  - **Retriever/orchestrator (FastAPI)** = the brain: `/chat` runs embed → Qdrant retrieve →
    grounded prompt (styles) → stream LLM (OpenRouter) → citations, emitting each pipeline step; plus
    read-only **viz APIs** (chunks, embeddings/UMAP, playground compare) and retrieval strategies
    (semantic now; hybrid/HyDE/GraphRAG later).
  - **Ingestion (FastAPI)** = Docling parse → structure-aware chunk → embed → Qdrant (bbox +
    ColPali multimodal later).
  - **Next.js frontend** = the USP: streaming cited chat, chunk/embedding explorers, retrieval/LLM/prompt
    playgrounds, "Explain the Pipeline", plus (later) visual citations, graph viz, study tools, audio.
  - Stores: **Qdrant** (vectors, hybrid + multi-vector). **Neo4j** (graph) added in Phase 4.
- **User flows:**
  1. Create workspace → upload sources → sources indexed → chat with citations.
  2. Open a source → Chunk/Embedding Explorer → Retrieval/LLM/Prompt Playground compare.
  3. Ask multimodal question → answer + highlighted image/page region.
  4. Select sources → generate study tools / audio overview.
- **Designs:** TBD (Figma) — NotebookLM-familiar chat + inspectable side panels.
- **Key states:** empty (no sources), loading (ingesting/streaming), error (retrieval/model failure with
  fallback), success (cited answer), edge (no matches → "no grounded answer" not hallucinate).

---

## 9. Risks, Dependencies & Assumptions

| Type | Item | Impact | Mitigation / Owner |
|---|---|---|---|
| Risk | Own orchestration = we build features Dify would have given | Med | Kept it lightweight; only build what the USP needs |
| Risk | Scope (all 4 pillars = MVP) too large | High | Phase 0–6; ship core RAG first (Eng lead) |
| Risk | Multimodal storage cost (ColPali ~1k vec/page) | Med | Option: Cohere embed-v4 single-vector; evaluate in Phase 3 |
| Risk | Hallucination / wrong citations | High | Grounded prompts, rerank, eval gates, "no grounded answer" fallback |
| Dependency | OpenRouter availability + cost | High | Budget alerts; self-host BGE-M3/reranker fallback |
| Dependency | Self-host infra (native local; Docker→Helm for prod; GPU for ColPali) | Med | DevOps provisioning |
| Assumption | OpenRouter serves needed embedding models | Med | Verified July 2026; else self-host BGE-M3 |
| Assumption | Local machine disk headroom (native runtime) | Med | Host-native after Docker VM filled the disk |

---

## 10. Open Questions

| # | Question | Owner | Status / Answer |
|---|---|---|---|
| 1 | Embeddings provider for v1? | ML eng | **Resolved — OpenRouter embeddings** (`text-embedding-3-large`). Sparse via BM25/SPLADE for hybrid. |
| 2 | Multimodal embedding approach? | ML eng | **Resolved — ColPali** (page-as-image late interaction, self-host; accept storage cost) |
| 3 | Orchestration platform? | Platform | **Resolved — own FastAPI orchestration** (Dify dropped: too heavy to self-host; corrupted the Docker VM). Auth/RBAC built into the services (below). |
| 4 | TTS for audio overview? | Eng | **Resolved — Deepgram Aura-2** (API, multi-voice; Dia dropped — ~6 GB + GPU) |
| 5 | SSO IdP? | IT/Security | **Resolved — self-contained JWT + RBAC** (bcrypt + HS256, users in SQLite; no external IdP). **Keycloak dropped** — JVM too heavy for the host-native target. OIDC/Keycloak remains an optional future adapter for enterprise SSO. |
| 6 | Data retention & audit-log requirements for clients? | Compliance | Open |

---

## 11. Release Plan & Milestones

| Phase | Scope | Owner | Status |
|---|---|---|---|
| P0 Foundation | Host-native stack (Qdrant, ingestion, retriever, web), OpenRouter wired | Platform | **✅ Done** |
| P1 Core RAG chat | Ingest→Qdrant, selectable chunking, own `/chat` cited streaming, **hybrid + rerank** | Eng | **✅ Done** |
| P2 Viz/education layer | Chunk/Embedding explorers, Retrieval Playground (semantic/hybrid/HyDE/GraphRAG), pipeline steps | Frontend+ML | **✅ Done** (LLM/Prompt playground = in-chat selectors) |
| P3 Multimodal | Image + **PDF-page** visual citations (vision caption + query-time bbox) | ML | **✅ Done** (ColPali deferred → GPU host) |
| P4 Knowledge Graph | Triple extraction → **networkx** graph, GraphRAG retriever, force-graph viz | ML | **✅ Done** (Neo4j deferred → JVM) |
| P5 Study + Audio | Study tools (flashcards/quiz/summary/cheatsheet/PRD/flowchart/mindmap/UML) + Audio Overview (**Deepgram**) | Eng | **✅ Done** (Dia dropped) |
| P6 Guardrails + hardening | **Relevance gate + injection defense + scope** ✅; Eval ✅; Analytics ✅; **Auth + RBAC** ✅ (self-hosted JWT); Helm HA pending | Platform | **🟢 Guardrails + eval + analytics + auth done; HA/Helm + httpOnly-cookie hardening pending** |

Also shipped: workspaces (multi-collection), document library + delete, chat history (SQLite, **per-user**),
multi-file streaming upload with live pipeline, NotebookLM-style 3-panel UI (collapsible Sources/Studio),
**Studio Library** (browse everything generated in a workspace), **Analytics in the nav**, **attach a
reference image in chat** (vision-augmented retrieval), **role-aware UI** (viewer/editor/admin).

- **Rollout:** internal pilot (one workspace) → internal GA → regulated-client deployments.
- **Launch gates:** cited chat works E2E ✅; guardrails block out-of-scope/injection ✅;
  eval harness live ✅ (faithfulness ≥ 0.85 target measured per run); **RBAC isolation ✅** (JWT roles on
  both services, per-user chat history).

---

# PART B — EXTENDED SECTIONS

## B1. Detailed Non-Functional Requirements
- **Performance & scale:** first-token < 2s p50 / < 6s p95; retrieval < 500ms p50; support concurrent
  workspace users; horizontal scale of the FastAPI retriever/ingestion services.
- **Security:** ✅ self-hosted JWT auth (bcrypt + HS256) with **RBAC (viewer/editor/admin)** on both the
  retriever and ingestion services; startup refuses insecure defaults when enabled; login rate-limit +
  anti-enumeration; last-admin guard; secrets in env; parameterized queries; input validation at
  boundaries; prompt-injection guardrails. Optional OIDC/Keycloak SSO adapter is a future add.
- **Privacy & compliance:** self-hosted, data residency, configurable retention, audit logging; only egress
  is to the configured model provider (OpenRouter) — offer self-hosted models for zero-egress mode.
- **Reliability:** HA via Helm; externalize Postgres/Redis/vector store; backups; graceful model fallback.
- **Accessibility:** WCAG 2.1 AA; keyboard nav; screen-reader labels on viz where feasible.
- **i18n:** BGE-M3 multilingual embeddings; UI i18n-ready (later).

## B2. Technical Design & Architecture
- **Overview:** Next.js → `/api/chat` proxy → retriever `/chat` (SSE) for chat; Next.js → retriever viz
  APIs directly (CORS) for internals. Retriever → OpenRouter (embeddings + LLM) + Qdrant. Ingestion
  (FastAPI) → Docling → Qdrant (Neo4j in Phase 4).
- **APIs / contracts:**
  - Retriever `POST /chat` (streaming SSE): events `{type: step|token|citations|done|error}` — `step`
    covers embedding→retrieval→prompt→llm; `citations` carries `[{content, score, title, metadata}]`.
  - Retriever viz: `GET /chunks`, `GET /embeddings/umap`, `POST /playground/compare` (`/graph` in Phase 4).
  - Ingestion: `POST /ingest/stream` (multipart, SSE) → per-stage events; **requires `editor` role** when auth on.
  - Auth (retriever): `POST /auth/login` → `{token, user}`; `GET /auth/me`; `GET /auth/config`;
    admin `GET/POST/PATCH/DELETE /auth/users`. Bearer JWT attached to every backend call.
- **Data model:** Qdrant collections (dense + in-process BM25; multi-vector/ColPali later; chunk metadata incl.
  page + bbox); networkx graph JSON per workspace; SQLite tables: workspaces, conversations (**+ user_id**),
  messages, study_artifacts, eval_items/runs, feedback, **users** (bcrypt hash + role).
- **Auth / RBAC:** self-contained — bcrypt passwords + HS256 JWT signed with a shared `AUTH_SECRET`.
  Retriever owns the user store; the **ingestion service validates the same JWT statelessly** (trusts the
  signed role claim). Roles viewer < editor < admin; `require_role` guards. `AUTH_ENABLED=false` → open
  (synthetic admin) for local dev. No external IdP / no JVM.
- **Integrations:** OpenRouter (LLM/vision/embeddings/rerank), Docling, PyMuPDF, Deepgram (TTS), networkx,
  Langfuse. (Keycloak/OIDC = optional future SSO adapter, not required.)
- **Tech debt implied:** tokens in localStorage (→ httpOnly cookie); legacy pre-auth conversations are
  ownerless (visible to all); hybrid sparse should move into Qdrant at scale.

## B3. Competitive & Market Context
- **Alternatives today:** NotebookLM (black box, no on-prem, weak visual citations), generic RAG chatbots,
  raw LangChain/LlamaIndex builds.
- **Differentiation:** explainable/inspectable RAG, multimodal + visual citations, strategy playgrounds,
  GraphRAG, self-hosted enterprise with a lightweight own-orchestration stack (no heavy platform).
- **Strategic fit:** reusable internal + client-deliverable knowledge platform with data residency.

## B4. Analytics & Instrumentation Plan
- **Events:** query asked, retrieval strategy used, citation clicked, playground compared, study tool /
  audio generated, thumbs up/down, failed retrieval, model+cost per query.
- **Dashboards:** popular questions, failed/weak retrieval, unused documents, embedding distribution, avg
  confidence, cost/latency per model.
- **Experiment design:** A/B retrieval strategies and models against the golden eval set.

## B5. Go-to-Market & Launch Checklist
- **Positioning:** "Explainable, multimodal, self-hosted NotebookLM for enterprise."
- **Enablement:** admin setup docs, workspace onboarding, RAG-education guide (Learning Mode ties in).
- **Checklist:** security sign-off, RBAC test, eval gate passed, runbook, backup/restore verified.

## B6. AI / ML Feature Considerations

**B6.0 — Gate:** Type = RAG + multimodal + agentic retrieval + generative study tools. AI is required —
task is open-ended NL Q&A over heterogeneous unstructured knowledge; rules-based won't work.

**B6.1 — Model & approach:** Buy/route via OpenRouter (Claude Opus 4.8, Gemini 3 Flash, GPT-5.5; vision:
Gemini 3 Flash / MiniMax M3). Technique: prompting + hybrid RAG + rerank + optional GraphRAG/agentic; no
fine-tuning. Embeddings: BGE-M3 (self-host, hybrid) or OpenRouter; multimodal: ColPali/Cohere embed-v4.

**B6.2 — Data:** Grounding = user-uploaded workspace sources only (rights owned by tenant). PII stays
on-prem; no training on user data. Freshness via re-ingest on upload/update. Cold-start = empty workspace
prompts user to upload.

**B6.3 — Evaluation:** Golden Q&A dataset per workspace; Ragas + DeepEval. Metrics: faithfulness ≥ 0.85,
recall@5 ≥ 0.80, groundedness, latency, cost, hallucination. Offline gates before GA; online A/B for
strategy/model changes. Traces in Langfuse/Phoenix.

**B6.4 — Safety & guardrails** (✅ implemented in `services/retriever` — `chat.py`, `/chat`):
- **Out-of-scope gate** ✅ — dense-cosine relevance probe of query vs corpus; below `RELEVANCE_THRESHOLD`
  (0.22, env-configurable) → refuse **before** the LLM (no cost, can't be argued around). Strategy-independent.
- **Prompt injection** ✅ — SOURCES + question labelled UNTRUSTED; each source fenced `<source>…</source>`;
  system prompt forbids obeying embedded instructions, role-changes, or prompt-disclosure. Verified: on-topic
  query with an injection tail answers the legit part and refuses the injection; prompt never leaked.
- **Scope** ✅ — only answers about workspace documents; off-topic asks → "I only answer questions about this
  workspace's documents."
- **Grounding** ✅ — answer only from sources or "I can't answer that from this workspace's sources"; every
  claim cited [n]; retrieval-empty → refuse (no fabrication).
- The guardrail decision is emitted as a **visible pipeline step** (explainability).
- Bias/toxicity → provider safety + output checks (relies on model provider). Model/provider error → surfaced.
- Human-in-the-loop: user reviews cited sources; can override model/strategy in playgrounds.

**B6.5 — Transparency & UX:** Always disclose AI-generated; surface citations with score/confidence;
Learning Mode shows the full pipeline; errors surfaced explicitly (no silent failure).

**B6.6 — Post-launch quality ownership:** ML eng owns quality. Ground truth = curated golden sets +
thumbs up/down feedback. Feedback loop: rating capture, drift detection via periodic eval re-runs, weak-chunk
analytics trigger re-chunk/re-embed.

## B7. Appendix & Revision History
- **References:** OpenRouter (embeddings, rerank, vision, models); Docling; Qdrant; Neo4j;
  Ragas/DeepEval; Langfuse/Phoenix; `README.md`; `techstackwithflow.md`.
- **Glossary:** RAG, hybrid search (dense+sparse), rerank, HyDE, GraphRAG, ColPali (page-as-image late
  interaction), BGE-M3, UMAP, SSE.

| Version | Date | Author | Change |
|---|---|---|---|
| v0.1 | 2026-07-20 | abhisek.bose@codeclouds.com | Initial draft |
| v0.2 | 2026-07-22 | abhisek.bose@codeclouds.com | Shipped self-hosted JWT auth + RBAC (viewer/editor/admin) on both services (Keycloak dropped); role-aware UI; per-user chat history; attach reference image in chat (vision-augmented retrieval); Studio Library; Analytics in nav. TTS resolved to Deepgram. |
