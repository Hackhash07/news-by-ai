import schedule
import time

from backend.news_collector import collect_news

def job():

    print("Collecting news...")

    collect_news()

    print("Done")


schedule.every(15).minutes.do(job)

job()

while True:

    schedule.run_pending()

    time.sleep(60)
