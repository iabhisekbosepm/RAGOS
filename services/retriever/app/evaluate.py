"""Evaluation: golden-set generation + LLM-as-judge RAG metrics.

Metrics (0-1, same concepts as Ragas — computed via our own OpenRouter judge, no heavy deps):
  - faithfulness      : is the answer supported by the retrieved context? (anti-hallucination)
  - answer_relevancy  : does the answer actually address the question?
  - context_relevance : were the retrieved passages relevant to the question? (retrieval quality)
"""
import json
import logging
import re
from typing import Any

from . import prompts
from .chat import complete
from .config import settings

_log = logging.getLogger(__name__)


def _extract_json(text: str) -> Any:
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    m = re.search(r"[\[{].*[\]}]", text, re.DOTALL)
    return json.loads(m.group(0) if m else text)


async def generate_set(context: str, count: int, model: str | None = None) -> list[dict]:
    """Create {question, expected} golden pairs grounded in the workspace content."""
    messages = [
        {"role": "system", "content": prompts.get("eval_generate")},
        {"role": "user", "content": f"CONTEXT:\n{context}\n\nCreate {count} question/answer pairs."},
    ]
    raw = await complete(messages, model or settings.llm_model, max_tokens=1500)
    try:
        data = _extract_json(raw)
        return [d for d in data if isinstance(d, dict) and d.get("question")][:count]
    except Exception as e:
        _log.warning("golden-set generation parse failed: %s · raw=%r", e, raw[:200])
        return []


async def judge(question: str, answer: str, contexts: list[str], expected: str = "",
                model: str | None = None) -> dict:
    """Score one answer (0-1). Retries once on parse failure; flags `errored` if it still can't parse."""
    ctx = "\n\n".join(f"[{i + 1}] {c}" for i, c in enumerate(contexts)) or "(no context retrieved)"
    ref = f"\nREFERENCE ANSWER (guidance, may be partial): {expected}" if expected else ""
    messages = [
        {"role": "system", "content": prompts.get("eval_judge")},
        {"role": "user", "content": f"QUESTION: {question}{ref}\n\nCONTEXT:\n{ctx}\n\nANSWER: {answer}"},
    ]
    for attempt in range(2):
        try:
            raw = await complete(messages, model or settings.llm_model, max_tokens=300)
            d = _extract_json(raw or "")
            clamp = lambda k: max(0.0, min(1.0, float(d.get(k, 0))))  # noqa: E731
            return {"faithfulness": clamp("faithfulness"), "answer_relevancy": clamp("answer_relevancy"),
                    "context_relevance": clamp("context_relevance"),
                    "reason": str(d.get("reason", ""))[:200], "errored": False}
        except Exception as e:
            last = e
            _log.warning("judge attempt %d failed: %s", attempt + 1, e)
    # Persistent failure → mark errored so it can be EXCLUDED from averages (not scored 0).
    return {"faithfulness": None, "answer_relevancy": None, "context_relevance": None,
            "reason": f"judge parse error: {last}", "errored": True}
