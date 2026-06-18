import json
import sqlite3
from datetime import datetime
from pathlib import Path

DATABASE_PATH = Path("database/news.db")


def _connect():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _utc_now_text():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _safe_json_loads(value, default):
    if value is None:
        return default
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return default


def _ensure_news_columns(conn):
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(news)")
    columns = {row[1] for row in cursor.fetchall()}

    if "analysis" not in columns:
        cursor.execute("ALTER TABLE news ADD COLUMN analysis TEXT DEFAULT ''")
    if "added_at" not in columns:
        cursor.execute("ALTER TABLE news ADD COLUMN added_at TEXT DEFAULT ''")


def _ensure_chat_columns(conn):
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(chat_messages)")
    columns = {row[1] for row in cursor.fetchall()}

    if "room_slug" not in columns:
        cursor.execute("ALTER TABLE chat_messages ADD COLUMN room_slug TEXT DEFAULT 'global'")
    if "display_name" not in columns:
        cursor.execute("ALTER TABLE chat_messages ADD COLUMN display_name TEXT DEFAULT 'Anonymous'")
    if "created_at" not in columns:
        cursor.execute("ALTER TABLE chat_messages ADD COLUMN created_at TEXT DEFAULT ''")


def create_database():
    Path("database").mkdir(exist_ok=True)

    conn = _connect()
    cursor = conn.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            link TEXT UNIQUE,
            category TEXT,
            sentiment TEXT,
            importance INTEGER,
            market_impact TEXT,
            assets TEXT,
            directions TEXT,
            confidence INTEGER,
            time_horizon TEXT,
            analysis TEXT DEFAULT '',
            added_at TEXT DEFAULT ''
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_slug TEXT NOT NULL DEFAULT 'global',
            username TEXT NOT NULL,
            display_name TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )

    _ensure_news_columns(conn)
    _ensure_chat_columns(conn)

    conn.commit()
    conn.close()


def save_article(
    title,
    link,
    category=None,
    sentiment=None,
    importance=None,
    market_impact=None,
    assets=None,
    directions=None,
    confidence=None,
    time_horizon=None,
    analysis=None,
    added_at=None,
):
    create_database()

    conn = _connect()
    cursor = conn.cursor()

    try:
        cursor.execute(
            """
            INSERT INTO news
            (
                title,
                link,
                category,
                sentiment,
                importance,
                market_impact,
                assets,
                directions,
                confidence,
                time_horizon,
                analysis,
                added_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                title,
                link,
                category,
                sentiment,
                importance,
                market_impact,
                json.dumps(assets or []),
                json.dumps(directions or {}),
                confidence,
                time_horizon,
                analysis or "",
                added_at or "",
            ),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        pass
    finally:
        conn.close()


def get_articles():
    create_database()

    conn = _connect()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM news ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()

    articles = []
    for row in rows:
        articles.append(
            {
                "id": row["id"],
                "title": row["title"],
                "link": row["link"],
                "category": row["category"],
                "sentiment": row["sentiment"],
                "importance": row["importance"],
                "market_impact": row["market_impact"],
                "assets": _safe_json_loads(row["assets"], []),
                "directions": _safe_json_loads(row["directions"], {}),
                "confidence": row["confidence"],
                "time_horizon": row["time_horizon"],
                "analysis": row["analysis"],
                "added_at": row["added_at"],
            }
        )
    return articles


def save_message(room_slug, username, display_name, message):
    create_database()

    room_slug = (room_slug or "global").strip() or "global"
    username = (username or "Anonymous").strip()[:40] or "Anonymous"
    display_name = (display_name or username).strip()[:40] or username
    message = (message or "").strip()

    if not message:
        return None

    conn = _connect()
    cursor = conn.cursor()
    created_at = _utc_now_text()

    cursor.execute(
        """
        INSERT INTO chat_messages
        (room_slug, username, display_name, message, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (room_slug, username, display_name, message, created_at),
    )
    conn.commit()

    cursor.execute("SELECT * FROM chat_messages WHERE id = ?", (cursor.lastrowid,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return None

    return {
        "id": row["id"],
        "room_slug": row["room_slug"],
        "username": row["username"],
        "display_name": row["display_name"],
        "message": row["message"],
        "created_at": row["created_at"],
    }


def get_messages(room_slug="global", limit=100):
    create_database()

    room_slug = (room_slug or "global").strip() or "global"

    conn = _connect()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT *
        FROM chat_messages
        WHERE room_slug = ?
        ORDER BY id DESC
        LIMIT ?
        """,
        (room_slug, int(limit)),
    )
    rows = cursor.fetchall()
    conn.close()

    messages = []
    for row in reversed(rows):
        messages.append(
            {
                "id": row["id"],
                "room_slug": row["room_slug"],
                "username": row["username"],
                "display_name": row["display_name"],
                "message": row["message"],
                "created_at": row["created_at"],
            }
        )
    return messages
