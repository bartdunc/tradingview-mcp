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
    # Regime-filtered beta (validated OOS + battle-tested across assets and 123yr):
    # own the asset while it's above its trend SMA, step to cash below it.
    # Fixed-fractional sizing; the regime flip is the real exit, the wide ATR stop
    # is only a disaster backstop. Allocations size combined equity beta (SPY+QQQ,
    # highly correlated) ~= 1x, plus smaller uncorrelated BTC and GLD diversifier
    # sleeves. USO removed: the oil ETF is structurally broken (contango decay,
    # -95% buy&hold drawdown 2010-2026) — no strategy fixes a wealth-destroying
    # instrument. GLD is on regime_beta (clean-data battle test: cuts drawdown,
    # Sharpe up) as an equity-uncorrelated diversifier.
    "SPY": {
        "asset_class": "us_equity",
        "strategy": "regime_beta",
        "timeframe": "1Day",
        "params": {"sma_period": 100, "sizing": "fixed_fractional", "allocation": 0.5, "stop_atr_mult": 8.0},
    },
    "QQQ": {
        "asset_class": "us_equity",
        "strategy": "regime_beta",
        "timeframe": "1Day",
        "params": {"sma_period": 100, "sizing": "fixed_fractional", "allocation": 0.5, "stop_atr_mult": 8.0},
    },
    "BTC/USD": {
        "asset_class": "crypto",
        "strategy": "regime_beta",
        "timeframe": "1Day",
        "params": {"sma_period": 100, "sizing": "fixed_fractional", "allocation": 0.2, "stop_atr_mult": 8.0},
    },
    "GLD": {
        "asset_class": "us_equity",
        "strategy": "regime_beta",
        "timeframe": "1Day",
        "params": {"sma_period": 100, "sizing": "fixed_fractional", "allocation": 0.2, "stop_atr_mult": 8.0},
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
