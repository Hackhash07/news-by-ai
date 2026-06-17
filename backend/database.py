import sqlite3
import json
from pathlib import Path

DATABASE_PATH = "database/news.db"


def create_database():
    Path("database").mkdir(exist_ok=True)

    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    cursor.execute("""
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
    """)

    cursor.execute("PRAGMA table_info(news)")
    columns = {row[1] for row in cursor.fetchall()}

    if "analysis" not in columns:
        cursor.execute("ALTER TABLE news ADD COLUMN analysis TEXT DEFAULT ''")

    if "added_at" not in columns:
        cursor.execute("ALTER TABLE news ADD COLUMN added_at TEXT DEFAULT ''")

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
    added_at=None
):
    create_database()

    conn = sqlite3.connect(DATABASE_PATH)
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
                added_at or ""
            )
        )
        conn.commit()

    except sqlite3.IntegrityError:
        pass

    conn.close()


def get_articles():
    create_database()

    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM news ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()
    return rows
