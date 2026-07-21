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

## Enabled on the live book, measured, and reverted (the decision-relevant number)

The study above sizes sleeves by **risk parity** on a normalized 1× trend book. The
**live** book is different: it already runs GLD and BTC as uncorrelated diversifiers at
1.4× gross. Enabling the anchor there is a *small 15% add-on*, not a risk-parity
reweight — so the effect is much smaller. Measured on dividend-adjusted total-return
data (`scratchpad/compare_anchor.py`):

| Window | Book | CAGR | Sharpe | Sortino | MaxDD | Calmar |
|---|---|---|---|---|---|---|
| 48-month | trend book | 29.5% | 1.40 | 1.85 | −11.3% | **2.60** |
| | **+ IEF anchor 0.15** | 29.7% | 1.40 | 1.87 | −11.9% | 2.50 |
| 2015 → | trend book | 28.0% | 1.44 | 1.83 | −21.9% | **1.28** |
| | **+ IEF anchor 0.15** | 28.3% | 1.45 | 1.86 | −23.4% | 1.21 |
| 2007 → | trend book | 19.8% | 1.17 | 1.46 | −21.9% | **0.91** |
| | **+ IEF anchor 0.15** | 20.4% | **1.21** | **1.52** | −23.4% | 0.87 |

**The anchor is close to a no-op on the live book:** Sharpe +0.00 to +0.04, CAGR +0.2 to
+0.6 pts — and **drawdown and Calmar get consistently *worse*** (gross rises 1.4× → 1.55×,
and 2022 hit bonds alongside stocks). It still does the one job it was enabled for:

| | 2008 | 2020 | **2022** |
|---|---|---|---|
| trend book | −4.6% | +64.0% | −17.3% |
| + IEF anchor | **−2.2%** | +66.4% | **−19.3%** |

Deflationary-bust insurance worth **+2.4 pts in 2008**, paid for with **−2.0 pts in 2022**.
That is the trade, and on a book that already holds GLD + BTC it is roughly a wash.

**Decision: reverted, sleeve left OFF.** This book's entire edge is drawdown efficiency,
and the anchor degrades exactly that (worse MaxDD and Calmar in every window tested) in
exchange for a Sharpe gain that rounds to zero. The `buy_hold` primitive, the config
block, and this measurement all remain in place, so re-enabling is a one-block edit if
you later decide you want the deflationary insurance.

### Two harness limitations this sleeve exposed

1. **`compute_metrics` zeroed every metric when there were no *closed* trades** — so a
   held anchor reported "0.0% return, 0.0% max DD" while its mark-to-market curve was
   real. **Fixed:** with an equity curve but no closed trades, return and drawdown are now
   computed from the curve and only the trade-based stats are suppressed.
2. **Alpaca bars are unadjusted price.** For a bond ETF the coupon *is* the return, so the
   harness measures IEF at **−1.5%** over the 48-month window where its true total return
   is **+3.8%** — understating the carry sleeve by ~5.3 points over four years. This is a
   data limitation, not a bug: **evaluate any carry/anchor sleeve on dividend-adjusted
   data** (`scratchpad/compare_anchor.py`), never on the Alpaca price feed.

## FX and credit — the other two candidate sources, tested and rejected

If bond carry is the weakest acceptable diversifier, the obvious next questions are
**FX carry** and **credit**. Both were tested against the same bar every sleeve here has
to clear: low correlation to equity *and* to the trend book, a real standalone premium,
and — the one that actually matters — **the diversification has to hold in the crisis it
is supposed to cushion.**

| Sleeve | CAGR | Sharpe | MaxDD | corr equity | corr trend | 2008 |
|---|---|---|---|---|---|---|
| **FX carry (DBV)** | −0.3% | **−0.10** | −34.0% | 0.42 | 0.24 | **−28.1%** |
| Yen / funding (FXY) | −1.9% | −0.27 | −56.6% | −0.30 | −0.09 | +22.9% |
| Dollar (UUP) | 1.6% | 0.08 | −22.2% | −0.17 | −0.23 | +4.9% |
| High yield credit (HYG) | 4.7% | 0.36 | −34.2% | **0.65** | 0.34 | −17.6% |
| IG credit (LQD) | 3.9% | 0.33 | −25.0% | 0.20 | 0.09 | +2.4% |
| EM debt (EMB) | 4.3% | 0.33 | −34.7% | 0.38 | 0.25 | −2.1% |
| **Credit premium (HYG−IEF)** | **0.9%** | **0.04** | **−46.9%** | **0.67** | 0.34 | **−31.2%** |
| *[ref] bond carry (IEF)* | 3.2% | 0.30 | −23.9% | −0.28 | −0.11 | +17.9% |

**The decisive test — correlation to equity in calm years vs in the crisis:**

| Sleeve | calm | **crisis** |
|---|---|---|
| FX carry (DBV) | +0.34 | **+0.43** |
| High yield credit (HYG) | +0.65 | +0.65 |
| Credit premium (HYG−IEF) | +0.63 | **+0.69** |
| *Bond carry (IEF)* | −0.24 | **−0.27** |

- **FX carry is the textbook negative-skew trade** — negative Sharpe over 15 years, −28% in
  2008, and correlation that *rises* into the crash. Note DBV's history ends 2023-03-16:
  **the fund was liquidated.** The market retired this one without our help.
- **Credit is equity beta in a bond costume.** Isolate the actual credit premium (high
  yield minus duration) and it pays **0.9%/yr for a −47% drawdown**, at correlation 0.67
  that *climbs to 0.69* exactly when you need it low. It is not a different return source;
  it is the same risk repackaged with worse liquidity.
- **Only IEF holds a negative correlation through crises** (−0.24 calm → −0.27 crisis) —
  which is why bond carry won this field, and it still did not improve the live book.
- **Credit default swaps proper are not retail-accessible** (ISDA agreements, institutional
  minimums). The accessible version is options credit spreads — already prototyped and
  rejected (92% win rate; two ordinary dips erased 87% of the gains).

**Conclusion: the non-trend search is closed.** Of every candidate source — carry (bonds,
FX), volatility premium (credit spreads/VRP), credit, and a plain beta anchor — none
clears the bar on this book. The only genuinely uncorrelated sleeve that survives forward
is **crypto-trend, which the live bot already runs.**

## Reproducibility

- `scratchpad/fetch_data.py` — stdlib Yahoo fetch → `scratchpad/data/*.csv` (adjusted).
- `scratchpad/study.py` — portfolios, metrics, vol-matched view, stress years.
- `scratchpad/study2.py` — carry variant, split-half robustness, BTC sleeve.
- `scratchpad/plot_study.py` → `non_trend_sleeve.png` (growth of $1 + rolling Sharpe).
- `scratchpad/compare_anchor.py` — live book with/without the anchor, total-return data.
- `scratchpad/fx_credit_test.py` — FX carry and credit as sleeves, incl. crisis correlation.
- All signals lagged one bar (no lookahead); returns dividend-adjusted; cash = BIL.
