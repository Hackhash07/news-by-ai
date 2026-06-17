from datetime import datetime, timezone

from backend.news_analyzer import classify_article


def classify_market_impact(category, sentiment, importance, assets):

    category = str(category or "").lower()

    if category == "geopolitics":
        if sentiment == "Negative" and importance >= 7:
            return "High Volatility"
        return "Neutral"

    if category == "finance":
        if sentiment == "Positive":
            return "Bullish"
        if sentiment == "Negative":
            return "Bearish"
        return "Neutral"

    if category == "technology":
        return "Neutral"

    return "Neutral"


def build_analysis_paragraph(title, category, sentiment, assets, directions, confidence):

    asset_text = ", ".join(assets) if assets else "broader markets"

    direction_text = (
        ", ".join([f"{k}: {v}" for k, v in (directions or {}).items()])
        if directions else "no strong directional bias"
    )

    return (
        f"This news may impact {asset_text}. "
        f"It is classified as {sentiment} with confidence {confidence}%. "
        f"Directional signals: {direction_text}. "
        f"Traders should watch follow-up price action for confirmation."
    )


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def build_intelligence(title):
    analysis = classify_article(title)

    category = analysis["category"]
    sentiment = analysis["sentiment"]
    importance = analysis["importance"]

    assets = []
    directions = {}
    confidence = 70

    market_impact = classify_market_impact(
        category, sentiment, importance, assets
    )

    return {
        "category": category,
        "sentiment": sentiment,
        "importance": importance,
        "market_impact": market_impact,
        "assets": assets,
        "directions": directions,
        "confidence": confidence,
        "analysis": build_analysis_paragraph(
            title,
            category,
            sentiment,
            assets,
            directions,
            confidence
        ),
        "time_horizon": "Unknown",
        "added_at": now_iso()
    }
