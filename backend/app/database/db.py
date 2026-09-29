import sqlite3
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[2]
DATABASE_PATH = BASE_DIR / "nexusai.db"


def get_connection():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    connection = get_connection()

    cursor = connection.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

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

    connection.commit()
    connection.close()


def create_conversation(title="New Chat"):
    connection = get_connection()

    cursor = connection.cursor()

    cursor.execute(
        """
        INSERT INTO conversations (title)
        VALUES (?)
        """,
        (title,),
    )

    conversation_id = cursor.lastrowid

    connection.commit()
    connection.close()

    return conversation_id


def update_conversation_title(conversation_id, title):
    connection = get_connection()

    connection.execute(
        """
        UPDATE conversations
        SET title = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (title, conversation_id),
    )

    connection.commit()
    connection.close()


def update_conversation_time(conversation_id):
    connection = get_connection()

    connection.execute(
        """
        UPDATE conversations
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (conversation_id,),
    )

    connection.commit()
    connection.close()


def add_message(conversation_id, role, content):
    connection = get_connection()

    connection.execute(
        """
        INSERT INTO messages (
            conversation_id,
            role,
            content
        )
        VALUES (?, ?, ?)
        """,
        (conversation_id, role, content),
    )

    connection.commit()
    connection.close()

    update_conversation_time(conversation_id)


def get_conversations():
    connection = get_connection()

    rows = connection.execute(
        """
        SELECT id, title, created_at, updated_at
        FROM conversations
        ORDER BY updated_at DESC
        """
    ).fetchall()

    connection.close()

    return [dict(row) for row in rows]


def get_messages(conversation_id):
    connection = get_connection()

    rows = connection.execute(
        """
        SELECT id, role, content, created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY id ASC
        """,
        (conversation_id,),
    ).fetchall()

    connection.close()

    return [dict(row) for row in rows]


def conversation_exists(conversation_id):
    connection = get_connection()

    row = connection.execute(
        """
        SELECT id
        FROM conversations
        WHERE id = ?
        """,
        (conversation_id,),
    ).fetchone()

    connection.close()

    return row is not None

def delete_conversation(conversation_id):
    connection = get_connection()

    connection.execute(
        """
        DELETE FROM messages
        WHERE conversation_id = ?
        """,
        (conversation_id,),
    )

    connection.execute(
        """
        DELETE FROM conversations
        WHERE id = ?
        """,
        (conversation_id,),
    )

    connection.commit()
    connection.close()