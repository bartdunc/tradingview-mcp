# Battle Test — Reactive Regime vs the Alternatives

A stress test of the reactive-regime approach (`regime_beta`: long while price is
above its trend SMA, cash below) that this bot uses. The goal was to find where the
approach **fails**, not to confirm that it works. Four dimensions: era-by-era
consistency, parameter robustness, crash-by-crash protection, and cross-asset
generalization — plus two things the tests forced us to correct.

## TL;DR

- **Reactive regime timing beats predictive cycle-timing decisively, and beats
  buy-and-hold on a risk-adjusted basis over full market cycles** — but it has three
  clear, honestly-mapped failure modes.
- **It works** on trending, drawdown-prone assets (equity indices, BTC, gold),
  across all reasonable SMA lengths, and in 7 of 8 major crashes.
- **It fails** in grinding low-volatility bull markets (whipsaw, lags return) and on
  structurally broken / non-trending instruments.
- Actions taken: **removed USO** (broken ETF), **kept GLD** (converted to regime_beta),
  and **did not add a fast-crash overlay** (tested — the daily signal already handles it).

## 1. Era-by-era consistency (S&P 500 total return, 1900–2023, by decade)

Regime beat buy-and-hold on **return in 9 of 13 decades** and cut **max drawdown in
all 13**. The pattern is consistent:

- **Crash decades** (1930s, 1970s, 2000s): regime *dominates* — it turned buy-and-hold's
  lost decades (1930s **0.0%**, 2000s **−0.7%** CAGR) into **+8.8%** and **+8.0%**.
- **Grinding bull decades** (1950s, **1990s**, 2010s, 2020s): regime **lags on return** —
  biggest miss the 1990s (**14.1% vs 18.2%**, the dot-com melt-up whipsawed the signal).

**Read:** it wins big in busts, loses modestly in strong bulls, always lowers drawdown.
That is the trade — give up some bull upside to avoid catastrophe.

## 2. Parameter robustness (SMA length sweep, full 1900–present)

Not cherry-picked — every reasonable length beats buy-and-hold:

| SMA (months) | CAGR | max DD | Sharpe |
|---|---|---|---|
| buy & hold | 9.8% | −82% | 0.71 |
| 6 | 12.3% | −25% | 1.24 |
| 10 | 12.0% | −41% | 1.20 |
| 15 | 11.0% | −40% | 1.09 |

The edge is structural, not a fitted fluke.

## 3. Crash-by-crash (peak-to-trough drawdown, buy&hold vs regime)

Protected in **7 of 8** major crashes:

| Crash | Buy&Hold DD | Regime DD | Saved |
|---|---|---|---|
| 1929 Depression | −82% | −37% | 45 pts |
| 2008 GFC | −49% | −5% | 44 pts |
| 2000–02 dot-com | −41% | −6% | 34 pts |
| 1937 / 1973–74 / 1987 / 2022 | −18 to −42% | −3 to −15% | 12–32 pts |
| **2020 COVID** (monthly signal) | −19% | −19% | **0 — failed** |

The 2020 miss was specific to the **monthly** test signal (10-month SMA, checks only
month-ends). See correction #2.

## 4. Cross-asset generalization (complete daily data, 2010–2026, 100-day regime)

| Asset | Buy&Hold (CAGR / DD / Sharpe) | Regime (CAGR / DD / Sharpe) | Verdict |
|---|---|---|---|
| BTC | 52% / −83% / 0.96 | **62% / −61% / 1.22** | Best — beats B&H on return *and* risk |
| SPY | 14% / −34% / 0.86 | 9% / −18% / 0.87 | Risk win (lags return in the bull) |
| GLD | 8% / −46% / 0.52 | 7% / −38% / 0.55 | Risk win — a valid uncorrelated diversifier |
| QQQ | 19% / −35% / 0.94 | 10% / −23% / 0.74 | **Lags even risk-adjusted** (strong secular bull) |
| USO | −6% / −95% / 0.02 | 1% / −57% / 0.15 | Instrument is broken regardless |

## Corrections the tests forced (integrity notes)

1. **Alpaca's free daily feed is incomplete for 2018–2021** (SPY returned ~1,500 bars
   for 2018–2026 vs the ~1,940 expected, and **zero bars in the Feb–May 2020 window**).
   The first cross-asset pass used it and was wrong (SPY showed 5.8% CAGR; with complete
   data it is 9.3%). Dimension 4 was **re-run on complete daily data (yfinance)**. Any
   backtest touching 2018–2021 on the Alpaca free feed should be treated with suspicion.
2. **The fast-crash overlay was tested and rejected.** The 2020 "gap" existed only for
   the slow *monthly* signal. On complete daily data the bot's **100-day daily** signal
   exited **2020-02-25 — four trading days after the Feb-19 peak** — cutting the crash from
   buy-and-hold's **−33.7% to −8.2%**. A fast-crash overlay (e.g. exit on a 10-day drop >
   8%) forces **0 extra exits** — it is redundant. Not implemented; unvalidated complexity
   that provably does nothing is exactly what this project avoids.
3. **USO vs GLD.** The earlier "drop both" was based on the corrupted data plus both being
   on the old (losing) `trend_following` strategy. Clean data shows **GLD is a fine regime
   fit** (cuts drawdown, Sharpe up) — it was just on the wrong strategy — while **USO is a
   structurally broken ETF** (−95% buy&hold drawdown from contango decay) that no strategy
   fixes.

## Actions taken

- **Removed USO** from the live config.
- **Converted GLD** from `trend_following` to `regime_beta` (uncorrelated diversifier).
- **No fast-crash overlay added** (see correction #2).
- Live book is now **SPY, QQQ, BTC, GLD — all `regime_beta` on daily bars.**

Post-change confirmation (48-month backtest, eval mode, correlation filter on the
combined row): **combined +173% total return, 10.1% max drawdown, Sharpe 1.77** (41
trades), up from +136% before — converting GLD to regime_beta *added* value rather than
subtracting it, and removed the negative-expectancy drag USO/GLD carried on the old
`trend_following` strategy. (Per-instrument: SPY +28% / PF 5.24, QQQ +43% / PF 8.48,
BTC +33% / PF 3.18, GLD +22% / PF 19.1.) Standard caveat: a 2022–2026 window flatters
the numbers — gold's rally helps GLD here, and the book runs >1x gross.

## Honest limits (do not forget)

The reactive-regime approach is strong **within its domain** and has three permanent
failure modes:

1. **Grinding low-volatility bull markets** → whipsaws, lags buy-and-hold on return.
2. **Fast single-bar flash events** → a slow signal reacts within days, not minutes.
3. **Choppy / non-trending / structurally-broken instruments** → the rule needs the
   asset to actually trend; on oil (USO) it is at best "less bad."

Every long-window backtest here (2010–2026, and much of 1900–2023) is dominated by
rising markets, which *understates* the regime rule's real value (bear-market
protection) and *overstates* buy-and-hold's. Forward, expect regime to roughly match
beta's return while cutting drawdown — its job is the bear market this data can't show.

## Reproducibility

- Long history: Shiller monthly S&P 500 (`github.com/datasets/s-and-p-500`), total
  return with dividends; cash earns the 10-year yield when out.
- Cross-asset / daily: complete daily bars (yfinance), dividend-adjusted.
- All signals lagged one month/bar (no lookahead — a lookahead bug was caught and fixed
  during this work, which is why the numbers here supersede any earlier draft).
