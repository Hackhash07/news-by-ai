from backend.news_analyzer import classify_article
from backend.asset_mapper import map_assets
from backend.impact_engine import determine_direction
from backend.confidence_engine import calculate_confidence
from backend.time_engine import estimate_horizon

def build_intelligence(title):

    analysis = classify_article(title)

    assets = map_assets(
        analysis["category"],
        analysis["market_impact"]
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

    horizon = estimate_horizon(
        analysis["category"],
        analysis["importance"]
    )

    return {
        "title": title,
        "category": analysis["category"],
        "sentiment": analysis["sentiment"],
        "importance": analysis["importance"],
        "market_impact": analysis["market_impact"],
        "assets": assets,
        "directions": directions,
        "confidence": confidence,
        "time_horizon": horizon
    }
