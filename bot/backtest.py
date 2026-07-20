"""Backtests all 3 strategies against 6 months of historical Alpaca data.

Runs two kinds of simulation:
  - Per-instrument standalone: each symbol trades alone against its own
    equity, isolating that strategy's raw performance (no correlation filter,
    since there's nothing else in the book to correlate against).
  - Combined portfolio: all 5 instruments trade against one shared equity
    pool, in chronological order, with the correlation filter engaged —
    this is the realistic "whole book" performance number.

Both use the exact same `bot.engine.evaluate` used by the live loop, so the
backtest reflects what the bot will actually do.
"""
import sys
from datetime import datetime, timezone

import pandas as pd
from dateutil.relativedelta import relativedelta

import config
from . import data_utils
from . import engine
from .portfolio import Portfolio
from .risk_manager import RiskManager

DEFAULT_INITIAL_CAPITAL = 100_000.0
DEFAULT_SLIPPAGE_PCT = 0.0005  # 0.05% per trade
DEFAULT_MONTHS_BACK = 6


def _apply_slippage(price, direction, slippage_pct, entering):
    """Buys execute slightly worse (higher fill); sells execute slightly worse (lower fill)."""
    paying_more = (direction == "long") == entering
    return price * (1 + slippage_pct) if paying_more else price * (1 - slippage_pct)


def _mark_to_market(portfolio, last_price, realized_equity):
    unrealized = 0.0
    for symbol, position in portfolio.positions.items():
        price = last_price.get(symbol, position["entry_price"])
        if position["direction"] == "long":
            unrealized += (price - position["entry_price"]) * position["qty"]
        else:
            unrealized += (position["entry_price"] - price) * position["qty"]
    return realized_equity + unrealized


def run_single_instrument_backtest(symbol, instrument_cfg, bars_df, initial_capital, slippage_pct, atr_period):
    portfolio = Portfolio(correlation_filter=[])
    risk_manager = RiskManager(
        risk_per_trade=config.RISK_PER_TRADE,
        atr_period=atr_period,
        max_portfolio_drawdown=config.MAX_PORTFOLIO_DRAWDOWN,
    )
    equity = initial_capital
    peak_equity = equity
    trades = []
    equity_curve = []
    open_trade = None
    halted = False

    for i in range(len(bars_df)):
        if halted:
            break
        window = bars_df.iloc[: i + 1]
        ts = bars_df.index[i]
        last_price = {symbol: window["close"].iloc[-1]}

        result = engine.evaluate(symbol, instrument_cfg, window, portfolio, risk_manager, equity)

        if result and result["action"] == "open":
            fill_price = _apply_slippage(result["price"], result["direction"], slippage_pct, entering=True)
            portfolio.positions[symbol]["entry_price"] = fill_price
            open_trade = {
                "symbol": symbol,
                "direction": result["direction"],
                "entry_time": ts,
                "entry_price": fill_price,
                "qty": result["qty"],
                "exit_time": None,
                "exit_price": None,
                "pnl": None,
            }
            trades.append(open_trade)

        elif result and result["action"] in ("exit", "stop"):
            position = result["position"]
            fill_price = _apply_slippage(result["price"], position["direction"], slippage_pct, entering=False)
            if open_trade is not None and open_trade["exit_time"] is None:
                pnl = (
                    (fill_price - open_trade["entry_price"]) * position["qty"]
                    if position["direction"] == "long"
                    else (open_trade["entry_price"] - fill_price) * position["qty"]
                )
                open_trade.update({"exit_time": ts, "exit_price": fill_price, "pnl": pnl})
                equity += pnl
            open_trade = None

        mark_to_market_equity = _mark_to_market(portfolio, last_price, equity)
        peak_equity = max(peak_equity, mark_to_market_equity)
        equity_curve.append((ts, mark_to_market_equity))

        if risk_manager.circuit_breaker_triggered(mark_to_market_equity, peak_equity):
            halted = True

    closed_trades = [t for t in trades if t["exit_time"] is not None]
    return {
        "trades": closed_trades,
        "equity_curve": equity_curve,
        "final_equity": equity_curve[-1][1] if equity_curve else initial_capital,
    }


