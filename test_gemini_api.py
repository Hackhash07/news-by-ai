from google import genai
from google.genai import types
from backend.schemas import BatchNewsAnalysisItem
import os

key = os.getenv("GEMINI_API_KEY")
if not key:
    print("NO KEY")
    exit()

client = genai.Client(api_key=key)
try:
    response = client.models.generate_content(
        model='gemini-1.5-flash',
        contents="Analyze this: Apple stock went up. Return a JSON list with article_index 0.",
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=list[BatchNewsAnalysisItem],
            temperature=0.2
        )
    )
    print("RESPONSE TEXT:", response.text)
except Exception as e:
    print(f"FAILED: {e}")
