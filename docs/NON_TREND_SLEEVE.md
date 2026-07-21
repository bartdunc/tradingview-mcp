# Non-Trend Sleeve — Can a Different Return Source Improve the Trend Book?

The [battle test](BATTLE_TEST.md) ended on one open question. The live bot is a
single, strong, drawdown-efficient **trend** source (regime-beta on SPY/QQQ/BTC/GLD),
and *more trend cannot improve it* — every trend diversifier correlated ~0.48 back to
the core. The only way up is a genuinely **non-trend** return source: **carry**,
**volatility premium**, or a **plain buy-and-hold beta anchor**. This is that build.

## What was built

A static **buy-and-hold sleeve primitive** (`bot/strategies/buy_hold.py`) — the first
strategy in the project that times *nothing*: it enters once and holds forever. It lets
the bot carry an always-on risk-premium harvest next to the tactical trend book:

- **bond carry** (IEF): the Treasury term premium, *held* — not trend-traded;
- **beta anchor** (SPY/QQQ): the equity risk premium, always on.

> **Why "held, not traded" matters.** The earlier naive diversifier failed (PF 0.12)
> only because it ran a bond ETF *through the trend strategy* in a trendless bond
> market — a category error. A carry sleeve is bought and held. That correction is the
> whole point of this primitive.

The sleeves are combined with the professional playbook — **inverse-volatility risk
parity, rebalanced monthly** — and also compared **vol-matched to 10% annual vol**, so
drawdowns are judged at equal risk.

## Data & method

- Dividend/split-adjusted daily closes (Yahoo chart API, stdlib fetch — the live bot's
  `websockets<11` pin is never touched), **2007-05-30 → 2026-07** (BIL inception gives a
  real T-bill cash rate; window spans the GFC, 2018, COVID, the **2022 bond crash**, 2025).
- Cash (when the trend sleeve is flat) earns the daily **BIL** T-bill return.
- Regime signal is the live rule — long while adj-close > 100-day SMA — **lagged one day**
  (no lookahead).
- Sleeve returns are 1× (unlevered); the trend book here is normalized to sum-1 weights
  (the live bot runs ~1.4× gross — see caveat at the end).

## Are the sleeves genuinely different sources?

Correlation of daily returns:

| | trend | equity anchor | bond carry |
|---|---|---|---|
| **trend** | 1.00 | 0.55 | **−0.06** |
| **equity anchor** | 0.55 | 1.00 | −0.28 |
| **bond carry** | −0.06 | −0.28 | 1.00 |

**Bond carry is genuinely uncorrelated to the trend book (−0.06)** — a real different
return source, exactly what the battle test said was required. The equity anchor is
half-correlated (both are equity), but complementary in *timing*: it holds the beta the
regime filter sells.

## Full-window results (2007–2026)

Unlevered inverse-vol risk parity:

| Portfolio | CAGR | Vol | Sharpe | Sortino | MaxDD | Calmar | Corr SPY |
|---|---|---|---|---|---|---|---|
| SPY buy & hold | 10.2% | 19.4% | 0.53 | 0.64 | −55.2% | 0.19 | 1.00 |
| 60/40 SPY/IEF | 8.0% | 11.1% | 0.63 | 0.78 | −31.4% | 0.25 | 0.97 |
| **Trend book (1×)** | 8.6% | 9.6% | 0.77 | 0.92 | **−12.4%** | **0.69** | 0.51 |
| Trend + bond carry | 5.5% | 5.4% | 0.78 | 1.06 | −15.2% | 0.36 | 0.16 |
| Trend + equity anchor | 10.5% | 11.4% | 0.82 | 1.04 | −21.3% | 0.49 | 0.79 |
| **3-sleeve RP (all)** | 7.1% | 6.2% | **0.93** | **1.25** | −16.8% | 0.42 | 0.61 |

Vol-matched to 10% annual vol (drawdown at **equal risk**):

| Portfolio | CAGR | Sharpe | MaxDD | Calmar |
|---|---|---|---|---|
| SPY buy & hold | 8.2% | 0.64 | −24.5% | 0.33 |
| 60/40 SPY/IEF | 9.9% | 0.79 | −23.4% | 0.42 |
| **Trend book** | 10.9% | 0.86 | **−16.0%** | **0.68** |
| Trend + bond carry | 11.4% | 0.96 | −21.4% | 0.53 |
| **3-sleeve RP (all)** | 12.8% | **1.04** | −20.0% | 0.64 |

