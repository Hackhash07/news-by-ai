import json
import os
from datetime import datetime
from supabase import create_client, Client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")

supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def _utc_now_text():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

def _safe_json_loads(value, default):
    if value is None:
        return default
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return default

def create_database():
    pass

def save_article(
    title,
    link,
    category=None,
    sentiment=None,
    importance=None,
    market_impact=None,
    assets=None,
    directions=None,
    confidence=None,
    time_horizon=None,
    analysis=None,
    structured_analysis=None,
    added_at=None,
    source=None,
    published_at=None,
    image_url=None,
):
    if not supabase:
        print("Warning: Supabase not configured. Cannot save article.")
        return False
    
    try:
        # Check if already exists (duplicate protection)
        existing = supabase.table("news").select("id").eq("link", link).execute()
        if existing.data:
            return False # Duplicate skipped
            
        data = {
            "title": title,
            "link": link,
            "category": category,
            "sentiment": sentiment,
            "importance": importance,
            "market_impact": market_impact,
            "assets": assets if assets is not None else [],
            "directions": directions if directions is not None else {},
            "confidence": confidence,
            "time_horizon": time_horizon,
            "analysis": analysis or "",
            "structured_analysis": structured_analysis if structured_analysis is not None else {},
            "source": source,
            "published_at": published_at,
            "image_url": image_url
        }
        
        supabase.table("news").insert(data).execute()
        return True
    except Exception as e:
        print(f"Error saving article {link}: {e}")
        raise e

def get_articles():
    if not supabase:
        return []
    
    try:
        response = supabase.table("news").select("*").order("id", desc=True).execute()
        articles = []
        for row in response.data:
            articles.append({
                "id": row.get("id"),
                "title": row.get("title"),
                "link": row.get("link"),
                "category": row.get("category"),
                "sentiment": row.get("sentiment"),
                "importance": row.get("importance"),
                "market_impact": row.get("market_impact"),
                "assets": _safe_json_loads(row.get("assets"), []),
                "directions": _safe_json_loads(row.get("directions"), {}),
                "confidence": row.get("confidence"),
                "time_horizon": row.get("time_horizon"),
                "analysis": row.get("analysis"),
                "structured_analysis": _safe_json_loads(row.get("structured_analysis"), {}),
                "added_at": row.get("created_at") or row.get("added_at"),
            })
        return articles
    except Exception as e:
        print(f"Error fetching articles: {e}")
        return []

def get_existing_links(links: list) -> set:
    if not supabase or not links:
        return set()
    
    try:
        # Supabase in_ requires a comma-separated string or list depending on the client version.
        # Usually it accepts a list. Let's process in batches of 100 if needed, but 20 is fine.
        existing = set()
        # Querying the DB for the links
        response = supabase.table("news").select("link").in_("link", links).execute()
        if response.data:
            for row in response.data:
                existing.add(row.get("link"))
        return existing
    except Exception as e:
        print(f"Error fetching existing links: {e}")
        return set()

def save_message(room_slug, username, display_name, message):
    if not supabase:
        return None

    room_slug = (room_slug or "global").strip() or "global"
    username = (username or "Anonymous").strip()[:40] or "Anonymous"
    display_name = (display_name or username).strip()[:40] or username
    message = (message or "").strip()

    if not message:
        return None

    data = {
        "room_slug": room_slug,
        "username": username,
        "display_name": display_name,
        "message": message
    }
    
    try:
        response = supabase.table("chat_messages").insert(data).execute()
        if response.data:
            return response.data[0]
        return None
    except Exception as e:
        print(f"Error saving message: {e}")
        return None

def get_messages(room_slug="global", limit=100):
    if not supabase:
        return []

    room_slug = (room_slug or "global").strip() or "global"
    try:
        response = supabase.table("chat_messages").select("*").eq("room_slug", room_slug).order("id", desc=True).limit(int(limit)).execute()
        return list(reversed(response.data))
    except Exception as e:
        print(f"Error fetching messages: {e}")
        return []

def acquire_refresh_lock():
    if not supabase:
        return True
    try:
        response = supabase.table("refresh_locks").select("is_locked").eq("id", 1).execute()
        if not response.data:
            supabase.table("refresh_locks").insert({"id": 1, "is_locked": True, "locked_at": _utc_now_text()}).execute()
            return True
            
        if response.data[0].get("is_locked"):
            return False
            
        supabase.table("refresh_locks").update({"is_locked": True, "locked_at": _utc_now_text()}).eq("id", 1).execute()
        return True
    except Exception as e:
        print(f"Error acquiring lock: {e}")
        return False

def release_refresh_lock():
    if not supabase:
        return
    try:
        supabase.table("refresh_locks").update({"is_locked": False, "locked_at": None}).eq("id", 1).execute()
    except Exception as e:
        print(f"Error releasing lock: {e}")

def log_refresh(duration_seconds, inserted_count, duplicate_count, failed_count):
    if not supabase:
        return
    try:
        data = {
            "duration_seconds": duration_seconds,
            "inserted_count": inserted_count,
            "duplicate_count": duplicate_count,
            "failed_count": failed_count
        }
        supabase.table("refresh_logs").insert(data).execute()
    except Exception as e:
        print(f"Error logging refresh: {e}")

