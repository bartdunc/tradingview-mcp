# The BTC Cycle — Fundamentals, Position, and What Would Falsify It

*Analysis dated 2026-07-21. Written to be checkable later: the position, the
mechanism, and explicit checkpoints are all recorded so the reasoning can be
graded against what actually happens rather than remembered selectively.*

The bot holds BTC on the same 200-day regime rule as everything else, and BTC has
historically been its single largest return contributor. So the cycle question is not
academic here — it is the biggest single driver of forward expectations.

## 1. Where we are (as of 2026-07-21)

| | |
|---|---|
| Cycle peak | **$124,753** on 2025-10-06 |
| Price now | **$65,143** |
| Drawdown | **−47.8%** |
| Elapsed | **288 days** into the decline |
| 200-day SMA | **$72,800** — price 10.5% below → **bot is FLAT** |

Aligned against completed cycles:

| cycle | peak | duration to bottom | depth |
|---|---|---|---|
| 2013–17 | $19,497 | 364d | **−83%** |
| 2021 | $67,567 | 378d | **−77%** |
| **current** | $124,753 | *ongoing (288d)* | **−48%** |

**At day 288 specifically — the exact point we are at now:**

| cycle | drawdown at day 288 | days left to bottom | further fall from that point |
|---|---|---|---|
| 2013–17 | −66% | 76d | **−51%** |
| 2021 | −68% | 90d | **−27%** |
| **current** | **−48%** | ? | ? |

By **time** we are ~78% through a typical decline (mean 371d → analogue bottom around
**mid-October 2026**). By **depth** we are far shallower than either predecessor was at
the same elapsed point.

## 2. The supply mechanism, and why its impact is shrinking

The halving is real and mechanical. It is also **arithmetically weakening every cycle**:

| halving | block reward | daily BTC issued | annual inflation | multiple from halving |
|---|---|---|---|---|
| 2012 | 25 | 3,600 | ~25% | **93×** |
| 2016 | 12.5 | 1,800 | ~4% | **30×** |
| 2020 | 6.25 | 900 | ~1.8% | **8×** |
| 2024 | 3.125 | 450 | **0.85%** | **~2×** |
| 2028 | 1.5625 | 225 | **0.4%** | ? |

**The 2012 halving removed ~25 percentage points of annual supply growth. The 2024
halving removed 0.85.** That is a roughly 30× smaller impulse — and the price response
decayed almost exactly in step (93× → 30× → 8× → 2×).

This is the key fundamental point: the decay is **not** vague "market maturation." The
causal impulse is shrinking by construction, and the effect is shrinking with it. By the
2028 halving ~97.7% of all BTC will be mined, and new issuance will be **<0.05% of daily
exchange volume**.

## 3. Scarcity vs cyclicality — a distinction worth keeping

- **Lost coins:** an estimated **3–4M BTC** are permanently lost; long-term holders
  (>1yr) hold ~70% of circulating supply.
- But this is a **stock** effect, not a **flow** effect. It raises the price *level*
  permanently; it is not periodic, so it cannot generate or amplify a four-year *cycle*.

Scarcity and cyclicality are separate claims. Lost keys support the first, not the second.

## 4. What actually flipped: demand now dwarfs supply

| | daily |
|---|---|
| Miner issuance (post-2024 halving) | 450 BTC ≈ **$28M** |
| Spot BTC ETF inflows | **$500M+** |

Spot ETFs hold **>1.25M BTC (6.4% of supply)**, AUM >$130bn. Demand flows run roughly
**12–18× the entire supply impulse**.

**The marginal price-setter has migrated from the supply schedule to demand flows.** This
is why the 2024 cycle tracked global liquidity and Fed policy more closely than the
halving itself, and why 60-day volatility has fallen from >200% (2012) to ~50% (2026).
Expansion/contraction is still real — but the clock is increasingly the **liquidity
cycle**, not the block schedule.

## 5. The two anchors disagree

