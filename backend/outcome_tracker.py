import yfinance as yf
from datetime import datetime, timedelta
from backend.database import supabase
import logging
import time

logger = logging.getLogger(__name__)

# Tickers that are known to not exist on Yahoo Finance — skip them to avoid wasted calls
SKIP_TICKERS = {
    "USDC", "USDT", "UNKNOWN", "", "N/A",
    "CRCL", "STRC",  # Micro-cap / delisted
}

def safe_yf_download(ticker: str, start, end) -> float | None:
    """Download price data with retry and delay to avoid rate limits on Render."""
    for attempt in range(2):
        try:
            df = yf.download(
                ticker,
                start=start,
                end=end,
                interval="1h",
                progress=False,
                auto_adjust=True,
            )
            if df.empty:
                logger.warning(f"yf.download returned empty for {ticker} (attempt {attempt+1})")
                time.sleep(2)
                continue
            return df
        except Exception as e:
            logger.warning(f"yf.download failed for {ticker} (attempt {attempt+1}): {e}")
            time.sleep(2)
    return None


def fetch_and_fill_outcomes():
    try:
        # 1. Query signals where price_1h_after is NULL and signal is at least 2 hours old
        two_hours_ago = (datetime.utcnow() - timedelta(hours=2)).isoformat() + "Z"
        
        response = supabase.table("signal_outcomes")\
            .select("*")\
            .is_("price_1h_after", "null")\
            .lt("signal_timestamp", two_hours_ago)\
            .limit(10)\
            .execute()
            
        signals = response.data
        if not signals:
            logger.info("No pending signals to evaluate")
            return

        logger.info(f"Processing {len(signals)} pending signals")
        processed = 0
        skipped = 0

        for signal in signals:
            ticker = signal.get("ticker")
            if not ticker or ticker in SKIP_TICKERS:
                # Mark as Neutral so we don't keep retrying bad tickers
                try:
                    supabase.table("signal_outcomes").update({
                        "outcome_1h": "Neutral",
                        "price_at_signal": 0,
                        "price_1h_after": 0,
                    }).eq("id", signal["id"]).execute()
                except Exception:
                    pass
                skipped += 1
                continue
                
            signal_time_str = signal.get("signal_timestamp")
            if not signal_time_str:
                continue
                
            # Parse timestamp
            signal_time_str = signal_time_str.replace("Z", "+00:00")
            signal_time = datetime.fromisoformat(signal_time_str)
            
            # Fetch historical data — wider window to ensure we get enough bars
            start_time = signal_time - timedelta(hours=1)
            end_time = signal_time + timedelta(hours=4)
            
            # Rate-limit protection: sleep between each Yahoo call
            time.sleep(2)
            
            ticker_data = safe_yf_download(ticker, start=start_time, end=end_time)
            
            if ticker_data is None or (hasattr(ticker_data, 'empty') and ticker_data.empty):
                logger.warning(f"No data for {ticker}, skipping")
                continue
                
            closes = ticker_data['Close']
            if len(closes) < 2:
                logger.warning(f"Not enough bars for {ticker} ({len(closes)} bars)")
                continue
                
            price_at_signal = float(closes.iloc[0])
            price_1h_after = float(closes.iloc[min(1, len(closes)-1)])
            
            direction = signal.get("signal_direction")
            outcome_1h = "Neutral"
            
            # Use a small threshold to avoid noise
            pct_change = (price_1h_after - price_at_signal) / price_at_signal if price_at_signal != 0 else 0
            
            if direction == "Bullish":
                if pct_change > 0.001:  # >0.1% move up
                    outcome_1h = "Correct"
                elif pct_change < -0.001:
                    outcome_1h = "Incorrect"
            elif direction == "Bearish":
                if pct_change < -0.001:  # >0.1% move down
                    outcome_1h = "Correct"
                elif pct_change > 0.001:
                    outcome_1h = "Incorrect"
                    
            # Update database
            update_data = {
                "price_at_signal": price_at_signal,
                "price_1h_after": price_1h_after,
                "outcome_1h": outcome_1h
            }
            
            try:
                supabase.table("signal_outcomes").update(update_data).eq("id", signal["id"]).execute()
                logger.info(f"Evaluated {ticker}: {outcome_1h} ({direction}, {pct_change:+.3%})")
                processed += 1
            except Exception as e:
                logger.error(f"DB update failed for {ticker}: {e}")
                
        logger.info(f"Outcome tracker done: {processed} evaluated, {skipped} skipped")
                
    except Exception as e:
        logger.error(f"Error in outcome_tracker: {e}")

if __name__ == "__main__":
    fetch_and_fill_outcomes()
