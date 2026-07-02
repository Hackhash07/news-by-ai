import json
import os
import threading
import logging
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from backend.database import (
    create_database, get_articles, get_messages, save_message,
    vote_on_news, update_profile_stats, update_profile_streak,
    get_top_recent_news, save_morning_brief, get_morning_brief
)
from backend.market_data import get_market_data
from backend.market_ticker import get_ticker_data
from backend.news_collector import collect_news
from backend.openrouter_client import generate_morning_brief

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
CORS(app)

logger = logging.getLogger(__name__)

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

@app.route('/api/market-ticker', methods=['GET'])
def market_ticker():
    try:
        data = get_ticker_data()
        return jsonify(data), 200
    except Exception as e:
        logger.error(f"Market ticker endpoint error: {e}")
        return jsonify({"error": "Failed to fetch ticker data"}), 500


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
            "structured_analysis": safe_json_loads(row.get("structured_analysis"), {}),
            "added_at": row["added_at"],
            "bullish_votes": row.get("bullish_votes") or 0,
            "bearish_votes": row.get("bearish_votes") or 0,
        })

    try:
        from backend.database import supabase
        response = supabase.table("signal_outcomes").select("news_id, ticker, outcome_1h").execute()
        if response.data:
            outcomes = {}
            for row in response.data:
                nid = row.get("news_id")
                if nid not in outcomes:
                    outcomes[nid] = {}
                outcomes[nid][row.get("ticker")] = row.get("outcome_1h")
                
            for article in articles:
                nid = article.get("id")
                if nid in outcomes and "structured_analysis" in article and "affected_assets" in article["structured_analysis"]:
                    for asset in article["structured_analysis"]["affected_assets"]:
                        ticker = asset.get("ticker")
                        if ticker in outcomes[nid]:
                            asset["outcome_1h"] = outcomes[nid][ticker]
    except Exception as e:
        print(f"Error attaching signal outcomes to news feed: {e}")

    return jsonify(articles)


# Initialize APScheduler for background jobs
# WARNING: Render free tier spins down after 15 minutes of inactivity.
# The APScheduler will die with it. To prevent this, either upgrade to a paid 
# Render instance, or keep pinging the /update-news POST endpoint via an external 
# cron job (like cron-job.org) to keep the dyno awake.
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from datetime import datetime
from backend.outcome_tracker import fetch_and_fill_outcomes

scheduler = BackgroundScheduler()
scheduler.add_job(
    func=collect_news,
    trigger=IntervalTrigger(minutes=30),
    id='news_collection_job',
    name='Collect and analyze news every 30 minutes',
    replace_existing=True,
    max_instances=1
)
scheduler.add_job(
    func=fetch_and_fill_outcomes,
    trigger=IntervalTrigger(hours=1),
    id='outcome_tracker_job',
    name='Fetch yfinance data and fill backtest outcomes',
    replace_existing=True,
    max_instances=1
)
scheduler.start()

@app.route("/api/admin/refresh-news", methods=["POST", "GET"])
def refresh_news():
    auth_header = request.headers.get("Authorization", "")
    secret_param = request.args.get("secret", "")
    
    provided_secret = ""
    if auth_header.startswith("Bearer "):
        provided_secret = auth_header.split(" ")[1]
    elif secret_param:
        provided_secret = secret_param
        
    if not provided_secret or provided_secret != ADMIN_SECRET:
        return jsonify({"error": "Unauthorized"}), 401

    # Trigger job manually using a background thread (so we don't mess with APScheduler's internal clock)
    def background_task():
        try:
            collect_news(force=True)
        except Exception as e:
            print(f"Error in background news collection: {e}")

    import threading
    thread = threading.Thread(target=background_task)
    thread.start()
    
    return jsonify({"status": "triggered", "message": "News collection started in background thread"}), 202

# Keep the old endpoint for backwards compatibility, but secure it with the new secret
@app.route("/update-news")
def update_news():
    return refresh_news()

@app.route("/api/admin/refresh-outcomes", methods=["POST", "GET"])
def refresh_outcomes():
    auth_header = request.headers.get("Authorization", "")
    secret_param = request.args.get("secret", "")
    
    provided_secret = ""
    if auth_header.startswith("Bearer "):
        provided_secret = auth_header.split(" ")[1]
    elif secret_param:
        provided_secret = secret_param
        
    if not provided_secret or provided_secret != ADMIN_SECRET:
        return jsonify({"error": "Unauthorized"}), 401

    def background_task():
        try:
            fetch_and_fill_outcomes()
        except Exception as e:
            print(f"Error in background outcome tracking: {e}")

    import threading
    thread = threading.Thread(target=background_task)
    thread.start()
    
    return jsonify({"status": "triggered", "message": "Outcome tracking started in background thread"}), 202

@app.route("/update-outcomes")
def update_outcomes():
    return refresh_outcomes()

