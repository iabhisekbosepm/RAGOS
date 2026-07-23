"""Local SQLite store for workspaces, conversations, and chat messages.

Stdlib only (no server). One file at data/ccragos.db. Low-concurrency workshop use →
a single connection guarded by a lock is plenty.
"""
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DB_PATH = Path("data/ccragos.db")
_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id() -> str:
    return uuid.uuid4().hex


def conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        DB_PATH.parent.mkdir(exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _init(_conn)
    return _conn


def _init(c: sqlite3.Connection) -> None:
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS workspaces (
            collection TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            created_at TEXT NOT NULL,
            settings   TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS conversations (
            id         TEXT PRIMARY KEY,
            collection TEXT NOT NULL,
            title      TEXT NOT NULL,
            created_at TEXT NOT NULL,
            user_id    TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL,
            meta            TEXT NOT NULL DEFAULT '{}',
            created_at      TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS study_artifacts (
            id         TEXT PRIMARY KEY,
            collection TEXT NOT NULL,
            tool       TEXT NOT NULL,
            topic      TEXT NOT NULL DEFAULT '',
            payload    TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS eval_items (
            id         TEXT PRIMARY KEY,
            collection TEXT NOT NULL,
            question   TEXT NOT NULL,
            expected   TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS eval_runs (
            id         TEXT PRIMARY KEY,
            collection TEXT NOT NULL,
            strategy   TEXT NOT NULL,
            rerank     INTEGER NOT NULL DEFAULT 0,
            summary    TEXT NOT NULL,
            results    TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS feedback (
            id              TEXT PRIMARY KEY,
            collection      TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            rating          INTEGER NOT NULL,
            question        TEXT NOT NULL DEFAULT '',
            created_at      TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS users (
            id            TEXT PRIMARY KEY,
            username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            role          TEXT NOT NULL DEFAULT 'viewer',
            created_at    TEXT NOT NULL
        );
        """
    )
    # Migration: add conversations.user_id to pre-existing DBs (ignore if already there).
    try:
        c.execute("ALTER TABLE conversations ADD COLUMN user_id TEXT NOT NULL DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    c.commit()


# ── users (auth / RBAC) ──────────────────────────────────────────────
def create_user(username: str, password_hash: str, role: str) -> dict:
    uid = _id()
    with _lock:
        c = conn()
        c.execute("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)",
                  (uid, username, password_hash, role, _now()))
        c.commit()
    return {"id": uid, "username": username, "role": role}


def get_user_by_username(username: str) -> dict | None:
    row = conn().execute("SELECT * FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone()
    return dict(row) if row else None


def get_user(uid: str) -> dict | None:
    row = conn().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return dict(row) if row else None


def list_users() -> list[dict]:
    rows = conn().execute("SELECT id, username, role, created_at FROM users ORDER BY created_at").fetchall()
    return [dict(r) for r in rows]


def count_users() -> int:
    return conn().execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]


def update_user_role(uid: str, role: str) -> None:
    with _lock:
        c = conn()
        c.execute("UPDATE users SET role=? WHERE id=?", (role, uid))
        c.commit()


def delete_user(uid: str) -> None:
    with _lock:
        c = conn()
        c.execute("DELETE FROM users WHERE id=?", (uid,))
        c.commit()


# ── workspaces ───────────────────────────────────────────────────────
def upsert_workspace(collection: str, name: str, settings: dict | None = None) -> dict:
    with _lock:
        c = conn()
        existing = c.execute("SELECT collection FROM workspaces WHERE collection=?", (collection,)).fetchone()
        if existing:
            if settings is not None:
                c.execute("UPDATE workspaces SET name=?, settings=? WHERE collection=?",
                          (name, json.dumps(settings), collection))
            else:
                c.execute("UPDATE workspaces SET name=? WHERE collection=?", (name, collection))
        else:
            c.execute("INSERT INTO workspaces (collection, name, created_at, settings) VALUES (?,?,?,?)",
                      (collection, name, _now(), json.dumps(settings or {})))
        c.commit()
    return {"collection": collection, "name": name}


def list_workspaces() -> list[dict]:
    c = conn()
    rows = c.execute("SELECT * FROM workspaces ORDER BY created_at").fetchall()
    return [dict(r) for r in rows]


def delete_workspace(collection: str) -> None:
    with _lock:
        c = conn()
        convo_ids = [r["id"] for r in c.execute(
            "SELECT id FROM conversations WHERE collection=?", (collection,)).fetchall()]
        for cid in convo_ids:
            c.execute("DELETE FROM messages WHERE conversation_id=?", (cid,))
        c.execute("DELETE FROM conversations WHERE collection=?", (collection,))
        c.execute("DELETE FROM workspaces WHERE collection=?", (collection,))
        c.commit()


# ── conversations + messages ─────────────────────────────────────────
def create_conversation(collection: str, title: str, user_id: str = "") -> str:
    cid = _id()
    with _lock:
        c = conn()
        c.execute("INSERT INTO conversations (id, collection, title, created_at, user_id) VALUES (?,?,?,?,?)",
                  (cid, collection, title[:80], _now(), user_id))
        c.commit()
    return cid


def add_message(conversation_id: str, role: str, content: str, meta: dict | None = None) -> None:
    with _lock:
        c = conn()
        c.execute("INSERT INTO messages (id, conversation_id, role, content, meta, created_at) VALUES (?,?,?,?,?,?)",
                  (_id(), conversation_id, role, content, json.dumps(meta or {}), _now()))
        c.commit()


def list_conversations(collection: str, user_id: str | None = None) -> list[dict]:
    """List conversations. If user_id is given, restrict to that owner (own + legacy
    ownerless). If None (admin/open), return all."""
    c = conn()
    if user_id is None:
        rows = c.execute(
            "SELECT * FROM conversations WHERE collection=? ORDER BY created_at DESC", (collection,)
        ).fetchall()
    else:
        rows = c.execute(
            "SELECT * FROM conversations WHERE collection=? AND (user_id=? OR user_id='') "
            "ORDER BY created_at DESC", (collection, user_id)
        ).fetchall()
    return [dict(r) for r in rows]


def conversation_owner(conversation_id: str) -> str | None:
    """Return the owner user_id ('' if legacy/ownerless), or None if not found."""
    row = conn().execute("SELECT user_id FROM conversations WHERE id=?", (conversation_id,)).fetchone()
    return row["user_id"] if row else None


def get_messages(conversation_id: str) -> list[dict[str, Any]]:
    c = conn()
    rows = c.execute(
        "SELECT role, content, meta, created_at FROM messages WHERE conversation_id=? ORDER BY created_at",
        (conversation_id,),
    ).fetchall()
    return [{"role": r["role"], "content": r["content"], "meta": json.loads(r["meta"]),
             "created_at": r["created_at"]} for r in rows]


def delete_conversation(conversation_id: str) -> None:
    with _lock:
        c = conn()
        c.execute("DELETE FROM messages WHERE conversation_id=?", (conversation_id,))
        c.execute("DELETE FROM conversations WHERE id=?", (conversation_id,))
        c.commit()


# ── study artifacts ──────────────────────────────────────────────────
def save_study(collection: str, tool: str, topic: str, payload: dict) -> str:
    aid = _id()
    with _lock:
        c = conn()
        c.execute("INSERT INTO study_artifacts (id, collection, tool, topic, payload, created_at) VALUES (?,?,?,?,?,?)",
                  (aid, collection, tool, topic, json.dumps(payload), _now()))
        c.commit()
    return aid


def list_study(collection: str) -> list[dict]:
    c = conn()
    rows = c.execute(
        "SELECT id, tool, topic, created_at FROM study_artifacts WHERE collection=? ORDER BY created_at DESC",
        (collection,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_study(aid: str) -> dict | None:
    c = conn()
    r = c.execute("SELECT * FROM study_artifacts WHERE id=?", (aid,)).fetchone()
    if not r:
        return None
    d = dict(r)
    d["payload"] = json.loads(d["payload"])
    return d


def delete_study(aid: str) -> None:
    with _lock:
        c = conn()
        c.execute("DELETE FROM study_artifacts WHERE id=?", (aid,))
        c.commit()


# ── eval: golden items + runs ────────────────────────────────────────
def add_eval_item(collection: str, question: str, expected: str = "") -> str:
    iid = _id()
    with _lock:
        c = conn()
        c.execute("INSERT INTO eval_items (id, collection, question, expected, created_at) VALUES (?,?,?,?,?)",
                  (iid, collection, question, expected, _now()))
        c.commit()
    return iid


def list_eval_items(collection: str) -> list[dict]:
    c = conn()
    rows = c.execute("SELECT * FROM eval_items WHERE collection=? ORDER BY created_at", (collection,)).fetchall()
    return [dict(r) for r in rows]


def delete_eval_item(iid: str) -> None:
    with _lock:
        c = conn()
        c.execute("DELETE FROM eval_items WHERE id=?", (iid,))
        c.commit()


def save_eval_run(collection: str, strategy: str, rerank: bool, summary: dict, results: list) -> str:
    rid = _id()
    with _lock:
        c = conn()
        c.execute("INSERT INTO eval_runs (id, collection, strategy, rerank, summary, results, created_at) VALUES (?,?,?,?,?,?,?)",
                  (rid, collection, strategy, 1 if rerank else 0, json.dumps(summary), json.dumps(results), _now()))
        c.commit()
    return rid


def list_eval_runs(collection: str) -> list[dict]:
    c = conn()
    rows = c.execute("SELECT id, strategy, rerank, summary, created_at FROM eval_runs WHERE collection=? ORDER BY created_at DESC",
                     (collection,)).fetchall()
    out = []
    for r in rows:
        d = dict(r); d["summary"] = json.loads(d["summary"]); out.append(d)
    return out


# ── analytics + feedback ─────────────────────────────────────────────
def messages_for_collection(collection: str) -> list[dict]:
    """All messages across a workspace's conversations (for analytics)."""
    c = conn()
    rows = c.execute(
        "SELECT m.role, m.content, m.meta, m.created_at FROM messages m "
        "JOIN conversations c ON m.conversation_id = c.id WHERE c.collection=? ORDER BY m.created_at",
        (collection,),
    ).fetchall()
    return [{"role": r["role"], "content": r["content"], "meta": json.loads(r["meta"]),
             "created_at": r["created_at"]} for r in rows]


def add_feedback(collection: str, conversation_id: str, rating: int, question: str = "") -> None:
    with _lock:
        c = conn()
        c.execute("INSERT INTO feedback (id, collection, conversation_id, rating, question, created_at) VALUES (?,?,?,?,?,?)",
                  (_id(), collection, conversation_id, 1 if rating > 0 else -1, question[:200], _now()))
        c.commit()


def feedback_counts(collection: str) -> dict:
    c = conn()
    up = c.execute("SELECT COUNT(*) FROM feedback WHERE collection=? AND rating>0", (collection,)).fetchone()[0]
    down = c.execute("SELECT COUNT(*) FROM feedback WHERE collection=? AND rating<0", (collection,)).fetchone()[0]
    return {"up": up, "down": down}


def get_eval_run(rid: str) -> dict | None:
    c = conn()
    r = c.execute("SELECT * FROM eval_runs WHERE id=?", (rid,)).fetchone()
    if not r:
        return None
    d = dict(r); d["summary"] = json.loads(d["summary"]); d["results"] = json.loads(d["results"])
    return d
