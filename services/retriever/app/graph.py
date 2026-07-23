"""GraphRAG-lite: LLM triple extraction into an in-process networkx graph.

Neo4j is the production option; locally we keep it dependency-light with networkx +
a JSON file per collection. Flow:
  build   → for each chunk, LLM extracts (subject, relation, object) triples; entities
            become nodes carrying the chunk text; relations become edges.
  search  → LLM pulls entities from the query, match graph nodes, expand 1 hop,
            return the chunks attached to those entities (multi-hop grounding).
"""
import json
import re
from pathlib import Path
from typing import Any

import networkx as nx

from . import prompts
from .chat import complete
from .config import settings

GRAPH_DIR = Path("graph-storage")


def _path(collection: str) -> Path:
    GRAPH_DIR.mkdir(exist_ok=True)
    return GRAPH_DIR / f"{collection}.json"


def _extract_json_array(text: str) -> list:
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    match = re.search(r"\[.*\]", text, re.DOTALL)
    return json.loads(match.group(0) if match else text)


async def _triples(chunk: str, model: str) -> list[list[str]]:
    messages = [
        {"role": "system", "content": prompts.get("graph_triples")},
        {"role": "user", "content": chunk[:1500]},
    ]
    try:
        raw = await complete(messages, model, max_tokens=500)
        triples = _extract_json_array(raw)
        return [t for t in triples if isinstance(t, list) and len(t) == 3]
    except Exception:
        return []


async def build(qdrant, collection: str, model: str | None = None, max_chunks: int = 20) -> dict[str, Any]:
    points, _ = qdrant.scroll(
        collection_name=collection, limit=max_chunks, with_payload=True, with_vectors=False
    )
    g = nx.Graph()
    model = model or settings.llm_model
    for p in points:
        content = p.payload.get("content", "")
        source = p.payload.get("title", p.payload.get("source", ""))
        for subj, rel, obj in await _triples(content, model):
            s, o = subj.strip().lower(), obj.strip().lower()
            if not s or not o:
                continue
            for name in (s, o):
                if not g.has_node(name):
                    g.add_node(name, chunks=[])
                if content not in g.nodes[name]["chunks"]:
                    g.nodes[name]["chunks"].append({"content": content, "source": source})
            g.add_edge(s, o, relation=rel.strip())

    data = {
        "nodes": [{"id": n, "chunks": g.nodes[n]["chunks"]} for n in g.nodes],
        "edges": [{"source": u, "target": v, "relation": g.edges[u, v].get("relation", "")}
                  for u, v in g.edges],
    }
    _path(collection).write_text(json.dumps(data))
    return {"nodes": len(data["nodes"]), "edges": len(data["edges"]), "collection": collection}


def load(collection: str) -> dict[str, Any] | None:
    p = _path(collection)
    return json.loads(p.read_text()) if p.exists() else None


def graph_data(collection: str) -> dict[str, Any]:
    """Nodes/edges for the graph viz (chunks stripped for payload size)."""
    data = load(collection)
    if not data:
        return {"nodes": [], "edges": [], "built": False}
    return {
        "nodes": [{"id": n["id"], "degree": len(n["chunks"])} for n in data["nodes"]],
        "edges": data["edges"],
        "built": True,
    }


async def graphrag_search(query: str, collection: str, top_k: int, model: str | None = None) -> Any:
    data = load(collection)
    if not data:
        return {"todo": f"Graph not built for '{collection}' — POST /graph/build first."}

    # Pull candidate entities from the query.
    messages = [
        {"role": "system", "content": prompts.get("graph_entities")},
        {"role": "user", "content": query},
    ]
    try:
        entities = [e.lower() for e in _extract_json_array(await complete(messages, model or settings.llm_model, 150))]
    except Exception:
        entities = []
    # Always also match on raw query words (>=4 chars) for robustness on small graphs.
    entities += [w for w in re.findall(r"[a-z0-9]{4,}", query.lower())]
    entities = list(dict.fromkeys(entities))

    node_index = {n["id"]: n for n in data["nodes"]}
    adj: dict[str, set] = {}
    for e in data["edges"]:
        adj.setdefault(e["source"], set()).add(e["target"])
        adj.setdefault(e["target"], set()).add(e["source"])

    # Match query entities to graph nodes (substring), then expand 1 hop.
    matched = {nid for nid in node_index for ent in entities if ent in nid or nid in ent}
    expanded = set(matched)
    for m in matched:
        expanded |= adj.get(m, set())

    seen, records = set(), []
    for nid in expanded:
        for ch in node_index.get(nid, {}).get("chunks", []):
            key = ch["content"][:120]
            if key in seen:
                continue
            seen.add(key)
            records.append({"content": ch["content"], "score": 1.0,
                            "title": ch.get("source", ""), "metadata": {"via_entity": nid}})
    return records[:top_k] if records else {"todo": "No graph matches — try a different query or rebuild."}
