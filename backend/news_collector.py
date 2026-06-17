from datetime import datetime, timezone

from backend.news_analyzer import classify_article
from backend.asset_mapper import map_assets
from backend.impact_engine import determine_direction
from backend.confidence_engine import calculate_confidence
from backend.time_engine import estimate_horizon


def classify_market_impact(category, sentiment, importance, assets):
    category = str(category or "").lower()
    sentiment = str(sentiment or "").lower()
    assets = [str(a).lower() for a in (assets or [])]

    if category == "geopolitics":
        if sentiment == "negative" and importance >= 7:
            return "High Volatility"
        if importance >= 8:
            return "High Volatility"
        return "Neutral"

    if category == "finance":
        if sentiment == "positive":
            return "Bullish"
        if sentiment == "negative":
            return "Bearish"
        return "Neutral"

    if category == "technology":
        if sentiment == "positive":
            return "Bullish"
        if sentiment == "negative":
            return "Bearish"
        return "Neutral"

    if any(a in assets for a in ["gold", "crude oil", "defense stocks"]):
        if sentiment == "negative":
            return "High Volatility"
        return "Neutral"

    if importance <= 4:
        return "Low Impact"

    return "Neutral"


def build_analysis_paragraph(title, category, sentiment, assets, directions, confidence):
    asset_text = ", ".join(assets) if assets else "broader markets"
    direction_text = (
        ", ".join([f"{k}: {v}" for k, v in (directions or {}).items()])
        if directions
        else "no strong directional bias"
    )

    if category == "Geopolitics":
        opening = "This geopolitical development could influence global risk sentiment and safe-haven demand."
    elif category == "Finance":
        opening = "This financial headline may affect liquidity expectations, rates, and trader positioning."
    elif category == "Technology":
        opening = "This technology-related headline may impact growth stocks and innovation sentiment."
    else:
        opening = "This news may affect broader markets indirectly through sentiment and expectations."

    middle = f"The current sentiment assessment is {sentiment.lower()} with a confidence score of {confidence}%."

    ending = (
        f"Key exposed assets include {asset_text}. "
        f"Directional signals suggest {direction_text}. "
        "Traders should watch follow-up headlines and price action for confirmation."
    )

    return f"{opening} {middle} {ending}"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def build_intelligence(title):
    analysis = classify_article(title)

    category = analysis["category"]
    sentiment = analysis["sentiment"]
    importance = analysis["importance"]

    assets = map_assets(category, analysis.get("market_impact", "Neutral"))
    directions = determine_direction(category, sentiment)
    confidence = calculate_confidence(importance, sentiment, category)
    time_horizon = estimate_horizon(category, importance)

    market_impact = classify_market_impact(
        category,
        sentiment,
        importance,
        assets
    )

    ai_analysis = build_analysis_paragraph(
        title,
        category,
        sentiment,
        assets,
        directions,
        confidence
    )

    return {
        "category": category,
        "sentiment": sentiment,
        "importance": importance,
        "market_impact": market_impact,
        "assets": assets,
        "directions": directions,
        "confidence": confidence,
        "time_horizon": time_horizon,
        "analysis": ai_analysis,
        "added_at": now_iso()
    }
