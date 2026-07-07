import json
import urllib.request
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
        req = urllib.request.Request("https://api.frankfurter.app/latest?from=USD&to=INR")
        with urllib.request.urlopen(req, timeout=5) as res:
            data = json.loads(res.read().decode())
            result["USDINR"] = data["rates"]["INR"]
    except Exception as e:
        logger.error(f"Error fetching USDINR: {e}")
        result["USDINR"] = None

    # yfinance symbols
    symbols = {
        "GOLD": "GC=F",
        "NIFTY": "^NSEI",
        "BANKNIFTY": "^NSEBANK",
        "SPX": "^GSPC",
        "NASDAQ": "^IXIC",
        "BTC": "BTC-USD"
    }

    for key, symbol in symbols.items():
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1m&range=1d"
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
            with urllib.request.urlopen(req, timeout=5) as res:
                if res.status == 200:
                    data = json.loads(res.read().decode())
                    meta = data.get("chart", {}).get("result", [{}])[0].get("meta", {})
                    price = meta.get("regularMarketPrice")
                    result[key] = float(price) if price is not None else None
                else:
                    logger.error(f"Error fetching {key} ({symbol}): HTTP {res.status}")
                    result[key] = None
        except Exception as e:
            logger.error(f"Error fetching {key} ({symbol}): {e}")
            result[key] = None
    
    result["updated_at"] = now.isoformat()
    _cache["data"] = result
    _cache["expires_at"] = now + timedelta(seconds=CACHE_TTL)
    
    return result
