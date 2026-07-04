from backend.database import supabase
jobs = supabase.table("job_log").select("*").order("started_at", desc=True).limit(10).execute()
for j in jobs.data:
    print(j.get("started_at"), j.get("status"), j.get("articles_processed"))
