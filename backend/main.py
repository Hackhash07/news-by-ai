import json
import os
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from backend.database import create_database, get_articles, get_messages, save_message
from backend.market_data import get_market_data
from backend.news_collector import collect_news

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
CORS(app)

UPDATE_SECRET = os.getenv("UPDATE_SECRET", "changeme")


def safe_json_loads(value, default):
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


FINANCE_KEYWORDS = [
    "stock", "stocks", "market", "markets", "nifty", "sensex", "banknifty",
    "gold", "silver", "oil", "crude", "brent", "wti", "bitcoin", "btc",
    "crypto", "forex", "usd", "inr", "rupee", "dollar", "bond", "bonds",
    "yield", "rate", "rates", "inflation", "fed", "fomc", "rbi", "earnings",
    "options", "futures", "economy", "recession", "bullish", "bearish"
]


def is_finance_related(message: str) -> bool:
    text = (message or "").lower()
    return any(keyword in text for keyword in FINANCE_KEYWORDS)


create_database()


@app.route("/")
def home():
    return send_from_directory(str(FRONTEND_DIR), "index.html")


@app.route("/chat")
def chat_page():
    return send_from_directory(str(FRONTEND_DIR), "chat.html")


@app.route("/admin")
def admin():
    return send_from_directory(str(FRONTEND_DIR), "admin.html")


@app.route("/style.css")
def style():
    return send_from_directory(str(FRONTEND_DIR), "style.css")


@app.route("/app.js")
def script():
    return send_from_directory(str(FRONTEND_DIR), "app.js")


@app.route("/chat.js")
def chat_script():
    return send_from_directory(str(FRONTEND_DIR), "chat.js")


@app.route("/market-data")
def market_data():
    return jsonify(get_market_data())


@app.route("/news")
def news():
    rows = get_articles()
    articles = []

    for row in rows:
        articles.append({
            "id": row["id"],
            "title": row["title"],
            "link": row["link"],
            "category": row["category"],
            "sentiment": row["sentiment"],
            "importance": row["importance"],
            "market_impact": row["market_impact"],
            "assets": safe_json_loads(row["assets"], []),
            "directions": safe_json_loads(row["directions"], {}),
            "confidence": row["confidence"],
            "time_horizon": row["time_horizon"],
            "analysis": row["analysis"],
            "added_at": row["added_at"],
        })

    return jsonify(articles)


@app.route("/update-news")
def update_news():
    key = request.args.get("key", "")
    if key != UPDATE_SECRET:
        return jsonify({"error": "Unauthorized"}), 401

    collect_news()
    return jsonify({"status": "updated", "articles": len(get_articles())})


@app.route("/api/chat/messages", methods=["GET", "POST"])
def api_chat_messages():
    if request.method == "GET":
        limit = request.args.get("limit", 100, type=int)
        return jsonify({"messages": get_messages(limit=limit)})

    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "Anonymous").strip()[:40] or "Anonymous"
    display_name = (payload.get("display_name") or username).strip()[:40] or username
    message = (payload.get("message") or "").strip()

    if not message:
        return jsonify({"error": "Message is required"}), 400

    if len(message) > 280:
        return jsonify({"error": "Message too long"}), 400

    if not is_finance_related(message):
        return jsonify({
            "error": "Finance-related messages only. Mention markets, stocks, crypto, gold, oil, rates, or macro topics."
        }), 400

    saved = save_message(username=username, display_name=display_name, message=message)
    return jsonify({"message": saved}), 201


if __name__ == "__main__":
    create_database()
    app.run(debug=True)
