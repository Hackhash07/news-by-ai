from flask import Flask, send_from_directory
from flask_cors import CORS
from backend.database import get_articles
from backend.news_collector import collect_news
from backend.market_data import get_market_data
import json

app = Flask(__name__)
CORS(app
)

@app.route("/")
def frontend():

    return send_from_directory(
        "../frontend",
        "index.html"
    )
@app.route("/style.css")
def style():

    return send_from_directory(
        "../frontend",
        "style.css"
    )


@app.route("/app.js")
def script():

    return send_from_directory(
        "../frontend",
        "app.js"
    )
@app.route("/market-data")
def market_data():

    return get_market_data()

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
            "assets": json.loads(row[7]),
            "directions": json.loads(row[8]),
            "confidence": row[9],
            "time_horizon": row[10]
        })

    return articles
@app.route("/update-news")
def update_news():
    collect_news()
    return {"status":"updated"}

if __name__ == "__main__":
    app.run(debug=True)