def run_combined_backtest(bars_by_symbol, initial_capital, slippage_pct, atr_period):
    portfolio = Portfolio(correlation_filter=config.CORRELATION_FILTER)
    risk_manager = RiskManager(
        risk_per_trade=config.RISK_PER_TRADE,
        atr_period=atr_period,
        max_portfolio_drawdown=config.MAX_PORTFOLIO_DRAWDOWN,
    )
    equity = initial_capital
    peak_equity = equity
    trades = []
    equity_curve = []
    last_price = {}
    open_trade_by_symbol = {}
    halted = False

    events = []
    for symbol, df in bars_by_symbol.items():
        for i, ts in enumerate(df.index):
            events.append((ts, symbol, i))
    events.sort(key=lambda e: (e[0], e[1]))

    for ts, symbol, i in events:
        if halted:
            break
        instrument_cfg = config.INSTRUMENTS[symbol]
        window = bars_by_symbol[symbol].iloc[: i + 1]
        last_price[symbol] = window["close"].iloc[-1]

        result = engine.evaluate(symbol, instrument_cfg, window, portfolio, risk_manager, equity)

        if result and result["action"] == "open":
            fill_price = _apply_slippage(result["price"], result["direction"], slippage_pct, entering=True)
            portfolio.positions[symbol]["entry_price"] = fill_price
            trade = {
                "symbol": symbol,
                "direction": result["direction"],
                "entry_time": ts,
                "entry_price": fill_price,
                "qty": result["qty"],
                "exit_time": None,
                "exit_price": None,
                "pnl": None,
            }
            trades.append(trade)
            open_trade_by_symbol[symbol] = trade

        elif result and result["action"] in ("exit", "stop"):
            position = result["position"]
            fill_price = _apply_slippage(result["price"], position["direction"], slippage_pct, entering=False)
            trade = open_trade_by_symbol.pop(symbol, None)
            if trade is not None:
                pnl = (
                    (fill_price - trade["entry_price"]) * position["qty"]
                    if position["direction"] == "long"
                    else (trade["entry_price"] - fill_price) * position["qty"]
                )
                trade.update({"exit_time": ts, "exit_price": fill_price, "pnl": pnl})
                equity += pnl

        mark_to_market_equity = _mark_to_market(portfolio, last_price, equity)
        peak_equity = max(peak_equity, mark_to_market_equity)
        equity_curve.append((ts, mark_to_market_equity))

        if risk_manager.circuit_breaker_triggered(mark_to_market_equity, peak_equity):
            halted = True

    closed_trades = [t for t in trades if t["exit_time"] is not None]
    return {
        "trades": closed_trades,
        "equity_curve": equity_curve,
        "final_equity": equity_curve[-1][1] if equity_curve else initial_capital,
    }


def compute_metrics(trades, equity_curve, initial_capital):
    if not trades or not equity_curve:
        return {
            "total_trades": 0,
            "win_rate": 0.0,
            "avg_win": 0.0,
            "avg_loss": 0.0,
            "profit_factor": 0.0,
            "max_drawdown": 0.0,
            "sharpe_ratio": 0.0,
            "total_return": 0.0,
        }

    pnls = [t["pnl"] for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]

    win_rate = len(wins) / len(pnls)
    avg_win = sum(wins) / len(wins) if wins else 0.0
    avg_loss = sum(losses) / len(losses) if losses else 0.0
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")

    equity_series = pd.Series(
        [e for _, e in equity_curve], index=pd.DatetimeIndex([t for t, _ in equity_curve])
    )
    daily_equity = equity_series.resample("1D").last().ffill().dropna()
    daily_returns = daily_equity.pct_change().dropna()

    drawdown_series = (daily_equity / daily_equity.cummax()) - 1
    max_drawdown = abs(drawdown_series.min()) if not drawdown_series.empty else 0.0

    if len(daily_returns) > 1 and daily_returns.std(ddof=0) > 0:
        sharpe_ratio = (daily_returns.mean() / daily_returns.std(ddof=0)) * (252 ** 0.5)
    else:
        sharpe_ratio = 0.0

    final_equity = equity_curve[-1][1]
    total_return = (final_equity - initial_capital) / initial_capital

    return {
        "total_trades": len(pnls),
        "win_rate": win_rate,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "profit_factor": profit_factor,
        "max_drawdown": max_drawdown,
        "sharpe_ratio": sharpe_ratio,
        "total_return": total_return,
    }


def _print_summary(per_instrument_metrics, combined_metrics):
    header = ["Instrument", "Trades", "Win Rate", "Avg Win", "Avg Loss", "Profit Factor", "Max DD", "Sharpe", "Total Return"]
    rows = []
    for symbol, m in per_instrument_metrics.items():
        rows.append(
            [
                symbol,
                m["total_trades"],
                f"{m['win_rate']:.1%}",
                f"${m['avg_win']:.2f}",
                f"${m['avg_loss']:.2f}",
                f"{m['profit_factor']:.2f}",
                f"{m['max_drawdown']:.1%}",
                f"{m['sharpe_ratio']:.2f}",
                f"{m['total_return']:.1%}",
            ]
        )
    rows.append(
        [
            "COMBINED",
            combined_metrics["total_trades"],
            f"{combined_metrics['win_rate']:.1%}",
            f"${combined_metrics['avg_win']:.2f}",
            f"${combined_metrics['avg_loss']:.2f}",
            f"{combined_metrics['profit_factor']:.2f}",
            f"{combined_metrics['max_drawdown']:.1%}",
            f"{combined_metrics['sharpe_ratio']:.2f}",
            f"{combined_metrics['total_return']:.1%}",
        ]
    )

    widths = [max(len(str(row[i])) for row in ([header] + rows)) for i in range(len(header))]
    print("\nBACKTEST SUMMARY (6 months, correlation filter active on COMBINED row)")
    print(" | ".join(h.ljust(widths[i]) for i, h in enumerate(header)))
    print("-+-".join("-" * w for w in widths))
    for row in rows:
        print(" | ".join(str(v).ljust(widths[i]) for i, v in enumerate(row)))


