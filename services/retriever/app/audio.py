"""Audio Overview: 2-speaker podcast script (LLM) + Deepgram Aura TTS.

Pipeline: context → dialogue script (Host/Guest turns) → per-line TTS with a voice
per speaker → concatenated MP3. Gracefully returns the script alone if no Deepgram key.
"""
import json
import re
import uuid
from pathlib import Path

import httpx

from . import prompts
from .chat import complete
from .config import settings

MEDIA_DIR = Path("media")


def _extract_json_array(text: str) -> list:
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    m = re.search(r"\[.*\]", text, re.DOTALL)
    return json.loads(m.group(0) if m else text)


async def make_script(context: str, model: str | None = None, turns: int = 8) -> list[dict]:
    """Generate a natural 2-host podcast dialogue grounded in the context."""
    messages = [
        {"role": "system", "content": prompts.render("audio_script", turns=turns)},
        {"role": "user", "content": f"CONTEXT:\n{context}"},
    ]
    raw = await complete(messages, model or settings.llm_model, max_tokens=1500)
    try:
        script = _extract_json_array(raw)
        return [t for t in script if isinstance(t, dict) and t.get("text")]
    except Exception:
        return []


async def _tts(text: str, voice: str) -> bytes:
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"https://api.deepgram.com/v1/speak?model={voice}",
            headers={"Authorization": f"Token {settings.deepgram_api_key}",
                     "Content-Type": "application/json"},
            json={"text": text},
        )
        resp.raise_for_status()
        return resp.content


async def synthesize(script: list[dict], collection: str) -> str | None:
    """Render the script to a single MP3 in media/, return its /media URL (or None)."""
    if not settings.deepgram_api_key or not script:
        return None
    chunks: list[bytes] = []
    for turn in script:
        voice = settings.tts_voice_guest if turn.get("speaker") == "Guest" else settings.tts_voice_host
        chunks.append(await _tts(turn["text"], voice))
    coll_dir = MEDIA_DIR / collection
    coll_dir.mkdir(parents=True, exist_ok=True)
    fname = f"audio_{uuid.uuid4().hex}.mp3"
    (coll_dir / fname).write_bytes(b"".join(chunks))  # MP3 frame concat plays fine in browsers
    return f"/media/{collection}/{fname}"
