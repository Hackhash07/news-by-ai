from database import get_articles

rows = get_articles()

for row in rows:
    print(row)
