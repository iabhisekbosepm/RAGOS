"""Chat-time vision: turn an attached reference image into text.

When a user attaches image(s) in chat, we caption + transcribe them with a
vision LLM. The resulting text augments the retrieval query (so the dense/BM25
corpus — which stores images as embedded captions — can be searched), and the
raw image is also handed to a vision model at generation time so the answer can
actually "see" it. No image-vector similarity here; retrieval stays text-space.
"""
import logging

import httpx

from .config import settings

_log = logging.getLogger(__name__)

# Combined caption + verbatim-text transcription, so fine labels/text in
# diagrams and screenshots become searchable (light OCR).
_DESCRIBE = (
    "Describe this image for search retrieval. Be specific about what it shows "
    "(objects, diagram type, structure, subject). Then, under a line 'TEXT:', "
    "transcribe verbatim any text, labels, or numbers visible in the image. "
    "If there is no text, write 'TEXT: (none)'. Keep it under 180 words."
)


async def describe(data_url: str) -> str:
    """Caption + transcribe a single image given as a base64 data URL. '' on failure."""
    if not settings.openrouter_api_key:
        return ""
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": _DESCRIBE},
            {"type": "image_url", "image_url": {"url": data_url}},
        ],
    }]
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(
                f"{settings.openrouter_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
                json={"model": settings.vision_model, "messages": messages, "max_tokens": 400},
            )
            resp.raise_for_status()
            return (resp.json()["choices"][0]["message"]["content"] or "").strip()
    except Exception as e:
        _log.warning("image describe failed — image ignored for retrieval: %s", e)
        return ""


async def describe_all(data_urls: list[str]) -> str:
    """Describe up to a few images and join their descriptions into one blob."""
    parts: list[str] = []
    for i, url in enumerate(data_urls[:3]):  # cap to keep latency/cost bounded
        d = await describe(url)
        if d:
            parts.append(f"[attached image {i + 1}]\n{d}")
    return "\n\n".join(parts)
