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
        return "Neutral"

    if any(a in assets for a in ["gold", "crude oil", "defense stocks"]):
        if sentiment == "negative":
            return "High Volatility"

    if importance <= 4:
        return "Low Impact"

    return "Neutral"


def build_analysis_paragraph(title, category, sentiment, assets, directions, confidence):
    asset_text = ", ".join(assets) if assets else "broader markets"
    direction_text = ", ".join(
        [f"{k}: {v}" for k, v in (directions or {}).items()]
    ) if directions else "no clear directional bias"

    lead = (
        "This news may influence short-term market sentiment and risk appetite. "
        if category == "Geopolitics"
        else "This development could impact market positioning and trader sentiment. "
    )

    middle = (
        f"The event is classified as {sentiment} with {confidence}% confidence, "
        f"suggesting moderate reliability of this signal. "
    )

    last = (
        f"Key exposed assets include {asset_text}. "
        f"Directional bias shows {direction_text}. "
        "Traders should monitor follow-up news and price confirmation."
    )

    return lead + middle + last


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def build_intelligence(title):
    analysis = classify_article(title)

    assets = map_assets(
        analysis["category"],
        analysis.get("market_impact", "Neutral")
    )

    directions = determine_direction(
        analysis["category"],
        analysis["sentiment"]
    )

    confidence = calculate_confidence(
        analysis["importance"],
        analysis["sentiment"],
        analysis["category"]
    )

    time_horizon = estimate_horizon(
        analysis["category"],
        analysis["importance"]
    )

    analysis_text = build_analysis_paragraph(
        title,
        analysis["category"],
        analysis["sentiment"],
        assets,
        directions,
        confidence
    )

    return {
        "category": analysis["category"],
        "sentiment": analysis["sentiment"],
        "importance": analysis["importance"],
        "market_impact": classify_market_impact(
            analysis["category"],
            analysis["sentiment"],
            analysis["importance"],
            assets
        ),
        "assets": assets,
        "directions": directions,
        "confidence": confidence,
        "time_horizon": time_horizon,

        # 🔥 NEW IMPORTANT FIELDS
        "analysis": analysis_text,
        "added_at": now_iso()
    }
