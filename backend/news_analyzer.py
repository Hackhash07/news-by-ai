import json
import ollama


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
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        )

        content = response["message"]["content"]

        start = content.find("{")
        end = content.rfind("}") + 1

        json_text = content[start:end]

        result = json.loads(json_text)

        category = result.get("category", "General")

        if category not in [
            "Geopolitics",
            "Finance",
            "Technology",
            "General"
        ]:
            category = "General"

        return {
            "category": category,
            "sentiment": result.get("sentiment", "Neutral"),
            "importance": result.get("importance", 5),
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
