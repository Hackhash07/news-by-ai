import feedparser
import time

from backend.database import save_article, acquire_refresh_lock, release_refresh_lock, log_refresh
from backend.intelligence_engine import build_intelligence

RSS_FEEDS = [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
]

def collect_news():
    # Attempt to acquire lock
    if not acquire_refresh_lock():
        return {"status": "conflict", "error": "Refresh already in progress"}
        
    start_time = time.time()
    inserted_count = 0
    duplicate_count = 0
    failed_count = 0
    
    try:
        for feed_url in RSS_FEEDS:
            feed = feedparser.parse(feed_url)

            for entry in feed.entries[:2]:
                title = getattr(entry, "title", "").strip()
                link = getattr(entry, "link", "").strip()

                if not title or not link:
                    continue

                try:
                    # Transaction safety per article
                    intelligence = build_intelligence(title)
                    
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
                        analysis=intelligence.get("analysis")
                    )
                    
                    if inserted:
                        inserted_count += 1
                        print(f"Inserted: {title}")
                    else:
                        duplicate_count += 1
                        print(f"Duplicate/Skipped: {title}")
                        
                except Exception as e:
                    failed_count += 1
                    print(f"Intelligence/DB Error for '{title}': {e}")
                    continue

    finally:
        # Always release the lock
        release_refresh_lock()
        
    duration = round(time.time() - start_time, 2)
    
    # Store refresh history
    log_refresh(
        duration_seconds=duration,
        inserted_count=inserted_count,
        duplicate_count=duplicate_count,
        failed_count=failed_count
    )
    
    return {
        "status": "success",
        "duration": duration,
        "inserted": inserted_count,
        "duplicates": duplicate_count,
        "failed": failed_count
    }

if __name__ == "__main__":
    result = collect_news()
    print(result)
