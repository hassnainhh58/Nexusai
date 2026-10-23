import sqlite3
from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from ..core.config import get_settings

# Explicit timestamp adapters/converters. The implicit default converter is
# deprecated since Python 3.12, so the behaviour is registered by hand.
sqlite3.register_adapter(datetime, lambda value: value.isoformat(sep=" "))
sqlite3.register_converter(
    "TIMESTAMP",
    lambda value: datetime.fromisoformat(value.decode("utf-8")),
)


def database_path() -> Path:
    """Resolved at call time so tests can point NEXUSAI_DB_PATH elsewhere."""
    return get_settings().database_path


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """
    Context manager for database connections.

    Enforces WAL mode, foreign keys, row factory, and transaction safety.
    """
    connection = sqlite3.connect(
        database_path(),
        timeout=10.0,
        detect_types=sqlite3.PARSE_DECLTYPES | sqlite3.PARSE_COLNAMES,
    )
    connection.row_factory = sqlite3.Row

    # Performance and integrity pragmas
    connection.execute("PRAGMA foreign_keys = ON;")
    connection.execute("PRAGMA journal_mode = WAL;")
    connection.execute("PRAGMA synchronous = NORMAL;")
    connection.execute("PRAGMA busy_timeout = 5000;")

    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


# ==========================================
# SCHEMA MIGRATIONS
# ==========================================
def _migration_001_initial(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            user_id TEXT NOT NULL DEFAULT 'default',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id)
                REFERENCES conversations(id)
                ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
            ON messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
            ON conversations(user_id, updated_at DESC);
        """
    )


def _migration_002_user_id(conn: sqlite3.Connection) -> None:
    """Adds user_id to databases created before multi-user support."""
    columns = [row["name"] for row in conn.execute("PRAGMA table_info(conversations);")]
    if "user_id" not in columns:
        conn.execute(
            "ALTER TABLE conversations ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default';"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_conversations_user_updated "
            "ON conversations(user_id, updated_at DESC);"
        )


def _migration_003_pin_and_feedback(conn: sqlite3.Connection) -> None:
    """Adds conversation pinning and per-message feedback."""
    conversation_columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(conversations);")
    }
    if "pinned" not in conversation_columns:
        conn.execute("ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_conversations_user_pinned "
            "ON conversations(user_id, pinned DESC, updated_at DESC);"
        )

    message_columns = {row["name"] for row in conn.execute("PRAGMA table_info(messages);")}
    if "feedback" not in message_columns:
        conn.execute("ALTER TABLE messages ADD COLUMN feedback TEXT;")


MIGRATIONS: list[tuple[int, Any]] = [
    (1, _migration_001_initial),
    (2, _migration_002_user_id),
    (3, _migration_003_pin_and_feedback),
]


def _like_pattern(query: str | None) -> str | None:
    """Builds a safe ``LIKE`` pattern (wildcards in user input are escaped)."""
    cleaned = (query or "").strip()
    if not cleaned:
        return None
    escaped = cleaned.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def init_db() -> None:
    """Applies pending, ordered migrations.

    ``PRAGMA user_version`` keeps the schema version in the database itself, so
    upgrades are idempotent and no external migration tool is required.
    """
    with get_db() as conn:
        version = conn.execute("PRAGMA user_version;").fetchone()[0]
        for target, migration in MIGRATIONS:
            if version < target:
                migration(conn)
                conn.execute(f"PRAGMA user_version = {int(target)};")


# ==========================================
# CONVERSATIONS
# ==========================================
def create_conversation(title: str = "New Chat", user_id: str = "default") -> int:
    """Creates a new conversation scoped by user_id."""
    clean_title = (title or "New Chat").strip() or "New Chat"
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO conversations (title, user_id)
            VALUES (?, ?)
            """,
            (clean_title[:150], user_id),
        )
        return int(cursor.lastrowid)


