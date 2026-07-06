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
    source_weight=1.0,
    source_tier='secondary',
    analysis_source='headline_only',
    content_signature=None,
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
            "created_at": added_at or _utc_now_text(),
            "source": source,
            "published_at": published_at,
            "image_url": image_url,
            "source_weight": source_weight,
            "source_tier": source_tier,
            "analysis_source": analysis_source,
            "content_signature": content_signature
        }
        
        res = supabase.table("news").insert(data).execute()
        
        # Log to signal_outcomes for quant backtesting
        if res.data and len(res.data) > 0:
            news_id = res.data[0].get("id")
            if assets and structured_analysis:
                affected_assets = structured_analysis.get("affected_assets", [])
                for a in affected_assets:
                    if a.get("direction") != "Neutral" and a.get("ticker") != "UNKNOWN":
                        from backend.market_utils import get_evaluation_time
                        eval_hours = a.get("evaluation_window_hours", 1)
                        eval_time, status = get_evaluation_time(a.get("ticker"), data["created_at"], hours=eval_hours)
                        
                        signal_data = {
                            "news_id": news_id,
                            "ticker": a.get("ticker"),
                            "signal_direction": a.get("direction"),
                            "confidence": int(a.get("confidence", 50)),
                            "signal_timestamp": data["created_at"],
                            "evaluation_time": eval_time,
                            "status": status
                        }
                        try:
                            supabase.table("signal_outcomes").insert(signal_data).execute()
                        except Exception as e:
                            print(f"Error saving signal outcome: {e}")
                            
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
                "bullish_votes": row.get("bullish_votes") or 0,
                "bearish_votes": row.get("bearish_votes") or 0,
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
        response = supabase.table("refresh_locks").select("*").eq("id", 1).execute()
        if not response.data:
            supabase.table("refresh_locks").insert({"id": 1, "is_locked": True, "locked_at": _utc_now_text()}).execute()
            return True
            
        if response.data[0].get("is_locked"):
            locked_at_str = response.data[0].get("locked_at")
            if locked_at_str:
                from datetime import datetime, timedelta
                # Strip timezone info manually to avoid Python 3.9 fromisoformat errors
                clean_str = locked_at_str.split('+')[0].replace('Z', '')
                try:
                    # In case of fractional seconds like .123456
                    clean_str = clean_str.split('.')[0]
                    locked_at = datetime.fromisoformat(clean_str)
                    if datetime.utcnow() - locked_at > timedelta(minutes=15):
                        print("Lock is stale (older than 15 minutes). Breaking it.")
                        supabase.table("refresh_locks").update({"is_locked": True, "locked_at": _utc_now_text()}).eq("id", 1).execute()
                        return True
                except Exception as parse_e:
                    print(f"Error parsing lock time {clean_str}: {parse_e}")
                    # If we can't parse it for some reason, just break the lock as a safety measure
                    supabase.table("refresh_locks").update({"is_locked": True, "locked_at": _utc_now_text()}).eq("id", 1).execute()
                    return True
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

# ==============================================================================
# FEATURE 1: Prediction Market Voting
# ==============================================================================
def vote_on_news(news_id, user_id, vote_type):
    if not supabase:
        return {"error": "Supabase not configured"}
    
    try:
        # Check if user already voted
        existing = supabase.table("news_votes").select("vote").eq("user_id", user_id).eq("news_id", news_id).execute()
        if existing.data:
            return {"error": "User has already voted"}
            
        # Insert vote
        supabase.table("news_votes").insert({
            "user_id": user_id,
            "news_id": news_id,
            "vote": vote_type
        }).execute()
        
        # Increment news counter (unfortunately supabase-py doesn't have an increment RPC by default)
        # So we fetch current and update. 
        news_row = supabase.table("news").select("bullish_votes, bearish_votes").eq("id", news_id).execute()
        if not news_row.data:
            return {"error": "News not found"}
            
        current = news_row.data[0]
        bullish = current.get("bullish_votes") or 0
        bearish = current.get("bearish_votes") or 0
        
        if vote_type == 'bullish':
            bullish += 1
        else:
            bearish += 1
            
        supabase.table("news").update({
            "bullish_votes": bullish,
            "bearish_votes": bearish
        }).eq("id", news_id).execute()
        
        return {"bullish_votes": bullish, "bearish_votes": bearish}
    except Exception as e:
        print(f"Error voting on news: {e}")
        return {"error": str(e)}

# ==============================================================================
# FEATURE 3: ELO and Streak Updates
# ==============================================================================
def update_profile_stats(user_id, won, new_elo):
    if not supabase:
        return False
        
    try:
        profile = supabase.table("profiles").select("peak_elo, matches_played, matches_won").eq("id", user_id).execute()
        if not profile.data:
            return False
            
        current = profile.data[0]
        peak = max(new_elo, current.get("peak_elo") or 0)
        played = (current.get("matches_played") or 0) + 1
        wins = (current.get("matches_won") or 0) + (1 if won else 0)
        
        supabase.table("profiles").update({
            "elo_score": new_elo,
            "peak_elo": peak,
            "matches_played": played,
            "matches_won": wins
        }).eq("id", user_id).execute()
        return True
    except Exception as e:
        print(f"Error updating profile stats: {e}")
        return False

