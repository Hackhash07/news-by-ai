import os
from pydantic import BaseModel
from google import genai
from google.genai import types
from backend.schemas import NewsAnalysis

gemini_key = os.getenv("GEMINI_API_KEY")
if not gemini_key:
    print("No GEMINI_API_KEY")
    exit(1)

client = genai.Client(api_key=gemini_key)
prompt = "Analyze this news: Apple stock drops 5% due to bad earnings."
system = "You are a financial analyst."
try:
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=system + "\n\n" + prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=NewsAnalysis,
        ),
    )
    print("Response text:", response.text)
    parsed = NewsAnalysis.model_validate_json(response.text)
    print("Parsed successfully!")
except Exception as e:
    print("Error:", e)
