import os
import instructor
import openai
from backend.schemas import NewsAnalysis

# Cache clients to avoid memory leaks from unclosed httpx connections
_client_cache = {}

# Patch the OpenAI client to use OpenRouter with instructor
def get_client(api_key=None):
    if not api_key:
        api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        return None
        
    if api_key in _client_cache:
        return _client_cache[api_key]
        
    client = instructor.patch(
        openai.OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key,
            timeout=60.0
        ),
        mode=instructor.Mode.JSON
    )
    _client_cache[api_key] = client
    return client

def get_all_keys():
    keys = []
    k1 = os.getenv("OPENROUTER_API_KEY")
    if k1: keys.append(k1)
    for i in range(2, 11):
        k = os.getenv(f"OPENROUTER_API_KEY_{i}")
        if k: keys.append(k)
    return keys if keys else None

SYSTEM_PROMPT = """
You are a senior institutional macro strategist at a tier-1 hedge fund.
Analyze the provided financial news article and return ONLY a valid JSON 
object. No markdown. No commentary. No preamble. Raw JSON only.

CATEGORY — Return EXACTLY one of these 9 values. Any other value is 
a schema violation. Do not invent new categories.

"Crypto"         — Digital assets, blockchain, DeFi, stablecoins
"Macro"          — GDP, PMI, trade data, freight/shipping volumes,
                   government spending, healthcare policy, any 
                   government fiscal action
"Equities"       — Individual stocks, earnings, corporate actions,
                   IPOs, analyst ratings
"Forex"          — Currency pairs, FX reserves, exchange rates
"Commodities"    — Oil, gas, gold, metals, agricultural goods,
                   shipping/freight indexes
"Fixed Income"   — Bonds, yields, credit spreads, debt issuance
"Monetary Policy"— Central bank decisions, rate guidance, QE/QT
"Geopolitics"    — Wars, sanctions, trade disputes, strait closures,
                   territorial disputes, political risk to supply chains
"Politics"       — Domestic political events, elections, congressional 
                   news, government leadership, social policy with 
                   no direct market impact

CRITICAL OVERRIDE RULES:
- Shipping through the Strait of Hormuz → "Geopolitics" not "Commodities" 
  and NOT "Technology"
- Rail freight volumes, shipping data, trade flows → "Macro" not "Technology"
- A congressman's health, personal disclosure → "Politics" not anything else  
- UK NHS maternity funding, public health policy → "Macro" not "Technology"
- Anything you might instinctively call "Technology" must instead be one of 
  the above. "Technology" is not a valid output. Never return it.

IMPORTANCE SCORE — You must score 1-10 using this exact rubric:
9-10: Central bank rate decision, systemic financial crisis, sovereign 
      default, major geopolitical shock (war, sanctions)
7-8:  Earnings surprise >10%, major M&A announcement, significant 
      regulatory action, crypto market cap move >15%
5-6:  Fed/ECB speech, major macro data release (CPI, NFP, GDP, PMI), 
      corporate guidance revision, crypto asset touching multi-year 
      price extremes
3-4:  Analyst upgrade/downgrade, sector rotation signal, minor data 
      print, 52-week high/low on a single mid-cap stock
1-2:  Routine commentary, reiteration of known policy, scheduled 
      low-impact event, general market recap

CONFIDENCE SCORE — Score 0.0 to 1.0. This must reflect the actual 
quality and specificity of information in the article:
0.9-1.0: Article contains specific numbers, named sources, confirmed 
          data (e.g. exact price levels, official statements, reported 
          earnings figures)
0.7-0.8: Article contains moderate specifics with some inference required
0.5-0.6: Article is largely analytical opinion or soft signals with 
          limited hard data
0.3-0.4: Article is speculative, uses anonymous sources, or contains 
          contradictory information
Never default to 0.85. Every article must be independently assessed.

EXECUTIVE SUMMARY — 2-3 sentences. What happened. Factual only. 
No opinion, no forward projection. This is the "what."

MARKET THESIS — 3-5 sentences. Your analytical interpretation of what 
this means for markets. Forward-looking. This is the "so what." 
This section must be substantively different from the executive summary.
Do not repeat the same facts. Add analytical value or do not write it.

AFFECTED ASSETS — For every asset, provide:
  asset: common name (e.g. "Gold", "Bitcoin", "S&P 500")
  ticker: primary Yahoo Finance ticker (e.g. "GC=F", "BTC-USD", "^GSPC",
          "AAPL", "EURUSD=X"). If unknown, use "UNKNOWN"
  asset_class: one of "Equity", "Commodity", "Crypto", "Forex", 
               "Fixed Income", "Index"
  direction: "Bullish", "Bearish", or "Neutral"
  confidence: 0.0 to 1.0 (how confident are you in this specific 
              asset's directional call — score independently per asset)
  evaluation_window_hours: Integer from 1 to 168. How many hours will it take for this asset to reflect the news?
  reason: one sentence explaining the directional call

CONSENSUS DEVIATION — Assess whether this news deviates from what 
markets already expected:
  direction: e.g. "Hawkish surprise", "Dovish surprise", 
             "Earnings beat", "Earnings miss", "Inline with consensus",
             "Unknown" (use Unknown if article lacks consensus context)
  magnitude: "None", "Minor", "Moderate", "Major"
  rationale: one sentence

TIME HORIZON:
  intraday: expected price impact within today's session
  short_term: 1-5 day outlook
  medium_term: 1-4 week outlook

Return this exact JSON schema:
{
  "sentiment": "Positive" | "Negative" | "Neutral",
  "importance": <int 1-10>,
  "confidence": <float 0.0-1.0>,
  "category": <one of the 8 categories above>,
  "executive_summary": <string>,
  "market_thesis": <string>,
  "affected_assets": [
    {
      "asset": <string>,
      "ticker": <string>,
      "asset_class": <string>,
      "direction": "Bullish" | "Bearish" | "Neutral",
      "confidence": <float 0.0-1.0>,
      "evaluation_window_hours": <int 1-168>,
      "reason": <string>
    }
  ],
  "first_order_effects": [<string>, ...],
  "second_order_effects": [<string>, ...],
  "bull_case": <string>,
  "bear_case": <string>,
  "time_horizon": {
    "intraday": <string>,
    "short_term": <string>,
    "medium_term": <string>
  },
  "key_risks": [<string>, ...],
  "portfolio_tags": [<string>, ...],
  "watch_next": [<string>, ...],
  "consensus_deviation": {
    "direction": <string>,
    "magnitude": "None" | "Minor" | "Moderate" | "Major",
    "rationale": <string>
  }
}
"""

