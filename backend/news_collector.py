import feedparser
import time

from backend.database import save_article, acquire_refresh_lock, release_refresh_lock, log_refresh, get_existing_links
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
    
    feeds_checked = len(RSS_FEEDS)
    articles_fetched = 0
    duplicates_skipped_before_ai = 0
    articles_sent_to_ai = 0
    inserted_count = 0
    duplicate_count = 0
    failed_count = 0
    
    try:
        raw_articles = []
        
        # 1. Fetch raw articles
        for feed_url in RSS_FEEDS:
            feed = feedparser.parse(feed_url)

            for entry in feed.entries[:2]:
                title = getattr(entry, "title", "").strip()
                link = getattr(entry, "link", "").strip()

                if not title or not link:
                    continue
                    
                articles_fetched += 1
                
                # Extract optional fields
                source = getattr(feed.feed, "title", "News")
                published_at = getattr(entry, "published", None)
                image_url = None
                
                # Try to find an image in media_content
                media_content = getattr(entry, "media_content", [])
                if media_content and len(media_content) > 0:
                    image_url = media_content[0].get("url")

                raw_articles.append({
                    "title": title,
                    "link": link,
                    "source": source,
                    "published_at": published_at,
                    "image_url": image_url
                })
        
        # 2. Collect all links
        all_links = [article["link"] for article in raw_articles]
        
        # 3. Check Supabase for existing links in one batch query
        existing_links_set = get_existing_links(all_links)
        
        # 4. Filter and process
        for article in raw_articles:
            link = article["link"]
            title = article["title"]
            
            # IF article already exists: Skip immediately. DO NOT call LLM.
            if link in existing_links_set:
                duplicates_skipped_before_ai += 1
                duplicate_count += 1
                print(f"Duplicate/Skipped Before AI: {title}")
                continue
                
            # ELSE: Send ONLY this article to the LLM
            articles_sent_to_ai += 1
            
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
                    analysis=intelligence.get("analysis"),
                    source=article["source"],
                    published_at=article["published_at"],
                    image_url=article["image_url"]
                )
                
                if inserted:
                    inserted_count += 1
                    print(f"Inserted: {title}")
                else:
                    # Should rarely happen unless a race condition occurred between check and insert
                    duplicate_count += 1
                    print(f"Duplicate/Skipped After AI: {title}")
                    
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
        "feeds_checked": feeds_checked,
        "articles_fetched": articles_fetched,
        "duplicates_skipped_before_ai": duplicates_skipped_before_ai,
        "articles_sent_to_ai": articles_sent_to_ai,
        "inserted": inserted_count,
        "duplicates": duplicate_count,
        "failed": failed_count,
        "llm_calls_saved": duplicates_skipped_before_ai,
        "duration": duration
    }

if __name__ == "__main__":
    result = collect_news()
    print(result)
