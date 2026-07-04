from google import genai
from google.genai import types
from backend.schemas import BatchNewsAnalysisItem

try:
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=list[BatchNewsAnalysisItem],
        temperature=0.2
    )
    print("SUCCESS")
except Exception as e:
    print(f"FAILED: {e}")
