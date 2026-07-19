"""Continuous multi-strategy trading loop against the Alpaca API.

Checks each instrument at its own timeframe cadence, evaluates the shared
decision engine, submits orders, logs every fill to trades.csv, and logs
equity once per day to daily_pnl.csv. A 10% portfolio drawdown from peak
flattens everything and halts the loop until a human reviews it.
"""
import time
import traceback
from datetime import datetime, timezone

import config
from . import data_utils
from . import engine
from . import logger
from .portfolio import Portfolio
from .risk_manager import RiskManager


def _round_qty(asset_class, qty):
    if asset_class == "crypto":
        return round(qty, 6)
    return max(int(qty), 0)


def _submit_order(api, symbol, asset_class, qty, direction):
    side = "buy" if direction == "long" else "sell"
    api.submit_order(
        symbol=data_utils.BROKER_SYMBOLS[symbol],
        qty=qty,
        side=side,
        type="market",
        time_in_force="gtc" if asset_class == "crypto" else "day",
    )


def _account_equity(api):
    return float(api.get_account().equity)


def _reconcile_open_positions(api, portfolio, risk_manager):
    """Rebuild in-memory position state from the broker on startup."""
    try:
        broker_positions = api.list_positions()
    except Exception:
        traceback.print_exc()
        return

    equity = _account_equity(api)
    for pos in broker_positions:
        symbol = data_utils.FROM_BROKER_SYMBOL.get(pos.symbol)
        if symbol is None:
            continue
        direction = "long" if float(pos.qty) > 0 else "short"
        entry_price = float(pos.avg_entry_price)
        qty = abs(float(pos.qty))
        stop_price = risk_manager.hard_stop_price(entry_price, equity, qty, direction)
        trailing_mult = config.INSTRUMENTS[symbol]["params"].get("trailing_atr_mult")
        portfolio.open_position(symbol, direction, qty, entry_price, stop_price, atr=None, trailing_atr_mult=trailing_mult)
        print(f"Reconciled existing broker position: {symbol} {direction} qty={qty} entry={entry_price}")


def run():
    api = data_utils.get_api()
    portfolio = Portfolio(correlation_filter=config.CORRELATION_FILTER)
    risk_manager = RiskManager(
        risk_per_trade=config.RISK_PER_TRADE,
        atr_period=config.ATR_PERIOD,
        max_portfolio_drawdown=config.MAX_PORTFOLIO_DRAWDOWN,
    )

    _reconcile_open_positions(api, portfolio, risk_manager)

    last_checked = {symbol: 0.0 for symbol in config.INSTRUMENTS}
    day_start_equity = _account_equity(api)
    current_date = datetime.now(timezone.utc).date()
    halted = False

    print(f"[{datetime.now(timezone.utc).isoformat()}] Trading bot starting on {config.ALPACA_BASE_URL}")

    while not halted:
        try:
            equity = _account_equity(api)
            peak_equity = portfolio.update_peak_equity(equity)

            if risk_manager.circuit_breaker_triggered(equity, peak_equity):
                print(f"CIRCUIT BREAKER: drawdown from peak {peak_equity:.2f} to {equity:.2f}. Flattening all positions.")
                for symbol in portfolio.flatten_all():
                    try:
                        api.close_position(data_utils.BROKER_SYMBOLS[symbol])
                    except Exception:
                        traceback.print_exc()
                halted = True
                break

            today = datetime.now(timezone.utc).date()
            if today != current_date:
                daily_pnl = equity - day_start_equity
                daily_pnl_pct = daily_pnl / day_start_equity if day_start_equity else 0.0
                logger.log_daily_pnl(config.DAILY_PNL_LOG_PATH, equity, daily_pnl, daily_pnl_pct)
                day_start_equity = equity
                current_date = today

            now = time.time()
            for symbol, instrument_cfg in config.INSTRUMENTS.items():
                asset_class = instrument_cfg["asset_class"]
                timeframe_name = instrument_cfg["timeframe"]
                interval = config.TIMEFRAME_SECONDS[timeframe_name]

                if now - last_checked[symbol] < interval:
                    continue
                if not data_utils.is_market_open(api, asset_class):
                    continue

                last_checked[symbol] = now

                bars_needed = max(
                    instrument_cfg["params"].get("slow_ema", 0),
                    instrument_cfg["params"].get("lookback", 0),
                    config.ATR_PERIOD,
                )
                df = data_utils.fetch_recent_bars(api, symbol, asset_class, timeframe_name, bars_needed)
                if df.empty:
                    continue

                result = engine.evaluate(symbol, instrument_cfg, df, portfolio, risk_manager, equity)
                if result is None:
                    continue

                print(f"[{datetime.now(timezone.utc).isoformat()}] {symbol}: {result}")

                if result["action"] == "open":
                    qty = _round_qty(asset_class, result["qty"])
                    if qty <= 0:
                        portfolio.close_position(symbol)
                        continue
                    _submit_order(api, symbol, asset_class, qty, result["direction"])

                elif result["action"] in ("exit", "stop"):
                    position = result["position"]
                    close_direction = "short" if position["direction"] == "long" else "long"
                    qty = _round_qty(asset_class, position["qty"])
                    if qty > 0:
                        _submit_order(api, symbol, asset_class, qty, close_direction)
                    profit_loss = (
                        (result["price"] - position["entry_price"]) * position["qty"]
                        if position["direction"] == "long"
                        else (position["entry_price"] - result["price"]) * position["qty"]
                    )
                    logger.log_trade(
                        config.TRADES_LOG_PATH,
                        symbol,
                        position["direction"],
                        position["entry_price"],
                        result["price"],
                        profit_loss,
                        position["qty"],
                    )

        except Exception:
            traceback.print_exc()

        time.sleep(config.LOOP_INTERVAL_SECONDS)


if __name__ == "__main__":
    run()
