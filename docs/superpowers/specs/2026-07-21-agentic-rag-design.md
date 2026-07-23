# Agentic RAG (DeepAgents) — Design

**Date:** 2026-07-21
**Status:** Approved (brainstorm)
**Goal:** Add an autonomous, agentic RAG chat as a **second, coexisting route** alongside the existing linear `/chat` pipeline, so both can be showcased side-by-side. Built on [LangChain DeepAgents](https://docs.langchain.com/oss/python/deepagents/overview).

---

## 1. Decisions (locked)

| Concern | Decision |
|---|---|
| Coexistence | New `/agent/chat` route. Linear `/chat` **untouched**. Pure addition. |
| Agent scope | **Full DeepAgents**: planning (`write_todos`) + virtual filesystem + compaction + sub-agents. |
| Agent brain | **OpenRouter, configurable**, tool-calling-capable models only (allowlist). `model="openrouter:<id>"`. |
| Guardrails | **Both** — entry pre-check (dense relevance probe before loop) **and** per-retrieval threshold inside the `retrieve` tool. |
| Persistence | SQLite stays source of truth for messages; add LangGraph `SqliteSaver` checkpointer for in-run agent state. |
| Frontend | New agent page/toggle → `/agent/chat`; reuse chat UI + dynamic pipeline chips; add Todos + Scratchpad panels. |

---

## 2. Architecture

Existing `/chat` (linear) is unchanged. New parallel path:

```
POST /agent/chat  (SSE, same event contract as /chat)
   │
   ├─ entry guardrail  ── dense relevance probe → refuse early if < RELEVANCE_THRESHOLD   [guardrail #1]
   │
   └─ DeepAgent (create_deep_agent, LangGraph)
        model:  openrouter:<selected tool-capable model>
        system_prompt:  grounding + injection armor (from prompts/)
        tools:  retrieve(query, strategy, top_k, sources)   ← wraps retrieval.run_strategy
                list_strategies()
        subagents:  researcher, critic
        middleware:  FilesystemMiddleware(backend=StateBackend())   ← virtual planning-doc sandbox
        built-in:   write_todos (planning), automatic compaction
        checkpointer:  SqliteSaver keyed by conversation_id
        │
        └─ astream_events()  →  translated  →  SSE {step, token, citations, done}
```

**Module boundaries**
- `agent.py` (**new**) — agent construction, tool defs, sub-agent defs, event translator. Owns everything agentic.
- `main.py` — adds `/agent/chat` endpoint: HTTP + SSE + SQLite + entry guardrail. Linear `/chat` unchanged.
- `retrieval.py` — search logic unchanged; consumed by the `retrieve` tool.
- `chat.py` — `complete()` / `stream_llm()` retained for linear route + HyDE/study/eval/suggestions. Not agentic.
- `config.py` — add `TOOL_CAPABLE_MODELS` allowlist + agent defaults.
- Ingestion service — untouched.

---

## 3. Tools & guardrails

```python
@tool
def retrieve(query: str, strategy: str = "hybrid", top_k: int = 5, sources: list[str] | None = None):
    """Search the workspace corpus. strategy: semantic|hybrid|hyde|graphrag."""
    hits = run_strategy(qdrant, strategy, query, collection, top_k, sources=sources)
    # guardrail #2: drop weak results so the agent can't smuggle out-of-scope chunks
    if not hits or hits[0]["score"] < RELEVANCE_THRESHOLD:
        return "No in-scope results for that query."
    return hits  # fenced <source> injection armor applied when rendered
```

- **Guardrail #1 (entry):** same dense probe as today, before the agent is spun up. Below threshold → refuse, emit `step:"guardrail"`, no agent run.
- **Guardrail #2 (per-retrieval):** `retrieve` self-censors weak results even across rephrase/loop.
- **Citations:** `agent.py` accumulates a de-duped union of chunks returned by all `retrieve` calls in a run; emits one `citations` event at the end (same shape as `/chat`).

---

## 4. Sub-agents (v1 — keep small, YAGNI)

- **researcher** — given one sub-question, calls `retrieve`, returns a grounded mini-summary + its chunks. Keeps multi-hop fan-out out of the main agent's context.
- **critic** — reviews the draft answer for groundedness/citations before finalizing; can bounce the main agent back to retrieve. The quality USP, made agentic.

No further sub-agents until proven necessary.

---

## 5. Planning FS & compaction

- **Virtual FS** = `FilesystemMiddleware(backend=StateBackend())` — files live in LangGraph state, no disk, no security surface. Agent drafts `plan.md` / `findings.md`; contents streamed as `step` events → UI Scratchpad panel.
- **Planning** = built-in `write_todos`; streamed → UI Todos panel.
- **Compaction** = DeepAgents automatic context compression for long multi-hop sessions.

---

## 6. Event translation → existing SSE contract

| LangGraph event | SSE emitted |
|---|---|
| tool start `retrieve` | `{type:"step", step:"retrieval", detail:"hybrid · hop N"}` |
| tool start `write_todos` | `{type:"step", step:"plan", detail:"N todos"}` |
| FS write | `{type:"step", step:"scratchpad", detail:"findings.md"}` |
| sub-agent start | `{type:"step", step:"subagent", detail:"researcher"}` |
| final answer tokens | `{type:"token", text:...}` |
| run end | `{type:"citations", records:[union]}` then `{type:"done"}` |
| exception | `{type:"error", detail:...}` |

Contract identical to `/chat`, so the frontend pipeline renderer is reused (chips now variable-length).

---

## 7. Persistence, observability, errors

- **SQLite:** reuse `db.create_conversation` / `db.add_message`; tag agentic turns `meta.mode="agentic"`. Same conversation tables → history + analytics work for both routes.
- **Checkpointer:** LangGraph `SqliteSaver` keyed by `conversation_id` for in-run agent state (todos/FS/resume). Separate concern from message history.
- **Langfuse:** pass Langfuse `CallbackHandler` in the graph config → nested tool/sub-agent spans free. Linear route keeps its hand-rolled spans. No-op if keys unset (existing `obs.py` pattern).
- **Errors:** agent run wrapped in try/except like today's `gen()` → `{type:"error"}`, persist partial answer, `obs.flush()` in `finally`. Tool exceptions returned to the agent as observations, not crashes.

---

## 8. Testing

- **Unit:** `retrieve` guardrail threshold (weak → "no in-scope results"); event-translator mapping (LangGraph event → SSE dict).
- **Integration:** in-scope multi-hop question → produces todos + union citations + grounded answer; out-of-scope → refused at entry, no agent run.
- **Regression parity:** same golden-set question answered by both `/chat` and `/agent/chat`; agentic faithfulness ≥ linear.

---

## 9. Out of scope (v1)

- Real code-execution sandbox (container). Virtual FS covers planning docs.
- Migrating the linear route to agentic — it stays as the comparison baseline.
- New retrieval strategies — reuse the existing four.
- Human-in-the-loop `interrupt_on` — deferred.