def update_profile_streak(user_id):
    if not supabase:
        return False
        
    try:
        profile = supabase.table("profiles").select("last_active, streak_days").eq("id", user_id).execute()
        if not profile.data:
            return False
            
        current = profile.data[0]
        last_active_str = current.get("last_active")
        streak = current.get("streak_days") or 0
        
        today = datetime.utcnow().date()
        
        if last_active_str:
            last_active = datetime.strptime(last_active_str, "%Y-%m-%d").date()
            diff = (today - last_active).days
            
            if diff == 1:
                streak += 1
            elif diff > 1:
                streak = 1
            elif diff == 0:
                pass # Already updated today
        else:
            streak = 1
            
        supabase.table("profiles").update({
            "streak_days": streak,
            "last_active": today.isoformat()
        }).eq("id", user_id).execute()
        
        return {"streak_days": streak, "last_active": today.isoformat()}
    except Exception as e:
        print(f"Error updating streak: {e}")
        return False

# ==============================================================================
# FEATURE 4: Daily Brief
# ==============================================================================
def save_morning_brief(brief_date, headline, summary, top_assets, overall_sentiment):
    if not supabase:
        return False
        
    try:
        data = {
            "brief_date": brief_date,
            "headline": headline,
            "summary": summary,
            "top_assets": top_assets,
            "overall_sentiment": overall_sentiment
        }
        supabase.table("daily_briefs").upsert(data, on_conflict="brief_date").execute()
        return True
    except Exception as e:
        print(f"Error saving morning brief: {e}")
        return False

def get_morning_brief(brief_date):
    if not supabase:
        return None
        
    try:
        response = supabase.table("daily_briefs").select("*").eq("brief_date", brief_date).execute()
        if response.data:
            return response.data[0]
        return None
    except Exception as e:
        print(f"Error fetching morning brief: {e}")
        return None

def cleanup_old_news(max_total=210, target_total=200, delete_up_to_importance=4):
    """
    Cleans up old news articles if the total count exceeds max_total.
    Prefers deleting old low-importance articles. If none exist, deletes the oldest articles 
    unconditionally to preserve recently added news (even if low importance).
    """
    if not supabase:
        return
        
    try:
        from datetime import datetime, timedelta
        
        # Get total count
        res = supabase.table("news").select("id", count="exact").limit(1).execute()
        total_count = res.count if res.count is not None else 0
        
        if total_count <= max_total:
            return
            
        excess = total_count - target_total
        if excess <= 0:
            return
            
        # Define what counts as 'old' (e.g. older than 24 hours)
        cutoff = (datetime.utcnow() - timedelta(hours=24)).isoformat()
        
        # 1. Find OLD low-importance articles first
        res_oldest = supabase.table("news") \
            .select("id") \
            .lte("importance", delete_up_to_importance) \
            .lt("created_at", cutoff) \
            .order("created_at", desc=False) \
            .limit(excess) \
            .execute()
            
        ids_deleted = 0
        if res_oldest.data:
            ids_to_delete = [row["id"] for row in res_oldest.data]
            if ids_to_delete:
                # First delete foreign key dependencies
                supabase.table("news_votes").delete().in_("news_id", ids_to_delete).execute()
                supabase.table("signal_outcomes").delete().in_("news_id", ids_to_delete).execute()
                # Now delete the actual news rows
                supabase.table("news").delete().in_("id", ids_to_delete).execute()
                ids_deleted += len(ids_to_delete)
                print(f"Cleaned up {len(ids_to_delete)} old low-importance news articles.")
                
        # 2. If we STILL have excess, delete the oldest articles unconditionally
        # This protects brand new low-importance articles by sacrificing old high-importance ones.
        remaining_excess = excess - ids_deleted
        if remaining_excess > 0:
            res_hard_oldest = supabase.table("news") \
                .select("id") \
                .order("created_at", desc=False) \
                .limit(remaining_excess) \
                .execute()
                
            if res_hard_oldest.data:
                hard_ids_to_delete = [row["id"] for row in res_hard_oldest.data]
                if hard_ids_to_delete:
                    supabase.table("news_votes").delete().in_("news_id", hard_ids_to_delete).execute()
                    supabase.table("signal_outcomes").delete().in_("news_id", hard_ids_to_delete).execute()
                    supabase.table("news").delete().in_("id", hard_ids_to_delete).execute()
                    print(f"Cleaned up {len(hard_ids_to_delete)} oldest overall articles to reach target limit.")
            
    except Exception as e:
        print(f"Error cleaning up old news: {e}")

def get_top_recent_news(hours=18, limit=5):
    if not supabase:
        return []
    
    try:
        from datetime import timedelta
        cutoff = (datetime.utcnow() - timedelta(hours=hours)).isoformat()
        response = supabase.table("news").select("*").gte("created_at", cutoff).order("importance", desc=True).limit(limit).execute()
        return response.data
    except Exception as e:
        print(f"Error fetching top recent news: {e}")
        return []
