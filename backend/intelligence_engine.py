import json
import re
from datetime import datetime, timezone

from backend.openrouter_client import analyze_news


# -----------------------------
# Timestamp
# -----------------------------
def now_iso():
    return datetime.now(timezone.utc).isoformat()

# -----------------------------
# Deterministic Preprocessing (fallback only — uses valid 9-category enum)
# -----------------------------
VALID_CATEGORIES = [
    "Crypto", "Macro", "Equities", "Forex", "Commodities",
    "Fixed Income", "Monetary Policy", "Geopolitics", "Politics"
]

def guess_category(title, summary):
    text = (title + " " + (summary or "")).lower()
    if any(x in text for x in ["bitcoin", "btc", "ethereum", "crypto", "defi", "blockchain", "stablecoin"]):
        return "Crypto"
    if any(x in text for x in ["war", "missile", "treaty", "nato", "sanctions", "strait", "territorial"]):
        return "Geopolitics"
    if any(x in text for x in ["election", "congress", "senator", "president", "parliament", "vote", "political"]):
        return "Politics"
    if any(x in text for x in ["fed", "rate", "fomc", "rbi", "ecb", "boj", "central bank", "quantitative"]):
        return "Monetary Policy"
    if any(x in text for x in ["earnings", "stock", "ipo", "shares", "dividend", "buyback", "revenue"]):
        return "Equities"
    if any(x in text for x in ["oil", "gold", "silver", "copper", "wheat", "crude", "opec", "commodity"]):
        return "Commodities"
    if any(x in text for x in ["forex", "currency", "dollar", "euro", "yen", "rupee", "fx"]):
        return "Forex"
    if any(x in text for x in ["bond", "yield", "treasury", "credit", "debt"]):
        return "Fixed Income"
    if any(x in text for x in ["gdp", "inflation", "pmi", "trade", "freight", "manufacturing", "jobs", "employment", "cpi"]):
        return "Macro"
    return "Macro"  # Default to Macro instead of "General"


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


def strip_html(text):
    return re.sub(r'<[^>]+>', '', str(text)) if text else ""


# -----------------------------
# Main Intelligence Builder
# -----------------------------
def build_intelligence(title, summary, body=""):
    initial_category = guess_category(title, summary)
    initial_assets = extract_initial_assets(title, summary)
    
    article_dict = {
        "headline": title,
        "category": initial_category
    }
    analysis = analyze_news(article_dict, body)
    
    if not analysis:
        raise Exception("AI analysis failed (rate limit or API error). Article skipped to prevent saving raw HTML fallback.")

    # Use AI-returned category (primary), fall back to keyword-based guess
    category = analysis.get("category", initial_category)
    # Validate category is in the allowed set
    if category not in VALID_CATEGORIES:
        category = initial_category

    sentiment = analysis.get("sentiment", "Neutral")
    importance = analysis.get("importance", 5)
    
    # Use AI-returned confidence as float 0-1 (from the updated prompt)
    confidence = analysis.get("confidence", 0.5)
    if isinstance(confidence, (int, float)):
        confidence = float(confidence)
        # If the model returned 0-100 scale by mistake, normalize
        if confidence > 1.0:
            confidence = confidence / 100.0
        confidence = max(0.0, min(1.0, confidence))
    else:
        confidence = 0.5
    
    # Map strict schema to DB schema
    market_impact = analysis.get("market_thesis", "Unknown")
    
    # Extract asset names and directions from affected_assets
    affected_assets = analysis.get("affected_assets", [])
    assets = [a.get("asset") for a in affected_assets if a.get("asset")] or initial_assets
    directions = {a.get("asset"): a.get("direction") for a in affected_assets if a.get("asset") and a.get("direction")}
    
    # Use AI time_horizon if available
    time_horizon_data = analysis.get("time_horizon", {})
    if isinstance(time_horizon_data, dict) and time_horizon_data:
        time_horizon = time_horizon_data.get("short_term", "Variable")
    else:
        time_horizon = "Variable"

    basic_analysis = analysis.get("executive_summary", strip_html(summary))

    return {
        "category": category,
        "sentiment": sentiment,
        "importance": importance,
        "market_impact": market_impact,
        "assets": assets,
        "directions": directions,
        "confidence": int(round(confidence * 100)),  # DB column is INTEGER, store as 0-100
        "time_horizon": time_horizon,
        "analysis": basic_analysis,
        "structured_analysis": analysis,  # Raw float confidence preserved here for frontend
        "added_at": now_iso()
    }
