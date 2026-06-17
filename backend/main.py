import json
from pathlib import Path

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS

from backend.database import get_articles
from backend.market_data import get_market_data
from backend.news_collector import collect_news

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"

app = Flask(__name__)
CORS(app)


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


@app.route("/")
def home():
    return send_from_directory(str(FRONTEND_DIR), "index.html")


@app.route("/style.css")
def style():
    return send_from_directory(str(FRONTEND_DIR), "style.css")


@app.route("/app.js")
def script():
    return send_from_directory(str(FRONTEND_DIR), "app.js")


@app.route("/market-data")
def market_data():
    return jsonify(get_market_data())


@app.route("/news")
def news():
    rows = get_articles()
    articles = []

    for row in rows:
        articles.append({
            "id": row[0],
            "title": row[1],
            "link": row[2],
            "category": row[3],
            "sentiment": row[4],
            "importance": row[5],
            "market_impact": row[6],
            "assets": safe_json_loads(row[7], []),
            "directions": safe_json_loads(row[8], {}),
            "confidence": row[9],
            "time_horizon": row[10] if len(row) > 10 else "Unknown",
            "analysis": row[11] if len(row) > 11 else "",
            "added_at": row[12] if len(row) > 12 else "",
        })

    return jsonify(articles)


@app.route("/update-news")
def update_news():
    collect_news()
    return jsonify({"status": "updated"})


if __name__ == "__main__":
    app.run(debug=True)