**On paper the non-trend stack works:** the 3-sleeve portfolio lifts Sharpe **0.77 → 0.93**
(unlevered) and **0.86 → 1.04** (vol-matched), and Sortino **0.92 → 1.25** — the first
thing in this entire project to genuinely beat the trend book's risk-adjusted return.

**But it does not lower drawdown.** The trend book alone is the most drawdown-efficient
thing on the board (best Calmar, 0.68–0.69). Stacking always-on beta and bonds *reintroduces*
drawdown; the stack buys higher risk-adjusted *return*, not more safety — and only turns
that into higher *absolute* return if you vol-target and lever it back up.

## The catch: the edge is regime-dependent, not robust

Split the window in half and the story falls apart:

| | Trend only | 3-sleeve RP | Winner |
|---|---|---|---|
| **2007–2016** | Sharpe 0.51, DD −12.4% | Sharpe **1.02**, DD −9.0% | sleeve — *by a mile* |
| **2017–2026** | Sharpe **1.01**, DD −11.8% | Sharpe 0.86, DD −16.8% | **trend alone** |

The full-window "Sharpe 0.93 > 0.77" was almost entirely the **2007–2016 bond bull** —
falling rates gave the bond-carry sleeve a huge capital-gain tailwind on top of a
plummeting equity market it was negatively correlated to. In the **2017–2026** rate-rising
regime, that reversed: **2022** saw stocks *and* bonds fall together, and the trend book
alone won the forward-relevant decade outright.

The calendar-year stress rows make the mechanism explicit:

| | 2008 | 2020 | **2022** |
|---|---|---|---|
| Trend book | −3.7% | +24.1% | −10.4% |
| Trend + bond carry | **+6.2%** | +14.0% | **−12.6%** |

Bond carry **cushions deflationary busts** (2008: turned −3.7% into +6.2%) and **costs you
in inflationary ones** (2022: −12.6% vs −10.4%). It is insurance with a regime-dependent
premium, not free diversification.

## Sleeve variants and the crypto footnote

- **Carry variant** — IEF is the robust pick: 3-sleeve Sharpe 0.93 (IEF, corr −0.06) vs
  0.86 (AGG) vs 0.91 (TLT, but −20.8% DD). Longer duration adds return and drawdown in
  equal measure; the intermediate is the clean choice.
- **The one non-trend sleeve that helped *forward* is crypto** — a BTC regime-trend
  sleeve is corr **+0.07** to the equity anchor and lifted the trend book from Sharpe
  0.88 → 1.47 (2015+). But that is the **BTC-early-cycle magnitude the battle test already
  flagged as non-repeatable**, and the live bot **already runs it** (BTC `regime_beta`,
  allocation 0.2). So this is not a new edge — it is the diversifier the bot already has.

## Verdict & decision

The non-trend sleeve is **built, validated, and shipped OFF by default** (`config.py`,
`NON_TREND_SLEEVE_ENABLED = False`). That is the honest call:

1. Bond carry is a **genuine** uncorrelated source (−0.06) and improves *backward-looking*
   Sharpe — but split-half testing shows the improvement was a **2007–2016 bond-bull
   regime bet** that **hurt in 2017–2026**. Adding it permanently would be fitting to a
   regime that has already turned.
2. The trend book remains the **most drawdown-efficient** portfolio here; the stack raises
   Sharpe only by accepting worse drawdown, and raises absolute return only under leverage.
3. The genuinely forward-useful uncorrelated sleeve (crypto-trend) is **already in the live
   book**.

**If** you want more 2008-style deflationary-crash insurance and will accept the 2022-style
cost, enable a **small (~15%) static IEF bond-carry anchor** — the config block and the
`buy_hold` primitive are in place to do exactly that. It is a preference on which crash you
want to be protected against, not a risk-adjusted free lunch. Sized as insurance, not alpha.

## Reproducibility

- `scratchpad/fetch_data.py` — stdlib Yahoo fetch → `scratchpad/data/*.csv` (adjusted).
- `scratchpad/study.py` — portfolios, metrics, vol-matched view, stress years.
- `scratchpad/study2.py` — carry variant, split-half robustness, BTC sleeve.
- `scratchpad/plot_study.py` → `non_trend_sleeve.png` (growth of $1 + rolling Sharpe).
- All signals lagged one bar (no lookahead); returns dividend-adjusted; cash = BIL.
