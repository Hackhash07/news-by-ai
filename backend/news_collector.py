import feedparser

from backend.database import create_database, save_article
from backend.intelligence_engine import build_intelligence


RSS_FEEDS = [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
]


def collect_news():
    create_database()

    for feed_url in RSS_FEEDS:
        feed = feedparser.parse(feed_url)

        for entry in feed.entries[:2]:
            title = getattr(entry, "title", "").strip()
            link = getattr(entry, "link", "").strip()

            if not title or not link:
                continue

            try:
                intelligence = build_intelligence(title)
            except Exception as e:
                print("Intelligence Error:", e)
                continue

            save_article(
                title=title,
                link=link,
                category=intelligence["category"],
                sentiment=intelligence["sentiment"],
                importance=intelligence["importance"],
                market_impact=intelligence["market_impact"],
                assets=intelligence["assets"],
                directions=intelligence["directions"],
                confidence=intelligence["confidence"],
                time_horizon=intelligence["time_horizon"],
                analysis=intelligence["analysis"],
                added_at=intelligence["added_at"],
            )

            print({
                "title": title,
                "category": intelligence["category"],
                "sentiment": intelligence["sentiment"],
                "importance": intelligence["importance"],
                "market_impact": intelligence["market_impact"],
                "confidence": intelligence["confidence"],
                "analysis": intelligence["analysis"],
                "added_at": intelligence["added_at"],
            })


if __name__ == "__main__":
    collect_news()
