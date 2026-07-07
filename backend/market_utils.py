from datetime import datetime, timedelta
import pytz

# Crypto tickers or suffixes
CRYPTO_TICKERS = {'BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'DOT', 'AVAX', 'LINK', 'LTC'}
CRYPTO_SUFFIXES = ('-USD', 'USDT')

def is_crypto(ticker: str) -> bool:
    ticker_upper = ticker.upper()
    if ticker_upper in CRYPTO_TICKERS:
        return True
    if any(ticker_upper.endswith(suffix) for suffix in CRYPTO_SUFFIXES):
        return True
    return False

def get_next_market_open(current_time: datetime) -> datetime:
    """Find the next NYSE market open (9:30 AM Eastern) after current_time."""
    eastern = pytz.timezone('US/Eastern')
    curr_est = current_time.astimezone(eastern)
    
    # Start checking from today
    check_date = curr_est
    
    while True:
        # Check if it's a weekday (0 = Monday, 4 = Friday)
        if check_date.weekday() < 5:
            market_open = check_date.replace(hour=9, minute=30, second=0, microsecond=0)
            if curr_est < market_open:
                return market_open.astimezone(pytz.UTC)
                
        # Move to next day at 9:30 AM EST
        check_date = (check_date + timedelta(days=1)).replace(hour=9, minute=30, second=0, microsecond=0)

def get_evaluation_time(ticker: str, signal_time_iso: str, hours: int = 1) -> tuple[str, str]:
    """
    Given a ticker and signal creation time (ISO format UTC), 
    returns a tuple of (evaluation_time_iso_utc, initial_status).
    """
    signal_time = datetime.fromisoformat(signal_time_iso.replace("Z", "+00:00"))
    if signal_time.tzinfo is None:
        signal_time = signal_time.replace(tzinfo=pytz.UTC)
        
    target_time = signal_time + timedelta(hours=hours)
    
    if is_crypto(ticker):
        return target_time.isoformat(), 'PENDING'
        
    eastern = pytz.timezone('US/Eastern')
    target_est = target_time.astimezone(eastern)
    
    # Check if target_est is during market hours (Mon-Fri, 9:30 AM to 4:00 PM)
    if target_est.weekday() < 5:
        market_open = target_est.replace(hour=9, minute=30, second=0, microsecond=0)
        market_close = target_est.replace(hour=16, minute=0, second=0, microsecond=0)
        
        if market_open <= target_est <= market_close:
            return target_time.isoformat(), 'PENDING'
            
    # If not within market hours, find the *next* market open after signal_time
    next_open = get_next_market_open(signal_time)
    next_eval_time = next_open + timedelta(hours=hours)
    return next_eval_time.isoformat(), 'AWAITING_MARKET'

def is_market_open_now(ticker: str, target_time_iso: str) -> bool:
    """
    Check if the market was open at target_time_iso.
    We check this before querying yfinance to ensure we don't fetch if the market is closed.
    """
    if is_crypto(ticker):
        return True
        
    target_time = datetime.fromisoformat(target_time_iso.replace("Z", "+00:00"))
    if target_time.tzinfo is None:
        target_time = target_time.replace(tzinfo=pytz.UTC)
        
    eastern = pytz.timezone('US/Eastern')
    target_est = target_time.astimezone(eastern)
    
    if target_est.weekday() >= 5:
        return False
        
    market_open = target_est.replace(hour=9, minute=30, second=0, microsecond=0)
    market_close = target_est.replace(hour=16, minute=0, second=0, microsecond=0)
    
    return market_open <= target_est <= market_close
