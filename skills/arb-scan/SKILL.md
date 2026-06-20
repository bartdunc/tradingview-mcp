---
name: arb-scan
description: Scan Crypto.com perpetual futures for funding rate arbitrage opportunities. Ranks instruments by estimated funding rate, projects weekly/monthly/annual returns, and gives cycle-aware allocation advice. Uses the Crypto.com MCP tools (works in cloud sessions).
---

# Funding Rate Arbitrage Scanner

You are scanning Crypto.com perpetual futures for delta-neutral funding rate arbitrage.

**Strategy**: Long spot + short perp (or reverse for negative rates) = no directional risk, earn funding 3× daily.

## Step 1: Get All Tickers

Call `mcp__Crypto_com__get_tickers` with no filter to get all instruments.

Filter the results to find PERP instruments (`instrument_name` ends with `PERP`) that have `open_interest > 0`. Sort by `open_interest * last` (USD value) descending. Take the top 15 by OI.

## Step 2: Get BTC Price for Cycle Context

From the tickers, find `BTCUSD` and note its `last` price. Use this to determine cycle phase:

| BTC Price | Phase | Strategy |
|-----------|-------|----------|
| >$90k | Mania | 70%+ into alts, 100-300% APR window |
| $55k-$90k | Bull | BTC/ETH 70%, alts 30%, target 30-60% APR |
| $25k-$55k | Accumulation | BTC/ETH only, 10-25% APR |
| <$25k | Bear | Reverse arb or stablecoins, 5-12% APR |

## Step 3: Get Mark vs Index Price for Top 15 Perps

For each of the top 15 PERP instruments:
1. Convert name to hyphenated format: `BTCUSDPERP` → `BTCUSD-PERP` (insert `-` before `PERP`)
2. Call `mcp__Crypto_com__get_mark_price` with that instrument name
3. Call `mcp__Crypto_com__get_index_price` with the index name: replace `-PERP` with `-INDEX`

Run these in parallel batches of 5 to keep it fast.

## Step 4: Calculate Funding Rate Premium

For each instrument:
```
premium = (mark_price - index_price) / index_price
```

This is an estimate of the 8-hour funding rate. On Crypto.com, funding = premium clamped to ±0.075%/8h. Very small premium (< 0.001%) = near-floor rate (~0.01%/8h).

**Project returns** (funding paid 3× daily = every 8h):
```
rate_8h  = premium (as %)
daily    = rate_8h × 3
weekly   = daily × 7
monthly  = daily × 30
annual   = daily × 365
```

**Direction**:
- Positive premium (mark > index): long spot + short perp
- Negative premium (mark < index): short spot + long perp (reverse arb)

## Step 5: Build the Output Table

Sort by absolute premium descending. Present as a clean table:

```
Symbol          | Rate/8h  | Daily  | Weekly | Monthly | Annual | OI ($M) | Direction
----------------|----------|--------|--------|---------|--------|---------|----------
SUIUSD-PERP     | +0.028%  | 0.084% | 0.59%  | 2.52%   | 30.7%  | $4.2M   | Long spot
BTCUSD-PERP     | -0.003%  | -0.009%| -0.06% | -0.27%  | -3.3%  | $390M   | (skip — near zero)
```

**Flag**:
- ✅ Above 0.03%/8h: Strong arb opportunity
- ⚠️ 0.01-0.03%/8h: Marginal — watch fees (~0.30% round-trip)  
- ❌ Below 0.01%/8h: Not worth it right now

## Step 6: Return on Capital Projection

Pick the median rate from the top 5 results. Project on $100k capital:

```
Weekly:  $100,000 × annual_pct% / 52
Monthly: $100,000 × annual_pct% / 12
Annual:  $100,000 × annual_pct%
```

## Step 7: Summary Report

Output:
1. **Cycle phase** with allocation advice
2. **Top opportunities** table (sorted by rate)
3. **Return projection** on $100k at median rate
4. **Risk reminders**:
   - Max 40% capital per exchange (exchange counterparty risk)
   - Monitor daily — exit when rate compresses below your fee threshold
   - Keep perp position collateralised at >3× margin to avoid liquidation
   - Rates can flip sign in minutes during volatile sessions

## Notes

- `arb_scan_funding` MCP tool does the same thing automatically via Crypto.com REST API (requires local network access, not cloud-restricted environments)
- Best windows: altcoin mania phases, early bull runs. Worst: flat consolidation (like now if BTC premium ≈ 0)
- Historical alt rates during mania: SOL, SUI, DOGE, WIF perps often hit 0.05-0.3%/8h
