import json
from datetime import datetime, timezone

from backend.openrouter_client import analyze_news
from backend.confidence_engine import calculate_confidence


# -----------------------------
# Timestamp
# -----------------------------
def now_iso():
    return datetime.now(timezone.utc).isoformat()

# -----------------------------
# Deterministic Preprocessing
# -----------------------------
def guess_category(title, summary):
    text = (title + " " + (summary or "")).lower()
    if any(x in text for x in ["war", "missile", "treaty", "nato"]):
        return "Geopolitics"
    if any(x in text for x in ["earnings", "fed", "rate", "inflation", "stock"]):
        return "Finance"
    if any(x in text for x in ["ai", "chip", "software", "apple", "nvidia", "tech"]):
        return "Technology"
    return "General"


def extract_initial_assets(title, summary):
    text = (title + " " + (summary or "")).lower()
    assets = []
    if any(x in text for x in ["oil", "opec", "crude"]):
        assets.append("Crude Oil")
    if "gold" in text:
        assets.append("Gold")
    if any(x in text for x in ["fed", "rate", "inflation"]):
        assets.append("USD")
        assets.append("Treasury Yields")
    if any(x in text for x in ["bitcoin", "crypto"]):
        assets.append("Bitcoin")
    return assets


# -----------------------------
# Main Intelligence Builder
# -----------------------------
def build_intelligence(title, summary):
    initial_category = guess_category(title, summary)
    initial_assets = extract_initial_assets(title, summary)
    
    article_dict = {
        "headline": title,
        "category": initial_category
    }
    analysis = analyze_news(article_dict) or {}

    category = initial_category
    sentiment = analysis.get("sentiment", "Neutral")
    importance = analysis.get("importance", 7)
    confidence = analysis.get("confidence", 50)
    
    # Map strict schema to DB schema
    market_impact = analysis.get("market_impact", "Unknown")
    assets = analysis.get("assets", initial_assets)
    basic_analysis = analysis.get("basic_analysis", summary)

    # Note: openrouter_client returns basic_analysis instead of structured_analysis.market_interpretation
    # We will pass the whole analysis dict as structured_analysis so the frontend can display basic_analysis if it wants.
    
    return {
        "category": category,
        "sentiment": sentiment,
        "importance": importance,
        "market_impact": market_impact,
        "assets": assets,
        "directions": {},
        "confidence": confidence,
        "time_horizon": "Variable",
        "analysis": basic_analysis,
        "structured_analysis": analysis,
        "added_at": now_iso()
    }

