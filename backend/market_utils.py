import pandas_market_calendars as mcal
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

def get_evaluation_time(ticker: str, signal_time_iso: str) -> tuple[str, str]:
    """
    Given a ticker and signal creation time (ISO format UTC), 
    returns a tuple of (evaluation_time_iso_utc, initial_status).
    """
    signal_time = datetime.fromisoformat(signal_time_iso.replace("Z", "+00:00"))
    if signal_time.tzinfo is None:
        signal_time = signal_time.replace(tzinfo=pytz.UTC)
        
    target_time = signal_time + timedelta(hours=1)
    
    if is_crypto(ticker):
        return target_time.isoformat(), 'PENDING'
        
    # For equities, check NYSE market hours
    nyse = mcal.get_calendar('NYSE')
    
    # Check if target_time is within market hours
    # get schedule for a window to be safe
    schedule = nyse.schedule(start_date=target_time.date() - timedelta(days=5), 
                             end_date=target_time.date() + timedelta(days=5))
                             
    # check if target_time falls inside any of the open hours
    for _, row in schedule.iterrows():
        market_open = row['market_open'].to_pydatetime()
        market_close = row['market_close'].to_pydatetime()
        
        if market_open <= target_time <= market_close:
            return target_time.isoformat(), 'PENDING'
            
    # If not within market hours, find the *next* market open after signal_time
    for _, row in schedule.iterrows():
        market_open = row['market_open'].to_pydatetime()
        if market_open > signal_time:
            next_eval_time = market_open + timedelta(hours=1)
            return next_eval_time.isoformat(), 'AWAITING_MARKET'
            
    # Fallback just in case (e.g. holidays very far out)
    return target_time.isoformat(), 'AWAITING_MARKET'

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
        
    nyse = mcal.get_calendar('NYSE')
    schedule = nyse.schedule(start_date=target_time.date(), end_date=target_time.date())
    
    if schedule.empty:
        return False
        
    row = schedule.iloc[0]
    market_open = row['market_open'].to_pydatetime()
    market_close = row['market_close'].to_pydatetime()
    
    return market_open <= target_time <= market_close
