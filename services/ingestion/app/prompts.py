"""Prompt loader — reads reusable prompt templates from the repo-root /prompts folder."""
from pathlib import Path

_DIR = Path(__file__).resolve().parents[3] / "prompts"
_cache: dict[str, str] = {}


def get(name: str) -> str:
    if name not in _cache:
        _cache[name] = (_DIR / f"{name}.txt").read_text(encoding="utf-8").strip()
    return _cache[name]


def render(name: str, **kw) -> str:
    text = get(name)
    for k, v in kw.items():
        text = text.replace("{" + k + "}", str(v))
    return text
