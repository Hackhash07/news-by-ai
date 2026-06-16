import sqlite3
import json

DATABASE_PATH = "database/news.db"


def create_database():

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
    time_horizon TEXT
)
""")
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
    time_horizon=None
):

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
                time_horizon
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                title,
                link,
                category,
                sentiment,
                importance,
                market_impact,
                json.dumps(assets),
                json.dumps(directions),
                confidence,
                time_horizon
            )
        )

        conn.commit()

    except sqlite3.IntegrityError:

        pass

    conn.close()

def get_articles():

    conn = sqlite3.connect(DATABASE_PATH)

    cursor = conn.cursor()

    cursor.execute("SELECT * FROM news")

    rows = cursor.fetchall()

    conn.close()

    return rows
