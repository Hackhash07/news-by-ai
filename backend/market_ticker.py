import yfinance as yf
import requests
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

_cache = {"data": None, "expires_at": None}
CACHE_TTL = 60  # seconds

def get_ticker_data():
    now = datetime.utcnow()
    if _cache["data"] and _cache["expires_at"] and now < _cache["expires_at"]:
        return _cache["data"]
    
    result = {}
    
    # USD/INR
    try:
        res = requests.get("https://api.frankfurter.app/latest?from=USD&to=INR", timeout=5)
        res.raise_for_status()
        result["USDINR"] = res.json()["rates"]["INR"]
    except Exception as e:
        logger.error(f"Error fetching USDINR: {e}")
        result["USDINR"] = None

    # yfinance symbols
    symbols = {
        "GOLD": "GC=F",
        "NIFTY": "^NSEI",
        "BANKNIFTY": "^NSEBANK",
        "SPX": "^GSPC",
        "NASDAQ": "^IXIC"
    }

    for key, symbol in symbols.items():
        try:
            ticker = yf.Ticker(symbol)
            result[key] = ticker.fast_info.last_price
        except Exception as e:
            logger.error(f"Error fetching {key} ({symbol}): {e}")
            result[key] = None
    
    result["updated_at"] = now.isoformat()
    _cache["data"] = result
    _cache["expires_at"] = now + timedelta(seconds=CACHE_TTL)
    
    return result
