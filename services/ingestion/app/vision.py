"""Vision helpers via OpenRouter (multimodal LLM).

- caption(): describe an image for text-embedding retrieval.
- locate(): at query time, return the bounding box of the region answering a question.

Uses a vision-capable model (default Gemini Flash). Images are sent as base64 data URLs.
ColPali page-image late-interaction is the heavier GPU-host upgrade; this covers the
visual-citation UX without multi-GB local weights.
"""
import asyncio
import base64
import json
import re
from pathlib import Path

import httpx
from PIL import Image

from . import prompts
from .config import settings

MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif"}
IMAGE_EXTS = set(MIME)


def _data_url(path: str) -> str:
    ext = Path(path).suffix.lower()
    data = base64.b64encode(Path(path).read_bytes()).decode()
    return f"data:{MIME.get(ext, 'image/png')};base64,{data}"


async def _vision(messages: list[dict], max_tokens: int = 600) -> str:
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{settings.openrouter_base_url}/chat/completions",
            headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
            json={"model": settings.vision_model, "messages": messages, "max_tokens": max_tokens},
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


async def caption(path: str) -> str:
    """Rich description for retrieval indexing."""
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": prompts.get("vision_caption")},
            {"type": "image_url", "image_url": {"url": _data_url(path)}},
        ],
    }]
    return await _vision(messages, 800)


async def locate(path: str, query: str) -> dict:
    """Return {bbox:[x,y,w,h] normalized 0-1, explanation} for the region answering `query`."""
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": prompts.render("vision_locate", query=query)},
            {"type": "image_url", "image_url": {"url": _data_url(path)}},
        ],
    }]
    raw = await _vision(messages, 300)
    try:
        raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(m.group(0) if m else raw)
        bbox = [float(v) for v in data.get("bbox", [0, 0, 1, 1])][:4]
        # Gemini-family models return coords on a 0-1000 scale; others may use pixels.
        if any(v > 1.5 for v in bbox):
            if all(v <= 1000 for v in bbox):
                bbox = [v / 1000.0 for v in bbox]          # 0-1000 normalized (Gemini)
            else:
                w, h = await asyncio.to_thread(lambda: Image.open(path).size)  # raw pixels
                x, y, bw, bh = bbox
                bbox = [x / w, y / h, bw / w, bh / h]
        bbox = [min(max(v, 0.0), 1.0) for v in bbox]
        return {"bbox": bbox, "explanation": data.get("explanation", "")}
    except Exception as e:
        return {"bbox": [0, 0, 1, 1], "explanation": f"(could not locate: {e})"}