| anchor | 2-year multiple trend |
|---|---|
| From **halving** | 93× → 30× → 8× → **2×** — collapsing |
| From **cycle bottom** | 4.6× → 6.0× → **6.2×** — stable |

Bottom-anchored returns have held up remarkably well (Jan-2015 → 4.6×, Dec-2018 → 6.0×,
Nov-2022 → 6.2×) even as halving-anchored returns collapsed.

**But two caveats sit on that:**

1. **It requires a bottom deep enough to buy.** Prior bottoms were −85%, −83%, −77%.
   This decline is −48% so far.
2. **It is close to the unconditional baseline.** Across *every* start date since 2014,
   the median 2-year multiple was **3.25×**; **53% of all start dates achieved ≥3×** and
   28% achieved ≥5×. So "3–5× in two years" is approximately what buying at a *random*
   moment returned. The bottom anchor beats it, but by less than the framing suggests —
   BTC's drift did most of the work, not the timing.

And the cost of admission, on every path: median **−62%** max drawdown *inside* a 2-year
hold, 68% of windows containing a >50% drawdown, and **17% of start dates losing money**.

## 6. Three defensible readings

| reading | implication |
|---|---|
| **Halving-driven** | ~9.5 months into a ~12-month decline; analogue bottom ≈ **$25–29k around Oct 2026** |
| **Liquidity-driven** | the 4-year clock is fading; watch Fed/liquidity, not the block schedule |
| **Decay** | −48% may be near the floor — each cycle's drawdown has shrunk 6–8 points (−85 → −83 → −77 → −48) |

All three fit the same data. With **n=3** completed cycles and a mechanism that provably
weakens each iteration, this cannot be resolved by inference. Anyone claiming otherwise
is expressing confidence, not evidence.

## 7. What the bot does instead

It does not pick. It re-enters when price closes back above the 200-day SMA — currently
**$72,800 and falling** as the decline ages, so the trigger descends toward price rather
than price having to climb back to it. Current gap: **~12%**.

This is the reactive answer to an unanswerable predictive question, and it is the version
the [123-year test](BATTLE_TEST.md) validated: predictive cycle timing ended with ~4% of
buy-and-hold's wealth; reactive regime timing beat buy-and-hold outright. On BTC
specifically the regime rule beat buy-and-hold on **both** return and risk (62% vs 52%
CAGR, −61% vs −83% drawdown).

The trade it makes: give up the first leg off the bottom, never catch the falling knife.

## 8. Checkpoints — what would confirm or falsify each reading

Recorded so this can be graded, not re-remembered:

- **By ~Oct 2026**, did price reach the $25–29k analogue zone? If it bottomed materially
  higher, the **decay** reading gains and the halving analogue weakens.
- **Did the decline exceed ~371 days?** A materially longer decline breaks the duration
  regularity that the halving clock implies.
- **Did the drawdown exceed −60%?** If it stopped near −48–55%, the shrinking-amplitude
  trend (−85 → −83 → −77 → …) continued and should be extrapolated forward.
- **When the bot re-entered, how close to the low was it?** This directly prices the cost
  of the reactive approach versus the (unknowable in advance) perfect entry.
- **Did BTC track liquidity/Fed more than the block schedule?** If yes, future cycle
  analysis should be re-anchored away from the halving entirely.

## Sources & quality note

Hard supply figures (block rewards, issuance, inflation rates, halving dates) are
verifiable protocol facts. ETF holdings and flow figures come from industry reporting.
**Several sources surfaced in this research were crypto-adjacent firms selling management
services or courses — their interpretive claims are discounted here; only their
verifiable numbers are used.** Price analysis is computed directly from dividend-adjusted
daily data in `scratchpad/`.

- `scratchpad/btc_cycle_claim.py` — 2-year multiples from bottoms/halvings, timing
  sensitivity, unconditional baseline, drawdown distribution.
- `scratchpad/btc_where_now.py` — cycle alignment by days-since-peak, analogue projection.
