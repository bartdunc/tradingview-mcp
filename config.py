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
    # Non-trend sleeve: static bond-carry anchor (term premium), HELD not traded.
    # Genuinely uncorrelated to the trend book (-0.06). Deliberately small — this is
    # deflationary-crash insurance (2008: +6% vs -4%), and it costs you in inflationary
    # regimes (2022: -12.6% vs -10.4%). Never stopped out (wide stop = held forever).
    "IEF": {
        "asset_class": "us_equity",
        "strategy": "buy_hold",
        "timeframe": "1Day",
        "params": {"sizing": "fixed_fractional", "allocation": 0.15, "stop_atr_mult": 999.0},
    },
}

# --- Non-trend sleeve (ENABLED — IEF bond-carry anchor above) ---------------
# Full study: docs/NON_TREND_SLEEVE.md. Enabled as a deliberate INSURANCE choice,
# not because it is a risk-adjusted free lunch. What you are buying and paying:
#   + genuinely uncorrelated to the trend book (-0.06); best deflationary-bust
#     protection on the board (2008: +6.2% vs the trend book's -3.7%)
#   - split-half shows the Sharpe lift was the 2007-2016 bond bull; it HURT in
#     2017-2026 (2022 crushed stocks AND bonds together: -12.6% vs -10.4%)
#   - raises gross exposure 1.4x -> 1.55x, and the trend book alone remains the
#     most drawdown-efficient configuration (Calmar 0.68)
# Set False (and drop the IEF entry) to revert to the pure trend book.
NON_TREND_SLEEVE_ENABLED = True

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
