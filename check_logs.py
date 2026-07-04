import os
import json
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# 1. Check refresh_locks
locks = supabase.table("refresh_locks").select("*").execute()
print("Locks:", locks.data)

# 2. Check refresh_logs (last 5)
logs = supabase.table("refresh_logs").select("*").order("created_at", desc=True).limit(5).execute()
print("\nRecent refresh_logs:")
for log in logs.data:
    print(log)

# 3. Check job_log (last 5)
jobs = supabase.table("job_log").select("*").order("id", desc=True).limit(5).execute()
print("\nRecent job_logs:")
for job in jobs.data:
    print(job)

