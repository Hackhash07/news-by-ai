from google import genai
import os

key = os.getenv("GEMINI_API_KEY")
if not key:
    print("NO KEY")
    exit()

client = genai.Client(api_key=key)
for m in client.models.list():
    print(m.name)
