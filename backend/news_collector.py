import feedparser
import time
import re

from backend.database import save_article, acquire_refresh_lock, release_refresh_lock, log_refresh, get_existing_links, get_articles
from backend.intelligence_engine import build_intelligence, build_basic_intelligence

RSS_FEEDS = [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
]

IMPORTANT_KEYWORDS = [
    "fed", "inflation", "cpi", "ppi", "rate", "interest", "war", "strike", "attack",
    "israel", "lebanon", "ukraine", "russia", "china", "taiwan", "election",
    "tariff", "sanction", "earnings", "gdp", "employment", "jobs", "sec",
    "bitcoin", "crypto", "opec", "oil", "gold", "central bank", "powell"
]

def is_high_importance(title, summary):
    text = (title + " " + summary).lower()
    for kw in IMPORTANT_KEYWORDS:
        if re.search(r'\b' + kw + r'\b', text):
            return True
    return False

def jaccard_similarity(str1, str2):
    a = set(re.findall(r'\w+', str1.lower()))
    b = set(re.findall(r'\w+', str2.lower()))
    if not a or not b: return 0
    return len(a.intersection(b)) / len(a.union(b))

def is_duplicate(text, existing_texts):
    for et in existing_texts:
        if jaccard_similarity(text, et) > 0.45:  # 45% word overlap is substantial
            return True
    return False

def collect_news():
    if not acquire_refresh_lock():
        return {"status": "conflict", "error": "Refresh already in progress"}
        
    start_time = time.time()
    
    feeds_checked = len(RSS_FEEDS)
    articles_fetched = 0
    duplicates_skipped_before_ai = 0
    articles_sent_to_ai = 0
    articles_saved_basic = 0
    inserted_count = 0
    duplicate_count = 0
    failed_count = 0
    
    try:
        raw_articles = []
        for feed_url in RSS_FEEDS:
            feed = feedparser.parse(feed_url)
            for entry in feed.entries[:3]:
                title = getattr(entry, "title", "").strip()
                link = getattr(entry, "link", "").strip()
                summary = getattr(entry, "summary", "").strip()

                if not title or not link:
                    continue
                    
                articles_fetched += 1
                source = getattr(feed.feed, "title", "News")
                published_at = getattr(entry, "published", None)
                image_url = None
                media_content = getattr(entry, "media_content", [])
                if media_content and len(media_content) > 0:
                    image_url = media_content[0].get("url")

                raw_articles.append({
                    "title": title,
                    "link": link,
                    "summary": summary,
                    "source": source,
                    "published_at": published_at,
                    "image_url": image_url
                })
        
        all_links = [article["link"] for article in raw_articles]
        existing_links_set = get_existing_links(all_links)
        
        recent_articles = get_articles()[:50]
        existing_texts = [f"{a['title']} {a.get('analysis', '')}" for a in recent_articles]
        
        for article in raw_articles:
            link = article["link"]
            title = article["title"]
            summary = article["summary"]
            combined_text = f"{title} {summary}"
            
            if link in existing_links_set or is_duplicate(combined_text, existing_texts):
                duplicates_skipped_before_ai += 1
                duplicate_count += 1
                print(f"Duplicate/Skipped Before AI: {title}")
                continue
                
            try:
                if is_high_importance(title, summary):
                    if articles_sent_to_ai >= 1:
                        print(f"Skipping '{title}' to prevent worker timeout (max 1 AI call per run)")
                        continue
                        
                    articles_sent_to_ai += 1
                    intelligence = build_intelligence(title, summary)
                else:
                    articles_saved_basic += 1
                    intelligence = build_basic_intelligence(title, summary)
                
                inserted = save_article(
                    title=title,
                    link=link,
                    category=intelligence.get("category"),
                    sentiment=intelligence.get("sentiment"),
                    importance=intelligence.get("importance"),
                    market_impact=intelligence.get("market_impact"),
                    assets=intelligence.get("assets"),
                    directions=intelligence.get("directions"),
                    confidence=intelligence.get("confidence"),
                    time_horizon=intelligence.get("time_horizon"),
                    analysis=intelligence.get("analysis"),
                    structured_analysis=intelligence.get("structured_analysis"),
                    source=article["source"],
                    published_at=article["published_at"],
                    image_url=article["image_url"]
                )
                
                if inserted:
                    inserted_count += 1
                    print(f"Inserted: {title} (AI: {is_high_importance(title, summary)})")
                else:
                    duplicate_count += 1
                    print(f"Duplicate/Skipped After AI: {title}")
                    
            except Exception as e:
                failed_count += 1
                print(f"Intelligence/DB Error for '{title}': {e}")
                continue

    finally:
        release_refresh_lock()
        
    duration = round(time.time() - start_time, 2)
    log_refresh(
        duration_seconds=duration,
        inserted_count=inserted_count,
        duplicate_count=duplicate_count,
        failed_count=failed_count
    )
    
    return {
        "status": "success",
        "feeds_checked": feeds_checked,
        "articles_fetched": articles_fetched,
        "duplicates_skipped_before_ai": duplicates_skipped_before_ai,
        "articles_sent_to_ai": articles_sent_to_ai,
        "articles_saved_basic": articles_saved_basic,
        "inserted": inserted_count,
        "duplicates": duplicate_count,
        "failed": failed_count,
        "llm_calls_saved": duplicates_skipped_before_ai + articles_saved_basic,
        "duration": duration
    }

if __name__ == "__main__":
    result = collect_news()
    print(result)