def analyze_news(article, article_body=""):
    keys = get_all_keys()
    if not keys:
        print("ERROR: OPENROUTER_API_KEY environment variable is not set. Set it in Render/Vercel dashboard.")
        return None

    headline = article.get("headline", "")
    category = article.get("category", "")
    
    # If full body is available, use it. Otherwise fallback to headline only.
    content_payload = f"Headline: {headline}\nCategory: {category}"
    if article_body:
        content_payload += f"\n\nFull Article Body:\n{article_body}"

    import time
    
    for key in keys:
        client = get_client(key)
        for attempt in range(2):
            try:
                # Instructor automatically handles retries and validation errors based on the Pydantic schema
                analysis: NewsAnalysis = client.chat.completions.create(
                    model="nvidia/nemotron-3-super-120b-a12b:free",
                    response_model=NewsAnalysis,
                    max_retries=2,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": content_payload}
                    ]
                )
                return analysis.model_dump()
            except Exception as e:
                print(f"OpenRouter API Error: {e}")
                if "429" in str(e) or "402" in str(e) or "rate-limited" in str(e):
                    print("Rate limit hit for a key. Rotating to next key...")
                    break # Break attempt loop, move to next key
                time.sleep(2)
                
    # If we exhaust all OpenRouter keys, fallback to Gemini
    return call_gemini_fallback(SYSTEM_PROMPT, content_payload, NewsAnalysis)

