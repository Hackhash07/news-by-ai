import os
import instructor
import openai
from backend.schemas import NewsAnalysis

# Patch the OpenAI client to use OpenRouter with instructor
def get_client():
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        print("OPENROUTER_API_KEY missing")
        return None
        
    return instructor.patch(
        openai.OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key
        ),
        mode=instructor.Mode.JSON
    )

SYSTEM_PROMPT = """
You are a senior institutional macro strategist at a tier-1 hedge fund.
Analyze the provided financial news article and return ONLY a valid JSON 
object with no additional text, markdown, or commentary.

IMPORTANCE SCORE RUBRIC (you must follow this exactly):
9-10: Central bank rate decision, major geopolitical shock, systemic 
      financial crisis event, sovereign default
7-8:  Earnings surprise >10%, major M&A announcement, significant 
      regulatory action, war escalation
5-6:  Fed/ECB speech, major macro data release (CPI, NFP, GDP), 
      corporate guidance revision
3-4:  Analyst upgrade/downgrade, sector rotation signal, minor data print
1-2:  Routine commentary, reiteration of known policy, scheduled 
      low-impact event

TICKER INSTRUCTION: For every affected asset, provide the primary 
exchange ticker symbol used on Yahoo Finance or Bloomberg. 
Examples: Gold = "GC=F", S&P500 = "^GSPC", EUR/USD = "EURUSD=X", 
Apple = "AAPL", Bitcoin = "BTC-USD". If you cannot determine the 
ticker with high confidence, use "UNKNOWN".

CONSENSUS DEVIATION: Assess whether this event deviates from current 
market consensus expectations. If the article does not contain enough 
information to assess consensus, set direction to "Unknown" and 
magnitude to "None".

Use concise, evidence-based language. Avoid sensationalism. 
Write for an audience of quantitative analysts.
"""

def analyze_news(article, article_body=""):
    client = get_client()
    if not client:
        return None

    headline = article.get("headline", "")
    category = article.get("category", "")
    
    # If full body is available, use it. Otherwise fallback to headline only.
    content_payload = f"Headline: {headline}\nCategory: {category}"
    if article_body:
        content_payload += f"\n\nFull Article Body:\n{article_body}"

    import time
    
    for attempt in range(3):
        try:
            # Instructor automatically handles retries and validation errors based on the Pydantic schema
            analysis: NewsAnalysis = client.chat.completions.create(
                model="nvidia/llama-3.1-nemotron-70b-instruct:free",
                response_model=NewsAnalysis,
                max_retries=3,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": content_payload}
                ]
            )
            return analysis.model_dump()
        except Exception as e:
            print(f"OpenRouter/Instructor API Error on attempt {attempt+1}: {e}")
            if "429" in str(e) or "rate-limited" in str(e):
                time.sleep(5) # wait 5 seconds before retrying
                continue
            return None
    return None

def generate_morning_brief(top_news_items):
    from backend.schemas import MorningBrief
    client = get_client()
    if not client:
        return {"error": "OPENROUTER_API_KEY missing"}

    headlines_text = ""
    for item in top_news_items:
        title = item.get("title", "Unknown")
        sentiment = item.get("sentiment", "Neutral")
        importance = item.get("importance", 5)
        headlines_text += f"- {title} (Sentiment: {sentiment}, Importance: {importance})\n"

    prompt = f"""
You are a market intelligence analyst. Here are today's top market-moving headlines with their AI analysis. 
Generate a concise morning brief.
Headlines:
{headlines_text}
"""
    system_prompt = "Generate a concise morning brief. The headline must be one punchy 8-word market summary. The summary must be a 2-3 sentence overview of key market themes today, mentioning specific assets and directional bias. Be direct and confident, not vague."

    try:
        analysis = client.chat.completions.create(
            model="nvidia/llama-3.1-nemotron-70b-instruct:free",
            response_model=MorningBrief,
            max_retries=3,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ]
        )
        return analysis.model_dump()
    except Exception as e:
        print(f"OpenRouter API Error in morning brief: {e}")
        return {"error": str(e)}
