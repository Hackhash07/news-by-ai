import json
import os
import re

from google import genai


def fallback(title, summary, initial_category, initial_assets):
    return {
        "event_type": "Unknown",
        "category": initial_category,
        "sentiment": "Neutral",
        "importance": 5,
        "summary": summary or title,
        "market_interpretation": "Basic context saved. AI analysis was unavailable.",
        "affected_assets": [
            {"name": a, "direction": "Neutral", "probability": 50, "reason": "Default mapping due to AI fallback.", "timeframe": "Unknown"} 
            for a in initial_assets
        ],
        "historical_context": None,
        "invalidation_criteria": []
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


def classify_article(title, summary, initial_category, initial_assets):
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        print("Gemini API key missing")
        return fallback(title, summary, initial_category, initial_assets)

    try:
        client = genai.Client(api_key=api_key)

        prompt = f"""
You are a top-tier macro strategist at a firm like Goldman Sachs or Bridgewater.
Your job is to explain WHY markets react to the following breaking news.

Headline: {title}
Summary: {summary}
Initial Category Estimate: {initial_category}
Initial Extracted Assets: {initial_assets}

Return ONLY a highly structured JSON object.

Rules:
1. Explain causality. Why does this matter to specific assets?
2. Estimate probabilities for asset directions.
3. Provide historical context (a similar past event).
4. State explicitly what would invalidate this view.
5. Provide an importance score (1-10) and an overall sentiment (Positive, Negative, Neutral).

JSON Schema:
{{
  "event_type": "string (e.g. War, Earnings, Central Bank, Election)",
  "category": "Geopolitics, Finance, Technology, or General",
  "sentiment": "Positive, Negative, or Neutral",
  "importance": int (1-10),
  "summary": "string (1-2 sentences summarizing the event)",
  "market_interpretation": "string (Macro view on the market reaction)",
  "affected_assets": [
    {{
      "name": "string (e.g. Gold, Oil, NVIDIA, NIFTY)",
      "direction": "Bullish, Bearish, or Neutral",
      "probability": int (0-100),
      "reason": "string (Causal explanation)",
      "timeframe": "string (Immediate, 1-7 days, 1-3 months)"
    }}
  ],
  "historical_context": {{
    "similar_event": "string",
    "market_reaction": "string",
    "relevance": "string"
  }},
  "invalidation_criteria": [
    "string"
  ]
}}
"""

        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
        )

        parsed = _extract_json(response.text)
        if parsed:
            return parsed
        else:
            print("Failed to parse JSON from Gemini")
            return fallback(title, summary, initial_category, initial_assets)

    except Exception as e:
        print(f"Gemini API Error: {e}")
        return fallback(title, summary, initial_category, initial_assets)

def generate_morning_brief(top_news_items):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {"error": "Gemini API key missing"}
        
    try:
        client = genai.Client(api_key=api_key)
        
        headlines_text = ""
        for item in top_news_items:
            title = item.get("title", "Unknown")
            sentiment = item.get("sentiment", "Neutral")
            importance = item.get("importance", 5)
            headlines_text += f"- {title} (Sentiment: {sentiment}, Importance: {importance})\n"
            
        prompt = f"""
You are a market intelligence analyst. Here are today's top 5 market-moving headlines with their AI analysis. Generate a concise morning brief in exactly this JSON format:
{{
  "headline": "one punchy 8-word market summary for today",
  "summary": "2-3 sentence overview of key market themes today, mentioning specific assets and directional bias. Be direct and confident, not vague.",
  "top_assets": ["NIFTY", "BTC", "Gold"],
  "overall_sentiment": "Bullish|Bearish|Mixed|Cautious"
}}

Headlines:
{headlines_text}

Return ONLY the JSON, no other text.
"""

        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
        )
        
        parsed = _extract_json(response.text)
        if parsed:
            return parsed
        return {"error": "Failed to parse JSON from Gemini for morning brief"}
    except Exception as e:
        print(f"Gemini API Error in morning brief: {e}")
        return {"error": str(e)}