def analyze_news_batch(articles_list):
    from backend.schemas import BatchNewsAnalysisItem
    keys = get_all_keys()
    if not keys:
        print("ERROR: OPENROUTER_API_KEY environment variable is not set.")
        return None

    if not articles_list:
        return []

    content_payload = "Analyze the following news articles. For each article, output a JSON object matching the schema and include its article_index.\n\n"
    for i, article in enumerate(articles_list):
        headline = article.get("headline", "")
        category = article.get("category", "")
        body = article.get("body", "")
        
        content_payload += f"--- ARTICLE INDEX: {i} ---\nHeadline: {headline}\nCategory: {category}\n"
        if body:
            content_payload += f"Full Article Body:\n{body}\n"
        content_payload += "\n"

    import time
    
    for key in keys:
        client = get_client(key)
        for attempt in range(2):
            try:
                analyses: list[BatchNewsAnalysisItem] = client.chat.completions.create(
                    model="nvidia/nemotron-3-super-120b-a12b:free",
                    response_model=list[BatchNewsAnalysisItem],
                    max_retries=2,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": content_payload}
                    ]
                )
                return [a.model_dump() for a in analyses]
            except Exception as e:
                print(f"OpenRouter API Batch Error: {e}")
                if "429" in str(e) or "402" in str(e) or "rate-limited" in str(e):
                    print("Rate limit hit for a key. Rotating to next key...")
                    break # Break attempt loop, move to next key
                time.sleep(2)
                
    # If we exhaust all OpenRouter keys, fallback to Gemini
    return call_gemini_fallback(SYSTEM_PROMPT, content_payload, list[BatchNewsAnalysisItem])

def generate_morning_brief(top_news_items):
    from backend.schemas import MorningBrief
    keys = get_all_keys()
    if not keys:
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

    import time
    for key in keys:
        client = get_client(key)
        for attempt in range(2):
            try:
                analysis = client.chat.completions.create(
                    model="nvidia/nemotron-3-super-120b-a12b:free",
                    response_model=MorningBrief,
                    max_retries=2,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt}
                    ]
                )
                return analysis.model_dump()
            except Exception as e:
                print(f"OpenRouter API Error in morning brief: {e}")
                if "429" in str(e) or "402" in str(e) or "rate-limited" in str(e):
                    break
                time.sleep(2)
                
    # If we exhaust all OpenRouter keys, fallback to Gemini
    result = call_gemini_fallback(system_prompt, prompt, MorningBrief)
    if result:
        return result
        
    return {"error": "All API keys failed or rate limited"}

def call_gemini_fallback(system_prompt, content_payload, response_model):
    import os
    gemini_key = os.getenv("GEMINI_API_KEY")
    try:
        from backend.database import supabase
        if not gemini_key:
            supabase.table("refresh_locks").update({"locked_by": "GEMINI_API_KEY IS MISSING IN ENVIRONMENT VARIABLES"}).eq("id", 1).execute()
            return None
    except:
        pass
        
    print("Falling back to Gemini API (google-genai)...")
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=gemini_key)
        
        # Combine system prompt and user content since Gemini API prefers a single combined instruction for schemas
        full_content = system_prompt + "\n\n" + content_payload
        
        response = client.models.generate_content(
            model='gemini-1.5-flash',
            contents=full_content,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=response_model,
                temperature=0.2
            ),
        )
        # Parse the JSON response into our Pydantic model
        if hasattr(response_model, '__args__') and type(response_model).__name__ == '_GenericAlias':
            # It's a list response model
            from pydantic import TypeAdapter
            adapter = TypeAdapter(response_model)
            return [m.model_dump() for m in adapter.validate_json(response.text)]
        else:
            return response_model.model_validate_json(response.text).model_dump()
    except Exception as e:
        print(f"Gemini fallback error: {e}")
        try:
            from backend.database import supabase
            supabase.table("refresh_locks").update({"locked_by": f"GEMINI ERROR: {str(e)[:500]}"}).eq("id", 1).execute()
        except:
            pass
        return None
