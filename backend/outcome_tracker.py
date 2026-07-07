import requests
from datetime import datetime, timedelta
from backend.database import supabase
from backend.market_utils import is_market_open_now, get_evaluation_time
import logging
import pytz
import yfinance as yf

logger = logging.getLogger(__name__)

# Tickers that are known to not work
SKIP_TICKERS = {
    "USDC", "USDT", "UNKNOWN", "", "N/A",
    "CRCL", "STRC",
    "FTSE350DEF=I", "BDI=F", "EWB", "GB10Y=RR",
    "BKM.L", "IMOEX.ME", "RUB=X", "^STOXX50E",
    "^SPNY", "BA.L", "CL=F", "BZ=F", "ITA",
    "NG=F", "ZC=F", "IRR=X", "^MSCIE", "EU10Y=F",
    "ASOS.L", "DJT", "UAL", "IBIT",
    "EUROBANKS=F", "UK10Y=RR", "DXY", "DX-Y.NYB",
}

def get_closest_price_yfinance(yahoo_ticker: str, target_time: datetime) -> float | None:
    """Fetch 5m candles ±30 mins around target_time and pick closest."""
    try:
        if target_time.tzinfo is None:
            target_time = target_time.replace(tzinfo=pytz.UTC)
            
        start = int((target_time - timedelta(minutes=30)).timestamp())
        end = int((target_time + timedelta(minutes=30)).timestamp())
        
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_ticker}?period1={start}&period2={end}&interval=5m"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        try:
            res = requests.get(url, headers=headers, timeout=2.5)
        except Exception as e:
            logger.error(f"yfinance direct API timed out for {yahoo_ticker}: {e}")
            return None
        
        if res.status_code != 200:
            logger.error(f"yfinance direct API failed for {yahoo_ticker}: HTTP {res.status_code}")
            return None
            
        try:
            data = res.json()
        except Exception:
            return None
        result = data.get("chart", {}).get("result")
        if not result:
            return None
            
        timestamps = result[0].get("timestamp", [])
        indicators = result[0].get("indicators", {}).get("quote", [{}])[0]
        closes = indicators.get("close", [])
        
        if not timestamps or not closes:
            return None
            
        # Find closest timestamp
        target_ts = target_time.timestamp()
        
        # Some closes might be None, filter them out with valid indices
        valid_indices = [i for i, c in enumerate(closes) if c is not None]
        if not valid_indices:
            return None
            
        closest_idx = min(valid_indices, key=lambda i: abs(timestamps[i] - target_ts))
        closest_price = closes[closest_idx]
        
        return float(closest_price)
        
    except Exception as e:
        logger.error(f"yfinance closest price fetch failed for {yahoo_ticker}: {e}")
        return None

