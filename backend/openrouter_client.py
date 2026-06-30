import os
import json
import requests
import re

def extract_json(text):
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

def analyze_news(article):
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        print("OPENROUTER_API_KEY missing")
        return None

    headline = article.get("headline", "")
    category = article.get("category", "")

    prompt = f"""
Write like a senior institutional macro strategist. Use concise, evidence-based language. Avoid sensationalism.
Analyze the following news article.

Headline: {headline}
Category: {category}

Return STRICT JSON exactly in this format, with no other text:
{{
  "sentiment": "Positive, Negative, or Neutral",
  "importance": int (1-10, where 10 is global market shock),
  "executive_summary": "string (1-2 sentences summarizing the core macro impact)",
  "market_thesis": "string (The core thesis on how this shifts the macro landscape)",
  "why_this_matters": "string (Why institutional investors care about this)",
  "affected_assets": [
    {{
      "asset": "string (e.g. S&P 500, Gold, US Dollar, 10Y Treasury)",
      "direction": "Bullish, Bearish, or Neutral",
      "confidence": int (0-100),
      "reason": "string (Concise reason for this direction)"
    }}
  ],
  "affected_sectors": ["string", "string"],
  "first_order_effects": ["string", "string"],
  "second_order_effects": ["string", "string"],
  "historical_parallels": ["string", "string"],
  "bull_case": "string (What happens if this is highly positive/successful)",
  "bear_case": "string (What happens if this goes poorly/fails)",
  "key_risks": ["string", "string"],
  "time_horizon": {{
      "intraday": "string (Immediate reaction)",
      "short_term": "string (1-4 weeks)",
      "medium_term": "string (1-6 months)"
  }},
  "confidence": int (0-100),
  "portfolio_tags": ["string", "string"],
  "watch_next": ["string", "string"]
}}
"""

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": "nvidia/nemotron-3-ultra-550b-a55b:free",
        "messages": [
            {"role": "user", "content": prompt}
        ]
    }

    def make_request():
        resp = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]

    try:
        content = make_request()
        parsed = extract_json(content)
        if parsed:
            return parsed
    except Exception as e:
        print(f"OpenRouter API Error (first attempt): {e}")

    # Retry once
    try:
        print("Retrying OpenRouter request...")
        content = make_request()
        parsed = extract_json(content)
        if parsed:
            return parsed
    except Exception as e:
        print(f"OpenRouter API Error (retry): {e}")

    return None

def generate_morning_brief(top_news_items):
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        return {"error": "OPENROUTER_API_KEY missing"}

    headlines_text = ""
    for item in top_news_items:
        title = item.get("title", "Unknown")
        sentiment = item.get("sentiment", "Neutral")
        importance = item.get("importance", 5)
        headlines_text += f"- {title} (Sentiment: {sentiment}, Importance: {importance})\n"

    prompt = f"""
You are a market intelligence analyst. Here are today's top market-moving headlines with their AI analysis. Generate a concise morning brief in exactly this JSON format:
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

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": "nvidia/nemotron-3-ultra-550b-a55b:free",
        "messages": [
            {"role": "user", "content": prompt}
        ]
    }

    try:
        resp = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        parsed = extract_json(content)
        if parsed:
            return parsed
        return {"error": "Failed to parse JSON from OpenRouter"}
    except Exception as e:
        print(f"OpenRouter API Error in morning brief: {e}")
        return {"error": str(e)}
