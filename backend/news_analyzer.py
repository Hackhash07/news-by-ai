import json
import re

import ollama


def _extract_json_object(text):
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

4. Return JSON only.
Do not add explanations.
Do not add markdown.

Example:

{{
    "category": "Geopolitics",
    "sentiment": "Negative",
    "importance": 8
}}
"""

    try:
        response = ollama.chat(
            model="llama3.1:8b",
            options={
                "temperature": 0,
                "num_predict": 80
            },
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        )

        content = response.get("message", {}).get("content", "")
        result = _extract_json_object(content)

        if not isinstance(result, dict):
            raise ValueError(f"Invalid JSON from model: {content}")

        category = result.get("category", "General")
        if category not in [
            "Geopolitics",
            "Finance",
            "Technology",
            "General"
        ]:
            category = "General"

        sentiment = result.get("sentiment", "Neutral")
        if sentiment not in ["Positive", "Negative", "Neutral"]:
            sentiment = "Neutral"

        try:
            importance = int(result.get("importance", 5))
        except Exception:
            importance = 5

        importance = max(1, min(10, importance))

        return {
            "category": category,
            "sentiment": sentiment,
            "importance": importance,
            "market_impact": "Unknown"
        }

    except Exception as e:
        print("LLM Error:", e)
        return {
            "category": "General",
            "sentiment": "Neutral",
            "importance": 5,
            "market_impact": "Unknown"
        }
