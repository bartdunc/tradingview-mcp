"""ATR-based position sizing and risk controls shared by every strategy.

Sizing a position at (equity * risk_per_trade) / atr guarantees a 1-ATR adverse
move costs exactly risk_per_trade of equity — that distance IS the hard stop.
Trailing stops (2x/3x ATR for momentum/trend) only ever ratchet in the
position's favor on top of that, so risk never exceeds the original 1% cap.
"""
import pandas as pd


def calculate_atr(df, period=14):
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    true_range = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return true_range.rolling(period).mean()


class RiskManager:
    def __init__(self, risk_per_trade=0.01, atr_period=14, max_portfolio_drawdown=0.10):
        self.risk_per_trade = risk_per_trade
        self.atr_period = atr_period
        self.max_portfolio_drawdown = max_portfolio_drawdown

    def position_size(self, equity, atr):
        """Shares/contracts such that a 1-ATR adverse move costs risk_per_trade of equity."""
        if atr is None or atr <= 0 or equity <= 0:
            return 0.0
        return (equity * self.risk_per_trade) / atr

    def hard_stop_price(self, entry_price, equity, qty, direction):
        """Stop distance implied by the 1%-of-equity cap — always ~1 ATR from entry."""
        if qty <= 0:
            return None
        max_loss = equity * self.risk_per_trade
        distance = max_loss / qty
        return entry_price - distance if direction == "long" else entry_price + distance

    def update_trailing_stop(self, current_stop, price, atr, direction, multiplier):
        """Ratchet the stop in the position's favor; never loosen it."""
        if current_stop is None or atr is None or pd.isna(atr):
            return current_stop
        distance = atr * multiplier
        if direction == "long":
            return max(current_stop, price - distance)
        return min(current_stop, price + distance)

    def circuit_breaker_triggered(self, equity, peak_equity):
        if not peak_equity:
            return False
        drawdown = (peak_equity - equity) / peak_equity
        return drawdown >= self.max_portfolio_drawdown
