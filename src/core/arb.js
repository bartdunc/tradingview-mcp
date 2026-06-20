const CRYPTO_COM_API = 'https://api.crypto.com/exchange/v1/public';

async function apiFetch(path, params = {}) {
  const url = new URL(`${CRYPTO_COM_API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  } catch (e) {
    throw new Error(`Network error reaching api.crypto.com — run this tool locally (not in a restricted cloud environment). Details: ${e.message}`);
  }
  if (!res.ok) {
    if (res.status === 403) throw new Error('api.crypto.com is not in the network allowlist for this environment. Run the MCP server locally to use this tool, or use the /arb-scan skill instead.');
    throw new Error(`HTTP ${res.status} from ${path}`);
  }
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.message || `API error code ${json.code}`);
  return json.result;
}

// Tickers use BTCUSDPERP, valuations API uses BTCUSD-PERP
function toHyphenated(name) {
  if (name.endsWith('-PERP')) return name;
  if (name.endsWith('PERP')) return name.slice(0, -4) + '-PERP';
  return name;
}

// Funding is paid every 8h (3× daily) on Crypto.com
function projectReturns(ratePerInterval) {
  const daily = ratePerInterval * 3;
  return {
    per_8h_pct: +(ratePerInterval * 100).toFixed(4),
    daily_pct:  +(daily * 100).toFixed(3),
    weekly_pct: +(daily * 7 * 100).toFixed(2),
    monthly_pct:+(daily * 30 * 100).toFixed(2),
    annual_pct: +(daily * 365 * 100).toFixed(1),
  };
}

function cycleContext(btcPrice) {
  if (btcPrice >= 90000) return {
    phase: 'mania',
    allocation: 'Rotate 70%+ into alts',
    target_apr: '100–300%',
    note: 'Alt perp funding rates are spiking — peak arb window, watch for rate flips',
  };
  if (btcPrice >= 55000) return {
    phase: 'bull',
    allocation: 'BTC/ETH 70%, alts 30%',
    target_apr: '30–60%',
    note: 'Steady bull — BTC/ETH reliable base, start rotating to hot alts above 0.03%/8h',
  };
  if (btcPrice >= 25000) return {
    phase: 'accumulation',
    allocation: 'BTC/ETH only',
    target_apr: '10–25%',
    note: 'Flat market — funding near floor. Stack and wait for the next momentum leg',
  };
  return {
    phase: 'bear',
    allocation: 'Reverse arb or stablecoins',
    target_apr: '5–12%',
    note: 'Funding goes negative in bear — flip to short spot + long perp, or park in stables',
  };
}

export async function scanFundingRates({ min_annual_pct = 0, top_n = 20, include_reverse = false } = {}) {
  // Fetch all tickers for open interest filtering
  const tickersResult = await apiFetch('get-tickers');
  const allTickers = tickersResult.data ?? [];

  // Build map and find BTC price for cycle context
  const tickerMap = {};
  for (const t of allTickers) tickerMap[t.instrument_name] = t;
  const btcPrice = parseFloat(tickerMap['BTCUSD']?.last ?? tickerMap['BTCUSDT']?.last ?? 0);

  // Filter to PERP instruments with open interest
  const perps = allTickers
    .filter(t => t.instrument_name.endsWith('PERP') && parseFloat(t.open_interest ?? 0) > 0)
    .map(t => ({
      ticker_name: t.instrument_name,
      api_name: toHyphenated(t.instrument_name),
      oi_contracts: parseFloat(t.open_interest ?? 0),
      oi_usd: parseFloat(t.open_interest ?? 0) * parseFloat(t.last ?? 0),
      last_price: parseFloat(t.last ?? 0),
    }))
    .filter(p => p.oi_usd > 50000) // minimum $50k OI for liquidity
    .sort((a, b) => b.oi_usd - a.oi_usd)
    .slice(0, 60); // cap at top 60 by OI

  // Fetch funding rates in batches to avoid rate limits
  const BATCH_SIZE = 8;
  const scanned = [];

  for (let i = 0; i < perps.length; i += BATCH_SIZE) {
    const batch = perps.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (p) => {
        const val = await apiFetch('get-valuations', {
          instrument_name: p.api_name,
          valuation_type: 'funding_rate',
          count: 1,
        });
        const rawRate = parseFloat(val.data?.[0]?.v ?? 0);
        const returns = projectReturns(rawRate);
        return { ...p, rawRate, returns };
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled') scanned.push(r.value);
    }
    if (i + BATCH_SIZE < perps.length) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  const minRateRaw = min_annual_pct / (3 * 365 * 100);

  const filtered = scanned
    .filter(p => include_reverse
      ? Math.abs(p.rawRate) >= minRateRaw
      : p.rawRate >= minRateRaw
    )
    .sort((a, b) => b.rawRate - a.rawRate)
    .slice(0, top_n)
    .map(p => ({
      symbol: p.ticker_name,
      direction: p.rawRate >= 0 ? 'long_spot + short_perp' : 'short_spot + long_perp',
      ...p.returns,
      oi_usd: Math.round(p.oi_usd),
      last_price: p.last_price,
    }));

  // Projected return on $100k capital at median rate of top results
  const topRates = filtered.slice(0, 5).map(p => p.annual_pct);
  const medianAnnual = topRates.length
    ? topRates[Math.floor(topRates.length / 2)]
    : 0;

  return {
    success: true,
    scan_time: new Date().toISOString(),
    btc_price: btcPrice,
    cycle: cycleContext(btcPrice),
    instruments_scanned: scanned.length,
    results: filtered,
    projected_on_100k: {
      weekly_usd:  +(100000 * medianAnnual / 100 / 52).toFixed(0),
      monthly_usd: +(100000 * medianAnnual / 100 / 12).toFixed(0),
      annual_usd:  +(100000 * medianAnnual / 100).toFixed(0),
      based_on_rate: `${medianAnnual}% APR (median of top 5)`,
    },
    notes: [
      'Round-trip fees ~0.30% (Crypto.com taker). Break-even: ~3-4 days at 0.03%/8h.',
      'Never >40% capital on one exchange — hedge exchange risk.',
      'Monitor daily: exit when rate compresses below your fee threshold.',
      'Reverse arb (negative funding) = short spot + long perp — same math, opposite legs.',
    ],
  };
}
