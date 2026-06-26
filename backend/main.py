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

ADMIN_SECRET = os.getenv("ADMIN_SECRET", "ChinnuU07")

CHAT_ROOMS = [
    {
        "slug": "global",
        "name": "Global",
        "description": "Open finance discussion for markets, macro, and trades.",
    },
    {
        "slug": "crypto",
        "name": "Crypto",
        "description": "Bitcoin, altcoins, on-chain moves, and crypto news.",
    },
    {
        "slug": "nifty",
        "name": "Nifty",
        "description": "NIFTY, BANKNIFTY, Indian markets, and index action.",
    },
    {
        "slug": "gold",
        "name": "Gold",
        "description": "Gold, silver, commodities, and safe-haven positioning.",
    },
    {
        "slug": "oil",
        "name": "Oil",
        "description": "Crude oil, energy markets, and geopolitics.",
    },
]

FINANCE_KEYWORDS = [
    "stock", "stocks", "market", "markets", "nifty", "sensex", "banknifty",
    "gold", "silver", "oil", "crude", "brent", "wti", "bitcoin", "btc",
    "crypto", "forex", "usd", "inr", "rupee", "dollar", "bond", "bonds",
    "yield", "rate", "rates", "inflation", "fed", "fomc", "rbi", "earnings",
    "options", "futures", "economy", "recession", "bullish", "bearish",
    "macro", "geopolitics", "commodities", "trading", "trade"
]


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


def normalize_room_slug(room_slug):
    room_slug = (room_slug or "global").strip().lower()
    slugs = {room["slug"] for room in CHAT_ROOMS}
    return room_slug if room_slug in slugs else "global"


def is_finance_related(message: str) -> bool:
    text = (message or "").lower()
    return any(keyword in text for keyword in FINANCE_KEYWORDS)


create_database()


@app.route("/")
def home():
    return send_from_directory(str(FRONTEND_DIR), "index.html")

@app.route("/<path:filename>")
def serve_static(filename):
    # If the file exists in frontend, serve it
    if (FRONTEND_DIR / filename).exists():
        return send_from_directory(str(FRONTEND_DIR), filename)
    # If they hit /chat or /profile without .html
    if (FRONTEND_DIR / f"{filename}.html").exists():
        return send_from_directory(str(FRONTEND_DIR), f"{filename}.html")
    # Otherwise return 404 (or index.html)
    return "Not Found", 404


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


@app.route("/api/admin/refresh-news", methods=["POST", "GET"])
def refresh_news():
    # Support both Bearer token and ?secret= parameter
    auth_header = request.headers.get("Authorization", "")
    secret_param = request.args.get("secret", "")
    
    provided_secret = ""
    if auth_header.startswith("Bearer "):
        provided_secret = auth_header.split(" ")[1]
    elif secret_param:
        provided_secret = secret_param
        
    if not provided_secret or provided_secret != ADMIN_SECRET:
        return jsonify({"error": "Unauthorized"}), 401

    result = collect_news()
    
    if result.get("status") == "conflict":
        return jsonify(result), 409
        
    return jsonify(result), 200

# Keep the old endpoint for backwards compatibility, but secure it with the new secret
@app.route("/update-news")
def update_news():
    return refresh_news()


@app.route("/api/chat/rooms")
def api_chat_rooms():
    return jsonify({"rooms": CHAT_ROOMS})


@app.route("/api/chat/messages", methods=["GET", "POST"])
def api_chat_messages():
    if request.method == "GET":
        room = normalize_room_slug(request.args.get("room", "global"))
        limit = request.args.get("limit", 100, type=int)
        return jsonify({
            "room": room,
            "messages": get_messages(room_slug=room, limit=limit),
        })

    payload = request.get_json(silent=True) or {}
    room = normalize_room_slug(payload.get("room", "global"))
    username = (payload.get("username") or "Anonymous").strip()[:40] or "Anonymous"
    display_name = (payload.get("display_name") or username).strip()[:40] or username
    message = (payload.get("message") or "").strip()

    if not message:
        return jsonify({"error": "Message is required"}), 400

    if len(message) > 280:
        return jsonify({"error": "Message too long"}), 400


    saved = save_message(
        room_slug=room,
        username=username,
        display_name=display_name,
        message=message,
    )

    return jsonify({"message": saved}), 201


if __name__ == "__main__":
    create_database()
    app.run(debug=True)
