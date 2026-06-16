from flask import Flask
from flask_cors import CORS
from backend.database import get_articles
from backend.market_data import get_market_data
import json

app = Flask(__name__)
CORS(app
)

@app.route("/")
def home():

    return {
        "message": "News By AI API Running"
    }

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


if __name__ == "__main__":
    app.run(debug=True)
