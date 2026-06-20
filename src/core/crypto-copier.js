import { createHmac } from 'crypto';

const BASE = 'https://api.bitget.com';

function env(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing ${key} in .env — needed for authenticated requests`);
  return val;
}

function sign(ts, method, path, body = '') {
  return createHmac('sha256', env('BITGET_SECRET_KEY'))
    .update(ts + method.toUpperCase() + path + body)
    .digest('base64');
}

async function request(method, path, body = null, auth = false) {
  const ts = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : '';
  const headers = { 'Content-Type': 'application/json', locale: 'en-US' };

  if (auth) {
    headers['ACCESS-KEY'] = env('BITGET_API_KEY');
    headers['ACCESS-SIGN'] = sign(ts, method, path, bodyStr);
    headers['ACCESS-TIMESTAMP'] = ts;
    headers['ACCESS-PASSPHRASE'] = env('BITGET_PASSPHRASE');
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(bodyStr && { body: bodyStr }),
  });

  const data = await res.json();
  if (data.code !== '00000') {
    throw new Error(`BitGet API (${data.code}): ${data.msg}`);
  }
  return data.data;
}

// Composite score: win rate weighted most, then ROI, penalise drawdown
function score(t) {
  const wr = parseFloat(t.winRate || 0) * 100;
  const roi = parseFloat(t.copyTradeROI || 0) * 100;
  const dd = parseFloat(t.maxDrawdown || 0) * 100;
  return wr * 0.4 + roi * 0.3 - dd * 0.3;
}

function formatTrader(t) {
  return {
    traderId: t.traderId,
    name: t.nickName || 'Anonymous',
    score: score(t).toFixed(1),
    roi: `${(parseFloat(t.copyTradeROI || 0) * 100).toFixed(2)}%`,
    winRate: `${(parseFloat(t.winRate || 0) * 100).toFixed(1)}%`,
    maxDrawdown: `${(parseFloat(t.maxDrawdown || 0) * 100).toFixed(1)}%`,
    followers: parseInt(t.followerNum || 0),
    tradeCount: parseInt(t.tradeCount || 0),
    totalProfit: t.totalProfit || '0',
    avgHoldingTime: t.avgHoldingTime || '-',
    assetsUnderMgmt: t.assetsUnderManage || '0',
  };
}

export async function findTraders({
  productType = 'USDT-FUTURES',
  pageSize = 20,
  pageNo = 1,
  minWinRate = 0,
  minRoi = 0,
  maxDrawdown = 100,
  sortBy = 'score',
} = {}) {
  const path = `/api/v2/copy/mix/follower/query-traders?productType=${productType}&pageSize=${pageSize}&pageNo=${pageNo}`;
  const raw = await request('GET', path);

  const list = (raw?.traderList || raw || [])
    .filter(t => {
      const wr = parseFloat(t.winRate || 0) * 100;
      const roi = parseFloat(t.copyTradeROI || 0) * 100;
      const dd = parseFloat(t.maxDrawdown || 0) * 100;
      return wr >= minWinRate && roi >= minRoi && dd <= maxDrawdown;
    })
    .map(formatTrader);

  if (sortBy === 'score') list.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));
  else if (sortBy === 'roi') list.sort((a, b) => parseFloat(b.roi) - parseFloat(a.roi));
  else if (sortBy === 'winRate') list.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));
  else if (sortBy === 'followers') list.sort((a, b) => b.followers - a.followers);

  return {
    success: true,
    productType,
    page: pageNo,
    total: raw?.totalCount || list.length,
    filters: { minWinRate, minRoi, maxDrawdown, sortBy },
    traders: list,
  };
}

export async function getTraderProfile({ traderId, productType = 'USDT-FUTURES' }) {
  const path = `/api/v2/copy/mix/trader/symbol-settings?traderId=${traderId}&productType=${productType}`;
  const data = await request('GET', path);
  return { success: true, traderId, productType, profile: data };
}

export async function getTraderPositions({ traderId, productType = 'USDT-FUTURES' }) {
  const path = `/api/v2/copy/mix/trader/track-position-list?traderId=${traderId}&productType=${productType}`;
  const raw = await request('GET', path);
  const positions = (raw || []).map(p => ({
    symbol: p.symbol,
    side: p.holdSide || p.side,
    size: p.total || p.size,
    entryPrice: p.openPriceAvg || p.averageOpenPrice,
    markPrice: p.markPrice,
    pnl: p.unrealizedPL,
    pnlPct: p.unrealizedPLR ? `${(parseFloat(p.unrealizedPLR) * 100).toFixed(2)}%` : '-',
    leverage: p.leverage,
    openTime: p.openTime ? new Date(parseInt(p.openTime)).toISOString() : '-',
  }));
  return { success: true, traderId, productType, positions };
}

export async function followTrader({
  traderId,
  productType = 'USDT-FUTURES',
  copyMode = 'fixed_amount',
  copyAmount,
  maxCopyAmount,
  stopLossPercent,
  takeProfitPercent,
}) {
  const body = {
    traderId,
    productType,
    copyMode,
    ...(copyAmount != null && { copyAmount: copyAmount.toString() }),
    ...(maxCopyAmount != null && { maxCopyAmount: maxCopyAmount.toString() }),
    ...(stopLossPercent != null && { stopLoss: (stopLossPercent / 100).toString() }),
    ...(takeProfitPercent != null && { takeProfit: (takeProfitPercent / 100).toString() }),
  };
  const data = await request('POST', '/api/v2/copy/mix/follower/follow-config', body, true);
  return { success: true, traderId, message: 'Now following trader', result: data };
}

export async function unfollowTrader({ traderId, productType = 'USDT-FUTURES' }) {
  const data = await request('POST', '/api/v2/copy/mix/follower/cancel-trader', { traderId, productType }, true);
  return { success: true, traderId, message: 'Unfollowed trader', result: data };
}

export async function getCopyStatus({ productType = 'USDT-FUTURES' } = {}) {
  const path = `/api/v2/copy/mix/follower/query-current-traders?productType=${productType}`;
  const raw = await request('GET', path, null, true);
  const traders = (raw?.traderList || raw || []).map(t => ({
    traderId: t.traderId,
    name: t.nickName || 'Anonymous',
    followingSince: t.followTime ? new Date(parseInt(t.followTime)).toISOString() : '-',
    myRoi: t.followROI ? `${(parseFloat(t.followROI) * 100).toFixed(2)}%` : '-',
    myProfit: t.totalProfit || '0',
    copyAmount: t.copyAmount || '-',
    copyMode: t.copyMode || '-',
  }));
  return { success: true, productType, count: traders.length, following: traders };
}

export async function getMyPositions({ traderId, productType = 'USDT-FUTURES' } = {}) {
  const qs = ['productType=' + productType, traderId ? 'traderId=' + traderId : '']
    .filter(Boolean).join('&');
  const path = `/api/v2/copy/mix/follower/current-track-symbol-list?${qs}`;
  const raw = await request('GET', path, null, true);
  const positions = (raw || []).map(p => ({
    symbol: p.symbol,
    traderId: p.traderId,
    traderName: p.nickName || '-',
    side: p.holdSide || p.side,
    size: p.total || p.size,
    entryPrice: p.openPriceAvg,
    markPrice: p.markPrice,
    pnl: p.unrealizedPL,
    pnlPct: p.unrealizedPLR ? `${(parseFloat(p.unrealizedPLR) * 100).toFixed(2)}%` : '-',
    leverage: p.leverage,
  }));
  return { success: true, productType, positions };
}