def _plot_equity_curves(per_instrument_results, combined_result, out_path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(12, 6))
    for symbol, result in per_instrument_results.items():
        if not result["equity_curve"]:
            continue
        times, values = zip(*result["equity_curve"])
        ax.plot(times, values, label=symbol, alpha=0.6, linewidth=1)

    if combined_result["equity_curve"]:
        times, values = zip(*combined_result["equity_curve"])
        ax.plot(times, values, label="COMBINED", color="black", linewidth=2.5)

    ax.set_title("Backtest Equity Curves — 6 Months")
    ax.set_xlabel("Date")
    ax.set_ylabel("Equity ($)")
    ax.legend(loc="upper left", fontsize=8)
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"\nEquity curve chart saved to {out_path}")


def _min_bars_required(cfg):
    """Bars needed before the strategy can generate its first signal at all."""
    params = cfg["params"]
    return max(params.get("slow_ema", 0), params.get("lookback", 0), config.ATR_PERIOD) + 2


def run(initial_capital=DEFAULT_INITIAL_CAPITAL, months_back=DEFAULT_MONTHS_BACK, slippage_pct=DEFAULT_SLIPPAGE_PCT):
    api = data_utils.get_api()
    end = datetime.now(timezone.utc)
    start = end - relativedelta(months=months_back)

    bars_by_symbol = {}
    for symbol, cfg in config.INSTRUMENTS.items():
        print(f"Fetching {months_back} months of {cfg['timeframe']} bars for {symbol}...")
        bars_by_symbol[symbol] = data_utils.fetch_bars(api, symbol, cfg["asset_class"], cfg["timeframe"], start, end)
        min_bars = _min_bars_required(cfg)
        bar_count = len(bars_by_symbol[symbol])
        if bar_count < min_bars * 3:
            print(
                f"  NOTE: {symbol} only has {bar_count} bars ({min_bars} needed just to fire once) — "
                f"results for this instrument are likely too thin a sample to trust."
            )

    per_instrument_results = {}
    per_instrument_metrics = {}
    for symbol, cfg in config.INSTRUMENTS.items():
        df = bars_by_symbol[symbol]
        result = run_single_instrument_backtest(symbol, cfg, df, initial_capital, slippage_pct, config.ATR_PERIOD)
        per_instrument_results[symbol] = result
        per_instrument_metrics[symbol] = compute_metrics(result["trades"], result["equity_curve"], initial_capital)

    combined_result = run_combined_backtest(bars_by_symbol, initial_capital, slippage_pct, config.ATR_PERIOD)
    combined_metrics = compute_metrics(combined_result["trades"], combined_result["equity_curve"], initial_capital)

    _print_summary(per_instrument_metrics, combined_metrics)
    _plot_equity_curves(per_instrument_results, combined_result, "backtest_results.png")

    negative_sharpe = [s for s, m in per_instrument_metrics.items() if m["sharpe_ratio"] < 0]
    if negative_sharpe:
        print(f"\nFLAGGED — negative Sharpe ratio over the {months_back}-month backtest: {', '.join(negative_sharpe)}")
        print("Adjust these strategies' parameters before paper or live trading.")

    if combined_metrics["max_drawdown"] > 0.15:
        print(f"\nWARNING — combined portfolio max drawdown {combined_metrics['max_drawdown']:.1%} exceeds 15%.")

    return {"per_instrument": per_instrument_metrics, "combined": combined_metrics}


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Backtest the multi-strategy trading bot against Alpaca data.")
    parser.add_argument("--months", type=int, default=DEFAULT_MONTHS_BACK, help="Months of history to pull (default: 6)")
    parser.add_argument("--capital", type=float, default=DEFAULT_INITIAL_CAPITAL, help="Starting capital (default: 100000)")
    parser.add_argument("--slippage", type=float, default=DEFAULT_SLIPPAGE_PCT, help="Slippage per trade as a fraction (default: 0.0005)")
    args = parser.parse_args()

    run(initial_capital=args.capital, months_back=args.months, slippage_pct=args.slippage)
