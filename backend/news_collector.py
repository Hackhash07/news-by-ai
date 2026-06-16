import feedparser

from database import create_database
from database import save_article
from intelligence_engine import build_intelligence

RSS_FEEDS = [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"
]


def collect_news():

    create_database()

    for feed_url in RSS_FEEDS:

        feed = feedparser.parse(feed_url)

        for entry in feed.entries[:5]:

            intelligence = build_intelligence(
                entry.title
            )

            save_article(
                title=entry.title,
                link=entry.link,
                category=intelligence["category"],
                sentiment=intelligence["sentiment"],
                importance=intelligence["importance"],
                market_impact=intelligence["market_impact"],
                assets=intelligence["assets"],
                directions=intelligence["directions"],
                confidence=intelligence["confidence"],
                time_horizon=intelligence["time_horizon"]
            )

            print(intelligence)
            print("-" * 50)


if __name__ == "__main__":

    collect_news()
