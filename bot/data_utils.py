"""Alpaca API client and historical/live bar fetch helpers."""
from datetime import datetime, timedelta, timezone

import pandas as pd
from alpaca_trade_api import REST, TimeFrame, TimeFrameUnit

import config

_ALPACA_TIMEFRAMES = {
    "15Min": TimeFrame(15, TimeFrameUnit.Minute),
    "1Hour": TimeFrame(1, TimeFrameUnit.Hour),
    "4Hour": TimeFrame(4, TimeFrameUnit.Hour),
}

BROKER_SYMBOLS = {symbol: symbol.replace("/", "") for symbol in config.INSTRUMENTS}
FROM_BROKER_SYMBOL = {broker: symbol for symbol, broker in BROKER_SYMBOLS.items()}


def get_api():
    return REST(
        key_id=config.ALPACA_API_KEY,
        secret_key=config.ALPACA_SECRET_KEY,
        base_url=config.ALPACA_BASE_URL,
    )


def fetch_bars(api, symbol, asset_class, timeframe_name, start, end=None, limit=None):
    """Return an OHLCV DataFrame (open/high/low/close/volume) sorted ascending by time."""
    tf = _ALPACA_TIMEFRAMES[timeframe_name]
    kwargs = {"timeframe": tf, "start": start.isoformat()}
    if end is not None:
        kwargs["end"] = end.isoformat()
    if limit is not None:
        kwargs["limit"] = limit

    if asset_class == "crypto":
        bars = api.get_crypto_bars(symbol, **kwargs)
    else:
        # Free Alpaca data plans only permit the IEX feed for recent data;
        # the default SIP feed 403s with "subscription does not permit
        # querying recent SIP data" once the requested range reaches "now".
        kwargs["feed"] = "iex"
        bars = api.get_bars(symbol, **kwargs)

    df = bars.df
    if df is None or df.empty:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

    if isinstance(df.index, pd.MultiIndex):
        df = df.xs(symbol, level=0)

    return df[["open", "high", "low", "close", "volume"]].sort_index()


def fetch_recent_bars(api, symbol, asset_class, timeframe_name, bars_needed):
    """Enough lookback for the slowest strategy (200-period EMA) plus a buffer."""
    seconds_per_bar = config.TIMEFRAME_SECONDS[timeframe_name]
    lookback_seconds = seconds_per_bar * (bars_needed + 50)
    start = datetime.now(timezone.utc) - timedelta(seconds=lookback_seconds)
    return fetch_bars(api, symbol, asset_class, timeframe_name, start)


def is_market_open(api, asset_class):
    if asset_class == "crypto":
        return True
    return api.get_clock().is_open