def update_conversation_title(conversation_id: int, title: str, user_id: str) -> bool:
    """Updates the conversation title if it belongs to user_id."""
    clean_title = title.strip()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE conversations
            SET title = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
            """,
            (clean_title[:150], conversation_id, user_id),
        )
        return cursor.rowcount > 0


def update_conversation_pinned(conversation_id: int, pinned: bool, user_id: str) -> bool:
    """Pins or unpins a conversation without changing its position in time."""
    with get_db() as conn:
        cursor = conn.execute(
            """
            UPDATE conversations
            SET pinned = ?
            WHERE id = ? AND user_id = ?
            """,
            (1 if pinned else 0, conversation_id, user_id),
        )
        return cursor.rowcount > 0


def get_conversation_meta(conversation_id: int, user_id: str) -> dict[str, Any] | None:
    """Returns the editable metadata of a conversation owned by user_id."""
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT id, title, pinned, created_at, updated_at
            FROM conversations
            WHERE id = ? AND user_id = ?
            """,
            (conversation_id, user_id),
        ).fetchone()
        return dict(row) if row else None


def add_message(conversation_id: int, role: str, content: str) -> int:
    """Adds a message to a conversation and updates its timestamp."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO messages (conversation_id, role, content)
            VALUES (?, ?, ?)
            """,
            (conversation_id, role, content),
        )
        msg_id = int(cursor.lastrowid)

        cursor.execute(
            """
            UPDATE conversations
            SET updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (conversation_id,),
        )
        return msg_id


def get_conversations(
    user_id: str,
    limit: int = 50,
    offset: int = 0,
    query: str | None = None,
) -> list[dict[str, Any]]:
    """Returns a page of the user's conversations, pinned first.

    A non-empty ``query`` matches the title or the content of any message, so
    the sidebar search finds a conversation by what was discussed, not only by
    its generated title.
    """
    pattern = _like_pattern(query)
    with get_db() as conn:
        if pattern is None:
            rows = conn.execute(
                """
                SELECT id, title, user_id, pinned, created_at, updated_at
                FROM conversations
                WHERE user_id = ?
                ORDER BY pinned DESC, updated_at DESC, id DESC
                LIMIT ? OFFSET ?
                """,
                (user_id, limit, offset),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT c.id, c.title, c.user_id, c.pinned, c.created_at, c.updated_at
                FROM conversations c
                WHERE c.user_id = ?
                  AND (
                    c.title LIKE ? ESCAPE '\\'
                    OR EXISTS (
                        SELECT 1 FROM messages m
                        WHERE m.conversation_id = c.id
                          AND m.content LIKE ? ESCAPE '\\'
                    )
                  )
                ORDER BY c.pinned DESC, c.updated_at DESC, c.id DESC
                LIMIT ? OFFSET ?
                """,
                (user_id, pattern, pattern, limit, offset),
            ).fetchall()
        return [dict(row) for row in rows]


def get_messages(conversation_id: int, user_id: str) -> list[dict[str, Any]]:
    """Returns every message of a conversation owned by user_id."""
    with get_db() as conn:
        if not _owns(conn, conversation_id, user_id):
            return []
        rows = conn.execute(
            """
            SELECT id, conversation_id, role, content, feedback, created_at
            FROM messages
            WHERE conversation_id = ?
            ORDER BY id ASC
            """,
            (conversation_id,),
        ).fetchall()
        return [dict(row) for row in rows]


def get_recent_messages(
    conversation_id: int,
    user_id: str,
    limit: int,
) -> list[dict[str, Any]]:
    """Returns the last ``limit`` messages of a conversation, oldest first."""
    with get_db() as conn:
        if not _owns(conn, conversation_id, user_id):
            return []
        rows = conn.execute(
            """
            SELECT * FROM (
                SELECT id, conversation_id, role, content, created_at
                FROM messages
                WHERE conversation_id = ?
                ORDER BY id DESC
                LIMIT ?
            ) ORDER BY id ASC
            """,
            (conversation_id, limit),
        ).fetchall()
        return [dict(row) for row in rows]


