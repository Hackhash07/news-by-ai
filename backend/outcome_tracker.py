import requests
from datetime import datetime, timedelta
from backend.database import supabase
import logging
import time
import os
import yfinance as yf

logger = logging.getLogger(__name__)

TWELVEDATA_API_KEY = os.getenv("TWELVEDATA_API_KEY", "")

# Tickers that are known to not work on either Twelve Data or yfinance
SKIP_TICKERS = {
    "USDC", "USDT", "UNKNOWN", "", "N/A",
    "CRCL", "STRC",  # Micro-cap / delisted
    "FTSE350DEF=I",  # Not available
    "BDI=F",  # Baltic Dry Index
    "EWB",  # Delisted ETF
    "GB10Y=RR",  # Bond yield
    "BKM.L",  # Obscure LSE ticker
    "IMOEX.ME",  # Russian index - restricted
    "RUB=X",  # Russian ruble - restricted
    "^STOXX50E",  # Euro Stoxx 50 - not on free tier
    "^SPNY",  # S&P Energy Sector - not on free tier
    "BA.L",  # LSE tickers unreliable
    "CL=F",  # Crude Oil futures
    "BZ=F",  # Brent futures
    "ITA",   # iShares Italy ETF
    "NG=F",  # Natural Gas - not on TwelveData free tier
    "ZC=F",  # Corn futures - not on TwelveData free tier
    "IRR=X", # Iranian Rial - restricted
    "^MSCIE", # MSCI EM index - not available
    "EU10Y=F", # EU bond yield
    "ASOS.L",  # LSE - unreliable
    "DJT",    # Trump Media - unreliable on free tier
    "UAL",    # United Airlines - unreliable on free tier
    "IBIT",   # ETF - not on TwelveData
}

# Yahoo-to-TwelveData symbol mapping for special tickers
SYMBOL_MAP = {
    "BTC-USD": "BTC/USD",
    "ETH-USD": "ETH/USD",
    "EURUSD=X": "EUR/USD",
    "USDJPY=X": "USD/JPY",
    "GBPUSD=X": "GBP/USD",
    "AUDUSD=X": "AUD/USD",
    "GC=F": "XAU/USD",    # Gold Futures → Gold spot
    "SI=F": "XAG/USD",    # Silver Futures → Silver spot
    "^GSPC": "SPX",       # S&P 500
    "^DJI": "DJI",        # Dow Jones
    "^IXIC": "IXIC",      # Nasdaq
}


def convert_ticker(yahoo_ticker: str) -> str:
    """Convert Yahoo Finance ticker format to Twelve Data format."""
    if yahoo_ticker in SYMBOL_MAP:
        return SYMBOL_MAP[yahoo_ticker]
    # Remove .L suffix for London stocks (Twelve Data uses different format)
    if yahoo_ticker.endswith(".L"):
        return yahoo_ticker  # Keep as-is, Twelve Data supports LSE tickers
    return yahoo_ticker


def fetch_price_yfinance(yahoo_ticker: str, target_time: datetime) -> tuple[float | None, float | None]:
    """Fallback: fetch price via yfinance for tickers unavailable on TwelveData."""
    try:
        start = target_time - timedelta(hours=2)
        end = target_time + timedelta(hours=4)
        hist = yf.download(yahoo_ticker, start=start, end=end, interval="1h", progress=False, auto_adjust=True)
        if hist.empty or len(hist) < 2:
            return None, None
        closes = hist["Close"].dropna().tolist()
        if len(closes) < 2:
            return None, None
        return float(closes[0]), float(closes[1])
    except Exception as e:
        logger.error(f"yfinance fallback failed for {yahoo_ticker}: {e}")
        return None, None


def fetch_price_at_time(ticker: str, target_time: datetime) -> tuple[float | None, float | None]:
    """
    Fetch the price at signal time and ~1 hour after.
    Tries TwelveData first, then falls back to yfinance.
    Returns (price_at_signal, price_1h_after) or (None, None) on failure.
    """
    td_symbol = convert_ticker(ticker)
    
    start_date = (target_time - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
    end_date = (target_time + timedelta(hours=3)).strftime("%Y-%m-%d %H:%M:%S")

    # --- Try TwelveData first ---
    if TWELVEDATA_API_KEY:
        try:
            url = "https://api.twelvedata.com/time_series"
            params = {
                "symbol": td_symbol,
                "interval": "1h",
                "start_date": start_date,
                "end_date": end_date,
                "timezone": "UTC",
                "outputsize": 5,
                "apikey": TWELVEDATA_API_KEY,
            }
            
            res = requests.get(url, params=params, timeout=10)
            res.raise_for_status()
            data = res.json()
            
            if "code" not in data or data["code"] == 200:
                values = data.get("values", [])
                if len(values) >= 2:
                    values.reverse()
                    return float(values[0]["close"]), float(values[1]["close"])
                elif len(values) == 1:
                    price = float(values[0]["close"])
                    return price, price
                    
        except Exception as e:
            logger.warning(f"Twelve Data fetch failed for {td_symbol}: {e}, trying yfinance...")

    # --- Fallback to yfinance (completely free, no API key needed) ---
    # Use the original yahoo-format ticker for yfinance
    yahoo_ticker = ticker  # ticker is already in yahoo format (e.g. ^GSPC, AAPL, BTC-USD)
    result = fetch_price_yfinance(yahoo_ticker, target_time)
    if result[0] is not None:
        logger.info(f"yfinance fallback succeeded for {yahoo_ticker}")
        return result

    logger.warning(f"No price data for {ticker} from any source")
    return None, None


def fetch_and_fill_outcomes():
    if not TWELVEDATA_API_KEY:
        logger.error("TWELVEDATA_API_KEY not configured — skipping outcome evaluation")
        return
        
    try:
        # Query signals where price_1h_after is NULL and signal is at least 2 hours old
        two_hours_ago = (datetime.utcnow() - timedelta(hours=2)).isoformat() + "Z"
        
        response = supabase.table("signal_outcomes")\
            .select("*")\
            .is_("price_1h_after", "null")\
            .lt("signal_timestamp", two_hours_ago)\
            .limit(8)\
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
                    logger.info(f"Skipped invalid ticker: {ticker}")
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
            
            # Rate-limit protection: respect Twelve Data's 8 credits/min limit
            time.sleep(8)
            
            price_at_signal, price_1h_after = fetch_price_at_time(ticker, signal_time)
            
            if price_at_signal is None or price_1h_after is None:
                logger.warning(f"No price data for {ticker}, skipping")
                continue
                
            direction = signal.get("signal_direction")
            outcome_1h = "Neutral"
            
            # Use a small threshold to avoid noise
            pct_change = (price_1h_after - price_at_signal) / price_at_signal if price_at_signal != 0 else 0
            
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

# TEST: curl http://localhost:5000/api/admin/evaluate-signals?secret=ChinnuU07
