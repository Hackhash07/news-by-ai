import time
import feedparser
import trafilatura
from datasketch import MinHash, MinHashLSH
from datetime import datetime

from backend.database import save_article, acquire_refresh_lock, release_refresh_lock, log_refresh, supabase, get_articles
from backend.intelligence_engine import build_intelligence

RSS_FEEDS = {
    "Reuters": {
        "url": "https://feeds.reuters.com/reuters/businessNews", # Using placeholder, will use actual later
        "weight": 1.0,
        "tier": "primary",
        "category": "macro"
    },
    "Bloomberg": {
        "url": "https://feeds.bloomberg.com/markets/news.xml", # Using placeholder
        "weight": 1.0,
        "tier": "primary",
        "category": "macro"
    },
    "Investing.com": {
        "url": "https://www.investing.com/rss/news.rss",
        "weight": 0.8,
        "tier": "secondary",
        "category": "multi"
    },
    "FXStreet": {
        "url": "https://www.fxstreet.com/rss/news",
        "weight": 0.7,
        "tier": "secondary",
        "category": "forex"
    },
    "CoinTelegraph": {
        "url": "https://cointelegraph.com/rss",
        "weight": 0.6,
        "tier": "secondary",
        "category": "crypto"
    },
    "Forexlive": {
        "url": "https://www.forexlive.com/feed",
        "weight": 0.65,
        "tier": "secondary",
        "category": "forex"
    }
}

# Restore the original BBC and NYT links since the user's old code had them
# We will just merge them into the new format
RSS_FEEDS["BBC"] = {
    "url": "https://feeds.bbci.co.uk/news/rss.xml",
    "weight": 0.9,
    "tier": "primary",
    "category": "general"
}
RSS_FEEDS["NYT"] = {
    "url": "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
    "weight": 0.9,
    "tier": "primary",
    "category": "general"
}

# --- MinHash LSH Deduplication ---
lsh = MinHashLSH(threshold=0.85, num_perm=128)
lsh_initialized = False

def get_minhash(text: str) -> MinHash:
    m = MinHash(num_perm=128)
    for word in text.lower().split():
        m.update(word.encode('utf8'))
    return m

def rebuild_lsh_from_db():
    global lsh_initialized
    if lsh_initialized:
        return
        
    try:
        # Fetch recent articles to populate LSH index (limit to last 500 to save memory)
        response = supabase.table("news").select("link, content_signature").order('created_at', desc=True).limit(500).execute()
        for row in response.data:
            if row.get("content_signature") and row.get("link"):
                m = MinHash(num_perm=128, hashvalues=row["content_signature"])
                lsh.insert(row["link"], m)
        print(f"LSH index rebuilt with {len(response.data)} articles.")
        lsh_initialized = True
    except Exception as e:
        print(f"Error rebuilding LSH index: {e}")

def is_duplicate(article_id: str, text: str) -> bool:
    if not text:
        return False
    m = get_minhash(text)
    result = lsh.query(m)
    if result:
        return True
    return False

# --- Content Scraping ---
def scrape_article_body(url: str) -> str:
    try:
        downloaded = trafilatura.fetch_url(url)
        if downloaded:
            text = trafilatura.extract(downloaded, 
                                       include_comments=False,
                                       include_tables=False,
                                       no_fallback=False)
            return text[:4000] if text else ""
    except Exception as e:
        print(f"Scrape error for {url}: {e}")
    return ""

def log_job_start():
    try:
        data = {
            "job_name": "collect_news",
            "status": "running"
        }
        res = supabase.table("job_log").insert(data).execute()
        if res.data:
            return res.data[0]["id"]
    except Exception as e:
        print(f"Error in log_job_start: {e}")
    return None

def log_job_end(job_id, articles_processed, errors, status="completed"):
    if not job_id:
        return
    try:
        data = {
            "completed_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
            "articles_processed": articles_processed,
            "errors": errors,
            "status": status
        }
        supabase.table("job_log").update(data).eq("id", job_id).execute()
    except Exception as e:
        print(f"Error in log_job_end: {e}")

def collect_news():
    if not acquire_refresh_lock():
        return {"status": "conflict", "error": "Refresh already in progress"}
    
    # Ensure LSH index is rebuilt on first run
    rebuild_lsh_from_db()

    job_id = log_job_start()
    start_time = time.time()
    
    articles_fetched = 0
    duplicates_skipped = 0
    inserted_count = 0
    failed_count = 0
    
    try:
        for source_name, feed_info in RSS_FEEDS.items():
            feed_url = feed_info["url"]
            weight = feed_info["weight"]
            tier = feed_info["tier"]
            
            feed = feedparser.parse(feed_url)
            for entry in feed.entries[:3]:
                title = getattr(entry, "title", "").strip()
                link = getattr(entry, "link", "").strip()
                summary = getattr(entry, "summary", "").strip()

                if not title or not link:
                    continue
                    
                articles_fetched += 1
                published_at = getattr(entry, "published", None)
                image_url = None
                media_content = getattr(entry, "media_content", [])
                if media_content and len(media_content) > 0:
                    image_url = media_content[0].get("url")

                # 1. Scrape full body
                body = scrape_article_body(link)
                analysis_source = "full_body" if body else "headline_only"
                
                content_to_hash = body if body else f"{title} {summary}"

                # 2. LSH Deduplication
                if is_duplicate(link, content_to_hash):
                    duplicates_skipped += 1
                    print(f"Duplicate (LSH): {title}")
                    continue
                    
                # 3. AI Inference
                try:
                    intelligence = build_intelligence(title, summary, body)
                    
                    # Compute minhash to save
                    m = get_minhash(content_to_hash)
                    
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
                        source=source_name,
                        published_at=published_at,
                        image_url=image_url,
                        source_weight=weight,
                        source_tier=tier,
                        analysis_source=analysis_source,
                        content_signature=[int(h) for h in m.hashvalues] # Cast np.uint64 to int for JSONB
                    )
                    
                    if inserted:
                        inserted_count += 1
                        lsh.insert(link, m) # Add to memory index
                        print(f"Inserted: {title} ({analysis_source})")
                    else:
                        duplicates_skipped += 1
                        
                except Exception as e:
                    failed_count += 1
                    print(f"Error analyzing {title}: {e}")

    finally:
        release_refresh_lock()
        
    duration = round(time.time() - start_time, 2)
    log_job_end(job_id, inserted_count, failed_count)
    log_refresh(
        duration_seconds=duration,
        inserted_count=inserted_count,
        duplicate_count=duplicates_skipped,
        failed_count=failed_count
    )
    
    return {
        "status": "success",
        "articles_fetched": articles_fetched,
        "duplicates": duplicates_skipped,
        "inserted": inserted_count,
        "errors": failed_count,
        "duration": duration
    }

if __name__ == "__main__":
    result = collect_news()
    print(result)