def fetch_and_fill_outcomes():
    results = []
    try:
        now_utc = datetime.utcnow().replace(tzinfo=pytz.UTC).isoformat()
        
        # Pull up to 2 rows where status in PENDING, RETRY, AWAITING_MARKET and eval_time <= NOW
        response = supabase.table("signal_outcomes")\
            .select("*")\
            .in_("status", ["PENDING", "RETRY", "AWAITING_MARKET"])\
            .lte("evaluation_time", now_utc)\
            .order("evaluation_time", desc=False)\
            .limit(5)\
            .execute()
            
        signals = response.data
        if not signals:
            logger.info("No pending signals to evaluate")
            return results

        logger.info(f"Processing {len(signals)} pending signals")

        for signal in signals:
            ticker = signal.get("ticker")
            signal_id = signal["id"]
            
            # Update last_attempt
            current_time = datetime.utcnow().replace(tzinfo=pytz.UTC).isoformat()
            supabase.table("signal_outcomes").update({"last_attempt": current_time}).eq("id", signal_id).execute()
            
            if not ticker or ticker in SKIP_TICKERS:
                supabase.table("signal_outcomes").update({
                    "status": "UNRESOLVABLE",
                    "failure_reason": "Invalid or skipped ticker"
                }).eq("id", signal_id).execute()
                results.append({"ticker": ticker, "status": "UNRESOLVABLE"})
                continue
                
            signal_time_str = signal.get("signal_timestamp")
            eval_time_str = signal.get("evaluation_time")
            if not signal_time_str or not eval_time_str:
                continue
                
            # Check market open
            if not is_market_open_now(ticker, eval_time_str):
                # Roll forward evaluation time
                next_eval_time, status = get_evaluation_time(ticker, signal_time_str)
                supabase.table("signal_outcomes").update({
                    "evaluation_time": next_eval_time,
                    "status": status
                }).eq("id", signal_id).execute()
                logger.info(f"Market closed for {ticker} at {eval_time_str}, rolled forward to {next_eval_time}")
                results.append({"ticker": ticker, "status": "ROLLED_FORWARD", "next_eval_time": next_eval_time})
                continue

            # Parse times
            signal_time = datetime.fromisoformat(signal_time_str.replace("Z", "+00:00"))
            eval_time = datetime.fromisoformat(eval_time_str.replace("Z", "+00:00"))
            
            # Fetch prices
            price_signal = get_closest_price_yfinance(ticker, signal_time)
            price_after = get_closest_price_yfinance(ticker, eval_time)
            
            if price_signal is None or price_after is None:
                # No data
                retry_count = signal.get("retry_count", 0) + 1
                if retry_count < 5:
                    supabase.table("signal_outcomes").update({
                        "status": "RETRY",
                        "retry_count": retry_count,
                        "failure_reason": "Empty price data from yfinance"
                    }).eq("id", signal_id).execute()
                    results.append({"ticker": ticker, "status": "RETRY"})
                else:
                    supabase.table("signal_outcomes").update({
                        "status": "NO_DATA",
                        "retry_count": retry_count,
                        "failure_reason": "Max retries reached with empty price data"
                    }).eq("id", signal_id).execute()
                    results.append({"ticker": ticker, "status": "NO_DATA"})
                continue
                
            direction = signal.get("signal_direction")
            outcome_1h = "Neutral"
            
            pct_change = (price_after - price_signal) / price_signal if price_signal != 0 else 0
            
            if direction == "Bullish":
                if pct_change > 0.001:
                    outcome_1h = "Correct"
                elif pct_change < -0.001:
                    outcome_1h = "Incorrect"
            elif direction == "Bearish":
                if pct_change < -0.001:
                    outcome_1h = "Correct"
                elif pct_change > 0.001:
                    outcome_1h = "Incorrect"
                    
            # Map outcome_1h text back to the new status enum values
            status_map = {
                "Correct": "CORRECT",
                "Incorrect": "INCORRECT",
                "Neutral": "NEUTRAL"
            }
            
            # Update database
            update_data = {
                "price_signal": price_signal,
                "price_after": price_after,
                "percentage_change": pct_change,
                "status": status_map.get(outcome_1h, "NEUTRAL"),
                "evaluated_at": current_time,
                "provider_used": "yfinance",
                "outcome_1h": outcome_1h # Backward compatibility
            }
            
            try:
                supabase.table("signal_outcomes").update(update_data).eq("id", signal_id).execute()
                logger.info(f"Evaluated {ticker}: {outcome_1h} ({direction}, {pct_change:+.3%})")
                results.append({"ticker": ticker, "status": status_map.get(outcome_1h, "NEUTRAL"), "pct_change": pct_change})
            except Exception as e:
                logger.error(f"DB update failed for {ticker}: {e}")
                results.append({"ticker": ticker, "status": "ERROR", "error": str(e)})
                
    except Exception as e:
        logger.error(f"Error in outcome_tracker: {e}")
        
    return results

if __name__ == "__main__":
    fetch_and_fill_outcomes()
