from datetime import datetime, timedelta

locked_at_str = "2026-07-04T08:00:56+00:00"
locked_at = datetime.fromisoformat(locked_at_str.replace("Z", "+00:00")).replace(tzinfo=None)
print("Locked at:", locked_at)
print("UTC now:", datetime.utcnow())
print("Diff:", datetime.utcnow() - locked_at)
if datetime.utcnow() - locked_at > timedelta(minutes=15):
    print("Will break lock!")
