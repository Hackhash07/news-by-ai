import json
import os
import re

from google import genai


def fallback(title):
    title = title.lower()

    if any(x in title for x in [
        "war", "missile", "attack",
        "strike", "russia", "iran",
        "israel", "china"
    ]):
        return {
            "category": "Geopolitics",
            "sentiment": "Negative",
            "importance": 8,
            "market_impact": "Unknown"
        }

    if any(x in title for x in [
        "inflation", "fed", "rates",
        "market", "stocks", "economy",
        "bank", "bond"
    ]):
        return {
            "category": "Finance",
            "sentiment": "Neutral",
            "importance": 6,
            "market_impact": "Unknown"
        }

    return {
        "category": "General",
        "sentiment": "Neutral",
        "importance": 5,
        "market_impact": "Unknown"
    }


def _extract_json(text):
    if not text:
        return None

    text = text.strip()

    try:
        return json.loads(text)
    except Exception:
        pass

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None

    try:
        return json.loads(match.group(0))
    except Exception:
        return None


def classify_article(title):
    api_key = os.getenv("GEMINI_API_KEY")
    print("DEBUG: API KEY PRESENT =", bool(api_key))

    if not api_key:
        print("Gemini API key missing")
        return fallback(title)

    try:
        client = genai.Client(api_key=api_key)

        prompt = f"""
Analyze this news headline.

Headline:
{title}

Return ONLY valid JSON.

Rules:

1. category must be exactly one of:
Geopolitics
Finance
Technology
General

2. sentiment must be exactly one of:
Positive
Negative
Neutral

3. importance must be an integer from 1 to 10

Return JSON only.

Example:

{{
    "category":"Geopolitics",
    "sentiment":"Negative",
    "importance":8
}}
"""

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt
        )

        text = (getattr(response, "text", "") or "").strip()
        result = _extract_json(text)

        if not isinstance(result, dict):
            raise ValueError(f"Invalid JSON from Gemini: {text}")

        category = result.get("category", "General")
        if category not in [
            "Geopolitics",
            "Finance",
            "Technology",
            "General"
        ]:
            category = "General"

        sentiment = result.get("sentiment", "Neutral")
        if sentiment not in [
            "Positive",
            "Negative",
            "Neutral"
        ]:
            sentiment = "Neutral"

        importance = result.get("importance", 5)
        try:
            importance = int(importance)
        except Exception:
            importance = 5

        if importance < 1:
            importance = 1
        if importance > 10:
            importance = 10

        return {
            "category": category,
            "sentiment": sentiment,
            "importance": importance,
            "market_impact": "Unknown"
        }

    except Exception as e:
        print("Gemini Error:", repr(e))
        return fallback(title)
