import yfinance as yf
from datetime import datetime, timedelta
from backend.database import supabase

def fetch_and_fill_outcomes():
    try:
        # 1. Query signals where price_1h_after is NULL and signal is at least 1 hour old
        one_hour_ago = (datetime.utcnow() - timedelta(hours=1)).isoformat() + "Z"
        
        response = supabase.table("signal_outcomes")\
            .select("*")\
            .is_("price_1h_after", "null")\
            .lt("signal_timestamp", one_hour_ago)\
            .execute()
            
        signals = response.data
        if not signals:
            return

        for signal in signals:
            ticker = signal.get("ticker")
            if not ticker or ticker == "UNKNOWN":
                continue
                
            signal_time_str = signal.get("signal_timestamp")
            if not signal_time_str:
                continue
                
            # Parse timestamp (handle Z or +00:00)
            signal_time_str = signal_time_str.replace("Z", "+00:00")
            signal_time = datetime.fromisoformat(signal_time_str)
            
            # Fetch historical data using yfinance
            # We fetch a slightly wider window to ensure we get data
            start_time = signal_time
            end_time = signal_time + timedelta(hours=24) # We might not get 24h data immediately, but we request it
            
            try:
                # yfinance returns pandas DataFrame
                ticker_data = yf.download(ticker, start=start_time, end=end_time, interval="1h", progress=False)
                
                # Check for empty dataframe as requested by user
                if ticker_data.empty:
                    print(f"yfinance returned empty data for {ticker} at {start_time}")
                    continue
                    
                # We need the close price at the signal time (or the closest available after)
                # and the close price 1 hour later, 24 hours later, etc.
                
                # For simplicity in this implementation, we take the first available close as price_at_signal
                # and the last available as price_1h_after (assuming we fetched ~2 hours of data)
                closes = ticker_data['Close']
                if len(closes) < 2:
                    continue
                    
                price_at_signal = float(closes.iloc[0])
                price_1h_after = float(closes.iloc[1])
                
                direction = signal.get("signal_direction")
                outcome_1h = "Neutral"
                
                if direction == "Bullish":
                    outcome_1h = "Correct" if price_1h_after > price_at_signal else "Incorrect"
                elif direction == "Bearish":
                    outcome_1h = "Correct" if price_1h_after < price_at_signal else "Incorrect"
                    
                # Update database
                update_data = {
                    "price_at_signal": price_at_signal,
                    "price_1h_after": price_1h_after,
                    "outcome_1h": outcome_1h
                }
                
                supabase.table("signal_outcomes").update(update_data).eq("id", signal["id"]).execute()
                print(f"Updated backtest for {ticker}: {outcome_1h} ({direction})")
                
            except Exception as e:
                print(f"Error fetching yfinance data for {ticker}: {e}")
                
    except Exception as e:
        print(f"Error in outcome_tracker: {e}")

if __name__ == "__main__":
    fetch_and_fill_outcomes()
