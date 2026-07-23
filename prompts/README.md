# Prompts

All LLM prompts live here as plain `.txt` files so they can be **reused and edited without touching code**.
Both services load them via `app/prompts.py` (`get(name)` → raw text, `render(name, **kw)` → substitutes
`{token}` placeholders; JSON braces in templates are left untouched). Files are read + cached on first use,
so edits take effect on service restart.

| File | Used by | Purpose |
|---|---|---|
| `chat_guardrail.txt` | chat | System guardrails (grounding, injection defense, scope, citation) |
| `chat_style_{standard,cot,concise}.txt` | chat | Answer style appended to the guardrail |
| `condense_query.txt` | chat | Rewrite a follow-up into a standalone query (conversational RAG) |
| `hyde.txt` | retrieval | HyDE hypothetical-answer generation |
| `study_{flashcards,quiz,summary}.txt` | study | Item generators (`{count}` placeholder) |
| `study_{mermaid,mindmap,uml}.txt` | study | Diagram generators |
| `study_{cheatsheet,prd}.txt` | study | Markdown doc generators |
| `study_system_{items,diagram,markdown}.txt` | study | System prompts per output shape |
| `eval_generate.txt`, `eval_judge.txt` | eval | Golden-set generation + LLM-as-judge scoring |
| `audio_script.txt` | audio | 2-host podcast script (`{turns}` placeholder) |
| `graph_triples.txt`, `graph_entities.txt` | graph | Triple extraction + query entity extraction |
| `vision_caption.txt`, `vision_locate.txt` | ingestion (vision) | Image caption + visual-citation bbox (`{query}`) |
| `doc_context.txt` | ingestion | Doc-level context blurb (contextual retrieval) |

**Placeholders:** `{count}`, `{turns}`, `{query}` are substituted by `render()`. Everything else (incl. `{ }`
in JSON examples) is literal. To tune behavior, edit the `.txt` and restart the relevant service.
