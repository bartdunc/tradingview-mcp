"""Central configuration for the multi-strategy Alpaca trading bot."""
import os

from dotenv import load_dotenv

load_dotenv()

ALPACA_API_KEY = os.getenv("ALPACA_API_KEY", "")
ALPACA_SECRET_KEY = os.getenv("ALPACA_SECRET_KEY", "")
ALPACA_BASE_URL = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets")

# Risk management — non-negotiable, applies across every instrument.
RISK_PER_TRADE = 0.01  # 1% of equity risked per trade
ATR_PERIOD = 14
MAX_PORTFOLIO_DRAWDOWN = 0.10  # circuit breaker: flatten everything and halt

# Live-loop bookkeeping
TRADES_LOG_PATH = "trades.csv"
DAILY_PNL_LOG_PATH = "daily_pnl.csv"
LOOP_INTERVAL_SECONDS = 60

INSTRUMENTS = {
    "SPY": {
        "asset_class": "us_equity",
        "strategy": "mean_reversion",
        "timeframe": "15Min",
        "params": {"lookback": 20, "std_dev_threshold": 1.5, "exit_std_dev": 0.25},
    },
    "QQQ": {
        "asset_class": "us_equity",
        "strategy": "mean_reversion",
        "timeframe": "15Min",
        "params": {"lookback": 20, "std_dev_threshold": 1.8, "exit_std_dev": 0.25},
    },
    "BTC/USD": {
        "asset_class": "crypto",
        "strategy": "momentum_breakout",
        "timeframe": "1Hour",
        "params": {"lookback": 20, "volume_multiplier": 1.5, "trailing_atr_mult": 2.0},
    },
    "GLD": {
        "asset_class": "us_equity",
        "strategy": "trend_following",
        "timeframe": "4Hour",
        "params": {"fast_ema": 50, "slow_ema": 200, "trailing_atr_mult": 3.0},
    },
    "USO": {
        "asset_class": "us_equity",
        "strategy": "trend_following",
        "timeframe": "4Hour",
        "params": {"fast_ema": 50, "slow_ema": 200, "trailing_atr_mult": 3.0},
    },
}

# If every symbol in `leaders` is already long, block new long entries on `blocked`.
# Prevents doubling up on correlated risk-on exposure (e.g. SPY + QQQ + BTC all long at once).
CORRELATION_FILTER = [
    {"leaders": ["SPY", "QQQ"], "blocked": ["BTC/USD"], "direction": "long"},
]

TIMEFRAME_SECONDS = {
    "15Min": 15 * 60,
    "1Hour": 60 * 60,
    "4Hour": 4 * 60 * 60,
}