def get_conversation_title(conversation_id: int, user_id: str) -> str | None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT title FROM conversations WHERE id = ? AND user_id = ?",
            (conversation_id, user_id),
        ).fetchone()
        return row["title"] if row else None


def conversation_exists(conversation_id: int, user_id: str) -> bool:
    """Checks whether a conversation exists and belongs to the user."""
    with get_db() as conn:
        return _owns(conn, conversation_id, user_id)


def _owns(conn: sqlite3.Connection, conversation_id: int, user_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM conversations WHERE id = ? AND user_id = ?",
        (conversation_id, user_id),
    ).fetchone()
    return row is not None


def delete_message(message_id: int, conversation_id: int, user_id: str) -> bool:
    """Deletes a single message, if the conversation belongs to user_id."""
    with get_db() as conn:
        if not _owns(conn, conversation_id, user_id):
            return False
        cursor = conn.execute(
            "DELETE FROM messages WHERE id = ? AND conversation_id = ?",
            (message_id, conversation_id),
        )
        return cursor.rowcount > 0


def delete_messages_from(conversation_id: int, message_id: int, user_id: str) -> bool:
    """Deletes a user message and everything that followed it.

    Used when a message is edited: the old question, the answer it received and
    every later turn are removed before the edited question is answered again,
    which keeps the stored transcript a single linear branch.
    """
    with get_db() as conn:
        if not _owns(conn, conversation_id, user_id):
            return False
        row = conn.execute(
            "SELECT role FROM messages WHERE id = ? AND conversation_id = ?",
            (message_id, conversation_id),
        ).fetchone()
        if row is None or row["role"] != "user":
            return False

        conn.execute(
            "DELETE FROM messages WHERE conversation_id = ? AND id >= ?",
            (conversation_id, message_id),
        )
        conn.execute(
            "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (conversation_id,),
        )
        return True


def set_message_feedback(
    conversation_id: int,
    message_id: int,
    user_id: str,
    feedback: str | None,
) -> bool:
    """Sets (or clears) the thumbs rating of an assistant message."""
    with get_db() as conn:
        if not _owns(conn, conversation_id, user_id):
            return False
        cursor = conn.execute(
            """
            UPDATE messages
            SET feedback = ?
            WHERE id = ? AND conversation_id = ? AND role = 'assistant'
            """,
            (feedback, message_id, conversation_id),
        )
        return cursor.rowcount > 0


def delete_conversation(conversation_id: int, user_id: str) -> bool:
    """Deletes a conversation owned by user_id (messages cascade)."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM conversations WHERE id = ? AND user_id = ?",
            (conversation_id, user_id),
        )
        return cursor.rowcount > 0


def delete_all_conversations(user_id: str) -> int:
    """Deletes every conversation owned by user_id.

    There is deliberately no "delete everything" branch: an unauthenticated or
    misconfigured caller must never be able to wipe other users' data.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM conversations WHERE user_id = ?", (user_id,))
        return cursor.rowcount


def export_conversation_markdown(conversation_id: int, user_id: str) -> str | None:
    """Exports a conversation as formatted markdown, if the user owns it."""
    with get_db() as conn:
        conv = conn.execute(
            "SELECT id, title, created_at FROM conversations WHERE id = ? AND user_id = ?",
            (conversation_id, user_id),
        ).fetchone()
    if not conv:
        return None

    messages = get_messages(conversation_id, user_id)
    md_lines = [
        f"# {conv['title']}",
        f"*Exported from NexusAI on {conv['created_at']}*",
        "",
        "---",
        "",
    ]

    for msg in messages:
        sender = "User" if msg["role"] == "user" else "NexusAI"
        md_lines.append(f"### {sender}")
        md_lines.append("")
        md_lines.append(msg["content"])
        md_lines.append("")

    return "\n".join(md_lines)
