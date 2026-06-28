import json
from datetime import datetime, timezone

from backend.news_analyzer import classify_article
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
    text = (title + " " + summary).lower()
    if any(x in text for x in ["war", "strike", "attack", "israel", "lebanon", "ukraine", "russia", "china", "taiwan", "election", "sanction"]):
        return "Geopolitics"
    if any(x in text for x in ["fed", "inflation", "cpi", "ppi", "rate", "interest", "earnings", "gdp", "employment", "jobs"]):
        return "Finance"
    if any(x in text for x in ["crypto", "bitcoin", "ethereum"]):
        return "Crypto"
    return "General"


def extract_initial_assets(title, summary):
    text = (title + " " + summary).lower()
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
    
    analysis = classify_article(title, summary, initial_category, initial_assets)

    category = analysis.get("category", initial_category)
    sentiment = analysis.get("sentiment", "Neutral")
    
    # Python assigns importance based on keyword hits implicitly or we can use the LLM's assessment
    # The user wanted Importance determined by Python, but it's hard to give a 1-10 score reliably without AI.
    # We will use a baseline Python score and let AI adjust it.
    importance = analysis.get("importance", 7)
    
    # Calculate deterministic confidence
    ai_probs = []
    for asset in analysis.get("affected_assets", []):
        if "probability" in asset:
            ai_probs.append(asset["probability"])
            
    confidence = calculate_confidence(
        importance=importance,
        source="News Source", # We don't have source explicitly here, could pass it, but defaulting
        ai_probabilities=ai_probs
    )

    return {
        "category": category,
        "sentiment": sentiment,
        "importance": importance,
        "market_impact": analysis.get("market_interpretation", "High Volatility"),
        "assets": [a.get("name") for a in analysis.get("affected_assets", [])],
        "directions": {a.get("name"): a.get("direction") for a in analysis.get("affected_assets", [])},
        "confidence": confidence,
        "time_horizon": "Variable",
        "analysis": analysis.get("summary", ""),
        "structured_analysis": analysis,
        "added_at": now_iso()
    }

# -----------------------------
# Basic Intelligence Builder (Low Importance)
# -----------------------------
def build_basic_intelligence(title, summary):
    category = guess_category(title, summary)
    assets = extract_initial_assets(title, summary)
    
    return {
        "category": category,
        "sentiment": "Neutral",
        "importance": 3,
        "market_impact": "Low Impact",
        "assets": assets,
        "directions": {},
        "confidence": 40,
        "time_horizon": "Unknown",
        "analysis": summary or "This article was saved for context but did not meet the importance threshold for deep AI analysis.",
        "structured_analysis": {
            "summary": summary,
            "market_interpretation": "Low immediate market impact anticipated.",
            "affected_assets": [],
            "historical_context": None,
            "invalidation_criteria": []
        },
        "added_at": now_iso()
    }
