import sqlite3
import json

conn = sqlite3.connect('database/news.db')
conn.row_factory = sqlite3.Row
c = conn.cursor()

c.execute("SELECT * FROM news")
rows = c.fetchall()

with open('database/migrate_data.sql', 'w') as f:
    f.write("-- Migration script to copy old articles to Supabase\n")
    for row in rows:
        title = row['title'].replace("'", "''")
        link = row['link'].replace("'", "''")
        category = (row['category'] or "").replace("'", "''")
        sentiment = (row['sentiment'] or "").replace("'", "''")
        importance = row['importance'] if row['importance'] is not None else 'NULL'
        market_impact = (row['market_impact'] or "").replace("'", "''")
        
        assets = row['assets'] or '[]'
        assets_esc = assets.replace("'", "''")
        
        directions = row['directions'] or '{}'
        directions_esc = directions.replace("'", "''")
        
        confidence = row['confidence'] if row['confidence'] is not None else 'NULL'
        time_horizon = (row['time_horizon'] or "").replace("'", "''")
        analysis = (row['analysis'] or "").replace("'", "''")
        
        # SQLite had added_at, Supabase uses created_at
        added_at = row['added_at'] if 'added_at' in row.keys() else None
        added_at_val = f"'{added_at}'" if added_at else "now()"
        
        sql = f"""
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('{title}', '{link}', '{category}', '{sentiment}', {importance}, '{market_impact}', '{assets_esc}'::jsonb, '{directions_esc}'::jsonb, {confidence}, '{time_horizon}', '{analysis}', {added_at_val})
ON CONFLICT (link) DO NOTHING;
"""
        f.write(sql.strip() + "\n")

print(f"Generated SQL for {len(rows)} articles.")
