"""Study-tool generation from a collection's content.

Three output shapes (prompts live in /prompts/study_*.txt):
  - items:    flashcards, quiz, summary   → {"items": [...]}
  - diagram:  mermaid, mindmap, uml       → {"mermaid": "<code>"}
  - markdown: cheatsheet, prd             → {"markdown": "..."}
"""
import json
import re
from typing import Any

from . import prompts
from .chat import complete
from .config import settings

ITEM_TOOLS = ["flashcards", "quiz", "summary"]
DIAGRAM_TOOLS = ["mermaid", "mindmap", "uml"]
MARKDOWN_TOOLS = ["cheatsheet", "prd"]
ALL_TOOLS = ITEM_TOOLS + DIAGRAM_TOOLS + MARKDOWN_TOOLS


def _extract_json(text: str) -> dict[str, Any]:
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    return json.loads(m.group(0) if m else text)


def _clean_mermaid(text: str) -> str:
    text = re.sub(r"```(?:mermaid)?", "", text).strip()
    m = re.search(r"(flowchart|graph|mindmap|sequenceDiagram|classDiagram|stateDiagram)[\s\S]*", text)
    return (m.group(0) if m else text).strip()


async def generate(tool: str, context: str, count: int, model: str | None = None) -> dict[str, Any]:
    model = model or settings.llm_model

    if tool in ITEM_TOOLS:
        messages = [
            {"role": "system", "content": prompts.get("study_system_items")},
            {"role": "user", "content": f"CONTEXT:\n{context}\n\n{prompts.render(f'study_{tool}', count=count)}"},
        ]
        raw = await complete(messages, model, max_tokens=1500)
        try:
            return {"tool": tool, "items": _extract_json(raw).get("items", [])}
        except (json.JSONDecodeError, AttributeError):
            return {"tool": tool, "error": "model did not return valid JSON", "raw": raw[:400]}

    if tool in DIAGRAM_TOOLS:
        messages = [
            {"role": "system", "content": prompts.get("study_system_diagram")},
            {"role": "user", "content": f"CONTEXT:\n{context}\n\n{prompts.get(f'study_{tool}')}"},
        ]
        raw = await complete(messages, model, max_tokens=900)
        return {"tool": tool, "mermaid": _clean_mermaid(raw)}

    if tool in MARKDOWN_TOOLS:
        messages = [
            {"role": "system", "content": prompts.get("study_system_markdown")},
            {"role": "user", "content": f"CONTEXT:\n{context}\n\n{prompts.get(f'study_{tool}')}"},
        ]
        raw = await complete(messages, model, max_tokens=1500)
        return {"tool": tool, "markdown": raw.strip()}

    return {"error": f"unknown tool '{tool}'", "tools": ALL_TOOLS}
