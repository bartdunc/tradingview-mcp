"""GO / NO-GO preflight for the live loop.

Every P0 blocker found in the go-live review was a silent mismatch between
config.py and the code that consumes it — a timeframe with no entry in
TIMEFRAME_SECONDS, a warmup requirement larger than the fetch window. Both
failed quietly inside a blanket `except`, so the bot looked healthy while
never placing a trade. This asserts those invariants up front and loudly.

    python -m bot.preflight            # offline checks only
    python -m bot.preflight --broker   # also hit Alpaca (account, clock, bars)
"""
import sys
import traceback

import config
from . import engine

OK, WARN, FAIL = "OK  ", "WARN", "FAIL"


def _report(rows):
    worst = OK
    for status, label, detail in rows:
        print(f"  [{status}] {label}" + (f" — {detail}" if detail else ""))
        if status == FAIL:
            worst = FAIL
        elif status == WARN and worst != FAIL:
            worst = WARN
    return worst


def offline_checks():
    rows = []

    # 1. Every configured timeframe must be resolvable.
    for symbol, cfg in config.INSTRUMENTS.items():
        tf = cfg["timeframe"]
        if tf in config.TIMEFRAME_SECONDS:
            rows.append((OK, f"{symbol} timeframe {tf}", "resolvable"))
        else:
            rows.append((FAIL, f"{symbol} timeframe {tf}",
                         f"missing from TIMEFRAME_SECONDS {list(config.TIMEFRAME_SECONDS)}"))

    # 2. Every configured strategy must be registered and importable.
    for symbol, cfg in config.INSTRUMENTS.items():
        name = cfg["strategy"]
        if name not in engine._STRATEGY_MODULES:
            rows.append((FAIL, f"{symbol} strategy {name}", "not registered in engine"))
            continue
        try:
            mod = engine._strategy_module(name)
            if not hasattr(mod, "generate_signal"):
                rows.append((FAIL, f"{symbol} strategy {name}", "no generate_signal()"))
            elif not hasattr(mod, "warmup_bars"):
                rows.append((WARN, f"{symbol} strategy {name}", "no warmup_bars(); using engine default"))
            else:
                rows.append((OK, f"{symbol} strategy {name}", "importable"))
        except Exception as exc:
            rows.append((FAIL, f"{symbol} strategy {name}", f"import failed: {exc}"))

    # 3. Warmup must be satisfiable by the padded fetch window.
    for symbol, cfg in config.INSTRUMENTS.items():
        if cfg["timeframe"] not in config.TIMEFRAME_SECONDS:
            continue
        try:
            need = engine.warmup_bars(cfg, config.ATR_PERIOD)
        except Exception as exc:
            rows.append((FAIL, f"{symbol} warmup", f"could not compute: {exc}"))
            continue
        crypto = cfg["asset_class"] == "crypto"
        padded = int((need + 30) * (1.0 if crypto else 7.0 / 5.0)) + 5
        available = padded if crypto else int(padded * 5.0 / 7.0)
        if available >= need:
            rows.append((OK, f"{symbol} warmup", f"needs {need}, window yields ~{available}"))
        else:
            rows.append((FAIL, f"{symbol} warmup", f"needs {need} but window yields only ~{available}"))

    # 4. Sizing sanity — fixed_fractional gross exposure.
    gross = sum(c["params"].get("allocation", 0.0) for c in config.INSTRUMENTS.values()
                if c["params"].get("sizing") == "fixed_fractional")
    status = OK if gross <= 1.0 else WARN
    rows.append((status, "gross exposure", f"{gross:.2f}x of equity across fixed-fractional sleeves"))

    # 5. Credentials + endpoint + mode.
    rows.append(((OK if config.ALPACA_API_KEY else FAIL), "ALPACA_API_KEY",
                 "present" if config.ALPACA_API_KEY else "missing"))
    rows.append(((OK if config.ALPACA_SECRET_KEY else FAIL), "ALPACA_SECRET_KEY",
                 "present" if config.ALPACA_SECRET_KEY else "missing"))
    paper = "paper-api" in config.ALPACA_BASE_URL
    rows.append(((OK if paper else WARN), "endpoint", config.ALPACA_BASE_URL +
                 ("" if paper else "  <-- LIVE MONEY ENDPOINT")))
    rows.append(((OK if config.DRY_RUN else WARN), "DRY_RUN",
                 "True — no orders will be sent" if config.DRY_RUN
                 else "False — ORDERS WILL BE SUBMITTED"))
    return rows


def broker_checks():
    rows = []
    try:
        from . import data_utils
        api = data_utils.get_api()
        acct = api.get_account()
        rows.append((OK, "account", f"status={acct.status} equity={acct.equity} buying_power={acct.buying_power}"))
    except Exception as exc:
        rows.append((FAIL, "account", f"{exc}"))
        return rows

    for symbol, cfg in config.INSTRUMENTS.items():
        if cfg["timeframe"] not in config.TIMEFRAME_SECONDS:
            continue
        try:
            need = engine.warmup_bars(cfg, config.ATR_PERIOD)
            df = data_utils.fetch_recent_bars(api, symbol, cfg["asset_class"], cfg["timeframe"], need)
            if len(df) >= need:
                rows.append((OK, f"{symbol} bars", f"{len(df)} closed bars (need {need}), last {df.index[-1].date()}"))
            else:
                rows.append((FAIL, f"{symbol} bars", f"only {len(df)} closed bars, need {need}"))
        except Exception as exc:
            rows.append((FAIL, f"{symbol} bars", f"{exc}"))
    return rows


def main():
    print("=" * 78)
    print("PREFLIGHT — live loop readiness")
    print("=" * 78)
    print("\nConfig / code invariants:")
    worst = _report(offline_checks())

    if "--broker" in sys.argv:
        print("\nBroker connectivity:")
        try:
            b = _report(broker_checks())
        except Exception:
            traceback.print_exc()
            b = FAIL
        worst = FAIL if FAIL in (worst, b) else (WARN if WARN in (worst, b) else OK)

    print("\n" + "=" * 78)
    if worst == FAIL:
        print("RESULT: NO-GO — fix the FAIL rows above before running the loop.")
        return 1
    if worst == WARN:
        print("RESULT: GO (with warnings) — read the WARN rows and confirm they are intended.")
        return 0
    print("RESULT: GO — all invariants hold.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
