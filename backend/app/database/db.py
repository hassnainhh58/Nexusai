import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Generator

BASE_DIR = Path(__file__).resolve().parents[2]
DATABASE_PATH = BASE_DIR / "nexusai.db"


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """
    Context manager for database connections.
    Enforces WAL mode, foreign keys, row factory, and transaction safety.
    """
    connection = sqlite3.connect(
        DATABASE_PATH,
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


def get_connection() -> sqlite3.Connection:
    """Legacy helper for backward compatibility."""
    conn = sqlite3.connect(DATABASE_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def init_db() -> None:
    """
    Initializes database tables, runs non-destructive migrations,
    and creates performance indexes.
    """
    with get_db() as conn:
        cursor = conn.cursor()

        # 1. Base conversations table
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                user_id TEXT NOT NULL DEFAULT 'default',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        # 2. Migration: Ensure user_id column exists if table existed previously without it
        cursor.execute("PRAGMA table_info(conversations);")
        columns = [row["name"] for row in cursor.fetchall()]
        if "user_id" not in columns:
            cursor.execute(
                "ALTER TABLE conversations ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default';"
            )

        # 3. Base messages table
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id)
                    REFERENCES conversations(id)
                    ON DELETE CASCADE
            )
            """
        )

        # 4. Performance Indexes
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
            ON messages(conversation_id);
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
            ON conversations(user_id, updated_at DESC);
            """
        )


def create_conversation(title: str = "New Chat", user_id: str = "default") -> int:
    """Creates a new conversation scoped by user_id."""
    clean_title = (title or "New Chat").strip()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO conversations (title, user_id)
            VALUES (?, ?)
            """,
            (clean_title, user_id),
        )
        return cursor.lastrowid


def update_conversation_title(
    conversation_id: int, title: str, user_id: str = "default"
) -> bool:
    """Updates the conversation title if it exists and belongs to user_id."""
    clean_title = title.strip()
    with get_db() as conn:
        cursor = conn.cursor()
        if user_id == "default":
            cursor.execute(
                """
                UPDATE conversations
                SET title = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (clean_title, conversation_id),
            )
        else:
            cursor.execute(
                """
                UPDATE conversations
                SET title = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND (user_id = ? OR user_id = 'default')
                """,
                (clean_title, conversation_id, user_id),
            )
        return cursor.rowcount > 0


def update_conversation_time(conversation_id: int) -> None:
    """Updates updated_at timestamp on the conversation."""
    with get_db() as conn:
        conn.execute(
            """
            UPDATE conversations
            SET updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (conversation_id,),
        )


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
        msg_id = cursor.lastrowid

        cursor.execute(
            """
            UPDATE conversations
            SET updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (conversation_id,),
        )
        return msg_id


def get_conversations(user_id: str = "default") -> list[dict[str, Any]]:
    """Retrieves all conversations for a user ordered by most recently updated."""
    with get_db() as conn:
        if user_id == "default":
            rows = conn.execute(
                """
                SELECT id, title, user_id, created_at, updated_at
                FROM conversations
                ORDER BY updated_at DESC
                """
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, title, user_id, created_at, updated_at
                FROM conversations
                WHERE user_id = ? OR user_id = 'default'
                ORDER BY updated_at DESC
                """,
                (user_id,),
            ).fetchall()
        return [dict(row) for row in rows]


def get_messages(
    conversation_id: int, user_id: str = "default"
) -> list[dict[str, Any]]:
    """Retrieves all messages for a specific conversation."""
    with get_db() as conn:
        # Verify ownership if user_id is provided
        if user_id != "default":
            owner = conn.execute(
                "SELECT id FROM conversations WHERE id = ? AND (user_id = ? OR user_id = 'default')",
                (conversation_id, user_id),
            ).fetchone()
            if not owner:
                return []

        rows = conn.execute(
            """
            SELECT id, conversation_id, role, content, created_at
            FROM messages
            WHERE conversation_id = ?
            ORDER BY id ASC
            """,
            (conversation_id,),
        ).fetchall()
        return [dict(row) for row in rows]


def conversation_exists(conversation_id: int, user_id: str = "default") -> bool:
    """Checks whether a conversation exists and belongs to the specified user."""
    with get_db() as conn:
        if user_id == "default":
            row = conn.execute(
                "SELECT id FROM conversations WHERE id = ?",
                (conversation_id,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM conversations WHERE id = ? AND (user_id = ? OR user_id = 'default')",
                (conversation_id, user_id),
            ).fetchone()
        return row is not None


def delete_conversation(conversation_id: int, user_id: str = "default") -> bool:
    """Deletes a conversation and all its cascade-associated messages."""
    with get_db() as conn:
        cursor = conn.cursor()
        if user_id == "default":
            cursor.execute("DELETE FROM messages WHERE conversation_id = ?", (conversation_id,))
            cursor.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
        else:
            owner = cursor.execute(
                "SELECT id FROM conversations WHERE id = ? AND (user_id = ? OR user_id = 'default')",
                (conversation_id, user_id),
            ).fetchone()
            if not owner:
                return False
            cursor.execute("DELETE FROM messages WHERE conversation_id = ?", (conversation_id,))
            cursor.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
        return cursor.rowcount > 0


def delete_all_conversations(user_id: str = "default") -> int:
    """Deletes all conversations for a user."""
    with get_db() as conn:
        cursor = conn.cursor()
        if user_id == "default":
            cursor.execute("DELETE FROM messages;")
            cursor.execute("DELETE FROM conversations;")
        else:
            cursor.execute(
                """
                DELETE FROM messages WHERE conversation_id IN (
                    SELECT id FROM conversations WHERE user_id = ?
                )
                """,
                (user_id,),
            )
            cursor.execute("DELETE FROM conversations WHERE user_id = ?", (user_id,))
        return cursor.rowcount


def export_conversation_markdown(conversation_id: int, user_id: str = "default") -> str | None:
    """Exports a conversation as formatted markdown text."""
    with get_db() as conn:
        conv = conn.execute(
            "SELECT id, title, created_at FROM conversations WHERE id = ?",
            (conversation_id,),
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