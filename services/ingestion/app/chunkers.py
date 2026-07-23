"""Selectable chunking strategies.

Each returns a list of {"embed": str, "content": str}:
  - embed   → the text that gets vectorized (what search matches on)
  - content → the text stored/shown/fed to the LLM (usually == embed)

Strategies:
  fixed        — equal char windows with overlap (simplest baseline)
  structure    — paragraph/heading-aware packing (default; good general choice)
  sentence     — sentence-boundary packing (cleaner splits than fixed)
  parent_child — small child embedded, larger parent returned (precision + context)
  semantic     — boundaries where meaning shifts (async; embeds sentences)
"""
import re

STRATEGIES = ["structure", "fixed", "sentence", "parent_child", "semantic"]


def clean(text: str) -> str:
    text = re.sub(r"\[?<RawText children=['\"](.*?)['\"]>\]?", r"\1", text)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    return re.sub(r"[ \t]+", " ", text).strip()


def _split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n{2,}", text) if s.strip()]


def fixed(text: str, size: int, overlap: int) -> list[dict]:
    t = clean(text)
    step = max(1, size - overlap)
    out = [t[i : i + size] for i in range(0, len(t), step)]
    return [{"embed": c, "content": c} for c in out if c.strip()]


def structure(text: str, size: int, overlap: int) -> list[dict]:
    text = clean(text)
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    chunks: list[str] = []
    cur = ""
    for b in blocks:
        if len(b) > size:
            if cur:
                chunks.append(cur); cur = ""
            for i in range(0, len(b), max(1, size - overlap)):
                chunks.append(b[i : i + size])
            continue
        if len(cur) + len(b) + 1 <= size:
            cur = f"{cur}\n{b}" if cur else b
        else:
            chunks.append(cur)
            tail = cur[-overlap:] if overlap else ""
            cur = f"{tail}\n{b}" if tail else b
    if cur:
        chunks.append(cur)
    return [{"embed": c, "content": c} for c in chunks]


def sentence(text: str, size: int, overlap: int) -> list[dict]:
    sents = _split_sentences(clean(text))
    chunks: list[str] = []
    cur = ""
    for s in sents:
        if len(cur) + len(s) + 1 <= size:
            cur = f"{cur} {s}" if cur else s
        else:
            if cur:
                chunks.append(cur)
            cur = s
    if cur:
        chunks.append(cur)
    return [{"embed": c, "content": c} for c in chunks]


def parent_child(text: str, size: int, overlap: int, child_size: int = 350) -> list[dict]:
    """Embed small children for precise matching; return the larger parent for context."""
    items: list[dict] = []
    for parent in structure(text, size, overlap):
        p = parent["content"]
        for child in fixed(p, child_size, 60):
            items.append({"embed": child["content"], "content": p})
    return items


async def semantic(text: str, size: int, embed_fn, threshold: float = 0.82) -> list[dict]:
    """Group consecutive sentences until meaning shifts (cosine drop) or size is hit."""
    import numpy as np

    sents = _split_sentences(clean(text))
    if len(sents) < 3:
        return structure(text, size, size // 6)
    vecs = np.array(await embed_fn(sents), dtype="float32")
    vecs /= (np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-9)

    chunks: list[str] = []
    cur, cur_len = [sents[0]], len(sents[0])
    for i in range(1, len(sents)):
        sim = float(vecs[i] @ vecs[i - 1])
        if sim < threshold or cur_len + len(sents[i]) > size:
            chunks.append(" ".join(cur))
            cur, cur_len = [sents[i]], len(sents[i])
        else:
            cur.append(sents[i]); cur_len += len(sents[i])
    if cur:
        chunks.append(" ".join(cur))
    return [{"embed": c, "content": c} for c in chunks]


def chunk(text: str, strategy: str, size: int, overlap: int) -> list[dict]:
    """Sync strategies. (semantic is async — call semantic() directly.)"""
    if strategy == "fixed":
        return fixed(text, size, overlap)
    if strategy == "sentence":
        return sentence(text, size, overlap)
    if strategy == "parent_child":
        return parent_child(text, size, overlap)
    return structure(text, size, overlap)  # default
