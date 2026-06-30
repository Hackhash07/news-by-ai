from backend.openrouter_client import analyze_news

if __name__ == "__main__":
    test_article = {
        "headline": "Federal Reserve Cuts Interest Rates by 50 Basis Points Unexpectedly",
        "category": "Finance"
    }

    print(f"Testing OpenRouter with model: nvidia/nemotron-3-ultra-550b-a55b:free")
    print(f"Input: {test_article['headline']}")
    print("-" * 50)
    
    result = analyze_news(test_article)
    
    if result:
        print("✅ SUCCESS! Valid JSON returned:")
        import json
        print(json.dumps(result, indent=2))
    else:
        print("❌ FAILED: analyze_news returned None")