@app.route("/api/signal-accuracy")
def api_signal_accuracy():
    try:
        from backend.database import supabase
        response = supabase.table("signal_outcomes").select("outcome_1h").execute()
        
        if not response.data:
            return jsonify({"error": "No signals tracked yet"}), 404
            
        total = len(response.data)
        correct = len([r for r in response.data if r.get("outcome_1h") == "Correct"])
        incorrect = len([r for r in response.data if r.get("outcome_1h") == "Incorrect"])
        neutral = len([r for r in response.data if r.get("outcome_1h") == "Neutral"])
        
        accuracy = (correct / (correct + incorrect)) if (correct + incorrect) > 0 else 0
        
        return jsonify({
            "total_signals": total,
            "evaluated_signals": correct + incorrect,
            "accuracy_1h": round(accuracy, 3),
            "correct": correct,
            "incorrect": incorrect,
            "neutral": neutral
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/admin/signal-debug")
def api_signal_debug():
    secret_param = request.args.get("secret", "")
    if secret_param != ADMIN_SECRET:
        return jsonify({"error": "Unauthorized"}), 401
    try:
        from backend.database import supabase
        response = supabase.table("signal_outcomes").select("id, ticker, signal_direction, confidence, signal_timestamp, price_at_signal, price_1h_after, outcome_1h").order("signal_timestamp", desc=True).limit(30).execute()
        return jsonify({"signals": response.data})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/admin/evaluate-signals", methods=["POST", "GET"])
def api_evaluate_signals():
    secret_param = request.args.get("secret", "")
    auth_header = request.headers.get("Authorization", "")
    provided_secret = ""
    if auth_header.startswith("Bearer "):
        provided_secret = auth_header.split(" ")[1]
    elif secret_param:
        provided_secret = secret_param
    if not provided_secret or provided_secret != ADMIN_SECRET:
        return jsonify({"error": "Unauthorized"}), 401

    def background_eval():
        try:
            fetch_and_fill_outcomes()
        except Exception as e:
            logger.error(f"Error in background signal evaluation: {e}")

    import threading
    thread = threading.Thread(target=background_eval)
    thread.start()
    return jsonify({"status": "triggered", "message": "Signal evaluation started in background"}), 202

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

@app.route("/api/news/<int:news_id>/vote", methods=["POST"])
def api_news_vote(news_id):
    payload = request.get_json(silent=True) or {}
    vote = payload.get("vote")
    user_id = payload.get("user_id")
    if not vote or vote not in ['bullish', 'bearish'] or not user_id:
        return jsonify({"error": "Invalid payload"}), 400
    
    result = vote_on_news(news_id, user_id, vote)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)

@app.route("/api/profile/update-stats", methods=["POST"])
def api_update_stats():
    payload = request.get_json(silent=True) or {}
    user_id = payload.get("user_id")
    won = payload.get("won")
    new_elo = payload.get("new_elo")
    if not user_id or new_elo is None:
        return jsonify({"error": "Invalid payload"}), 400
        
    success = update_profile_stats(user_id, won, new_elo)
    return jsonify({"success": success})

@app.route("/api/profile/streak", methods=["PATCH"])
def api_update_streak():
    payload = request.get_json(silent=True) or {}
    user_id = payload.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
        
    result = update_profile_streak(user_id)
    if not result:
        return jsonify({"error": "Failed to update streak"}), 500
    return jsonify(result)

@app.route("/api/admin/morning-brief", methods=["POST", "GET"])
def api_morning_brief():

    secret_param = request.args.get("secret", "")
    
    provided_secret = ""
    if auth_header.startswith("Bearer "):
        provided_secret = auth_header.split(" ")[1]
    elif secret_param:
        provided_secret = secret_param
        
    if not provided_secret or provided_secret != ADMIN_SECRET:
        return jsonify({"error": "Unauthorized"}), 401

    top_news = get_top_recent_news(hours=18, limit=5)
    if not top_news:
        return jsonify({"error": "No recent news found"}), 404
        
    brief = generate_morning_brief(top_news)
    if not brief or "error" in brief:
        return jsonify({"error": "Failed to generate brief"}), 500
        
    from datetime import datetime
    today_str = datetime.utcnow().date().isoformat()
    
    success = save_morning_brief(
        today_str, 
        brief.get("headline"), 
        brief.get("summary"), 
        brief.get("top_assets", []), 
        brief.get("overall_sentiment")
    )
    
    if not success:
        return jsonify({"error": "Failed to save brief to database"}), 500
        
    return jsonify(brief), 200

@app.route("/api/daily-brief")
def api_get_daily_brief():
    from datetime import datetime
    today_str = datetime.utcnow().date().isoformat()
    brief = get_morning_brief(today_str)
    if not brief:
        return jsonify({"error": "No brief found for today"}), 404
        
    try:
        from backend.database import supabase
        response = supabase.table("signal_outcomes").select("news_id, ticker, outcome_1h").execute()
        if response.data:
            outcomes = {}
            for row in response.data:
                nid = row.get("news_id")
                if nid not in outcomes:
                    outcomes[nid] = {}
                outcomes[nid][row.get("ticker")] = row.get("outcome_1h")
                
            for article in brief.get("articles", []):
                nid = article.get("id")
                if nid in outcomes and "structured_analysis" in article and "affected_assets" in article["structured_analysis"]:
                    for asset in article["structured_analysis"]["affected_assets"]:
                        ticker = asset.get("ticker")
                        if ticker in outcomes[nid]:
                            asset["outcome_1h"] = outcomes[nid][ticker]
    except Exception as e:
        print(f"Error attaching signal outcomes: {e}")
        
    return jsonify(brief)




if __name__ == "__main__":
    create_database()
    app.run(debug=True)
