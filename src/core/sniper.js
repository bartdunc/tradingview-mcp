/**
 * Crypto wallet sniper core — monitors Solana "smart money" wallets for swap
 * activity and surfaces the token on the TradingView chart.
 *
 * Data sources:
 *  - Helius enhanced transactions API (requires free API key) → rich swap parsing
 *  - Public Solana mainnet RPC fallback (no key) → signature count only
 *  - DexScreener API (no key) → token info + TradingView symbol resolution
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chart from './chart.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../');
const USER_DATA_DIR = resolve(join(homedir(), '.tradingview-mcp'));
export const DEFAULT_CONFIG_PATH = join(PROJECT_ROOT, 'sniper.json');

// Well-known Solana token mints to skip when classifying swaps
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const STABLE_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX', // USDH
  'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA', // USDS
]);

const DEFAULT_CONFIG = {
  wallets: [],
  api_key: '',
  auto_snap: false,
  seen_signatures: {},
  alert_history: [],
};

// ── Config helpers ────────────────────────────────────────────────────────────

function assertSafeConfigPath(p) {
  const resolved = resolve(p);
  const inProject = resolved === resolve(join(PROJECT_ROOT, 'sniper.json'))
    || resolved.startsWith(resolve(PROJECT_ROOT) + '/');
  const inUserData = resolved.startsWith(USER_DATA_DIR + '/');
  if (!inProject && !inUserData) {
    throw new Error(
      `config_path must be inside the project or ~/.tradingview-mcp/. Got: ${resolved}`,
    );
  }
}

function loadConfig(configPath) {
  if (configPath !== DEFAULT_CONFIG_PATH) assertSafeConfigPath(configPath);
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(configPath, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg, configPath) {
  // Cap alert history to last 200 entries
  if (cfg.alert_history?.length > 200) cfg.alert_history = cfg.alert_history.slice(0, 200);
  writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

// ── Wallet management ─────────────────────────────────────────────────────────

function isSolanaAddress(address) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

export function addWallet({ address, label, config_path = DEFAULT_CONFIG_PATH }) {
  if (!isSolanaAddress(address)) {
    return { success: false, error: 'Invalid Solana address (base58, 32–44 chars)' };
  }
  const cfg = loadConfig(config_path);
  if (cfg.wallets.find(w => w.address === address)) {
    return { success: false, error: 'Wallet already tracked' };
  }
  const entry = { address, label: label || `Wallet ${cfg.wallets.length + 1}`, added_at: new Date().toISOString() };
  cfg.wallets.push(entry);
  saveConfig(cfg, config_path);
  return { success: true, wallet: entry, total_wallets: cfg.wallets.length };
}

export function removeWallet({ address, config_path = DEFAULT_CONFIG_PATH }) {
  const cfg = loadConfig(config_path);
  const before = cfg.wallets.length;
  cfg.wallets = cfg.wallets.filter(w => w.address !== address);
  if (cfg.wallets.length === before) return { success: false, error: 'Wallet not found' };
  delete cfg.seen_signatures[address];
  saveConfig(cfg, config_path);
  return { success: true, removed: address, remaining_wallets: cfg.wallets.length };
}

export function listWallets({ config_path = DEFAULT_CONFIG_PATH }) {
  const cfg = loadConfig(config_path);
  return {
    success: true,
    wallets: cfg.wallets,
    count: cfg.wallets.length,
    api_key_set: !!cfg.api_key,
    auto_snap: cfg.auto_snap,
    tip: cfg.api_key ? null : 'Get a free Helius API key at helius.xyz for detailed swap data',
  };
}

export function setApiKey({ api_key, config_path = DEFAULT_CONFIG_PATH }) {
  const cfg = loadConfig(config_path);
  cfg.api_key = api_key;
  saveConfig(cfg, config_path);
  return { success: true, message: 'Helius API key saved to sniper.json' };
}

export function configure({ auto_snap, config_path = DEFAULT_CONFIG_PATH }) {
  const cfg = loadConfig(config_path);
  if (auto_snap !== undefined) cfg.auto_snap = auto_snap;
  saveConfig(cfg, config_path);
  return { success: true, auto_snap: cfg.auto_snap };
}

// ── Network helpers ───────────────────────────────────────────────────────────

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Solana data fetching ──────────────────────────────────────────────────────

async function fetchHeliusSwaps(address, apiKey, limit = 20) {
  const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${apiKey}&limit=${limit}&type=SWAP`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Helius API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchRpcSignatures(address, limit = 10) {
  const res = await fetchWithTimeout('https://api.mainnet-beta.solana.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress',
      params: [address, { limit }],
    }),
  });
  const data = await res.json();
  return data.result || [];
}

// ── Token resolution via DexScreener ─────────────────────────────────────────

export async function resolveToken(mint) {
  try {
    const res = await fetchWithTimeout(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
      {},
      8000,
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.pairs?.length) return null;

    // Prefer Solana pairs; within those, highest liquidity
    const solanaPairs = data.pairs.filter(p => p.chainId === 'solana');
    const pool = (solanaPairs.length ? solanaPairs : data.pairs)
      .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

    const dex = pool.dexId.toUpperCase();
    const base = pool.baseToken.symbol;
    const quote = pool.quoteToken.symbol;

    return {
      symbol: base,
      name: pool.baseToken.name,
      mint: pool.baseToken.address,
      tv_symbol: `${dex}:${base}${quote}`,
      price_usd: pool.priceUsd ? parseFloat(pool.priceUsd) : null,
      price_change_24h: pool.priceChange?.h24 ?? null,
      volume_24h: pool.volume?.h24 ?? null,
      liquidity_usd: pool.liquidity?.usd ?? null,
      market_cap: pool.marketCap ?? null,
      dex: pool.dexId,
      pair_address: pool.pairAddress,
      dexscreener_url: pool.url,
    };
  } catch {
    return null;
  }
}

// ── Swap parsing ──────────────────────────────────────────────────────────────

function isInteresting(mint) {
  return mint && mint !== SOL_MINT && !STABLE_MINTS.has(mint);
}

function parseHeliusSwap(tx, walletAddress) {
  if (tx.type !== 'SWAP') return null;

  // Prefer the structured swap event (most reliable)
  const swapEvent = tx.events?.swap;
  if (swapEvent) {
    for (const out of swapEvent.tokenOutputs || []) {
      if (out.userAccount === walletAddress && isInteresting(out.mint)) {
        return {
          action: 'BUY',
          mint: out.mint,
          token_amount: out.rawTokenAmount?.tokenAmount,
          decimals: out.rawTokenAmount?.decimals,
        };
      }
    }
    for (const inp of swapEvent.tokenInputs || []) {
      if (inp.userAccount === walletAddress && isInteresting(inp.mint)) {
        return {
          action: 'SELL',
          mint: inp.mint,
          token_amount: inp.rawTokenAmount?.tokenAmount,
          decimals: inp.rawTokenAmount?.decimals,
        };
      }
    }
  }

  // Fallback: raw token transfers
  const transfers = tx.tokenTransfers || [];
  const received = transfers.find(
    t => t.toUserAccount === walletAddress && isInteresting(t.mint),
  );
  if (received) return { action: 'BUY', mint: received.mint, token_amount: received.tokenAmount };

  const sent = transfers.find(
    t => t.fromUserAccount === walletAddress && isInteresting(t.mint),
  );
  if (sent) return { action: 'SELL', mint: sent.mint, token_amount: sent.tokenAmount };

  return null;
}

// ── Main scan ─────────────────────────────────────────────────────────────────

export async function scan({ config_path = DEFAULT_CONFIG_PATH } = {}) {
  const cfg = loadConfig(config_path);

  if (!cfg.wallets.length) {
    return {
      success: true,
      alerts: [],
      message: 'No wallets tracked. Add one with sniper_add_wallet.',
    };
  }

  const newAlerts = [];

  for (const wallet of cfg.wallets) {
    try {
      if (cfg.api_key) {
        const txs = await fetchHeliusSwaps(wallet.address, cfg.api_key, 20);
        const lastSeen = cfg.seen_signatures[wallet.address];

        for (const tx of txs) {
          if (tx.signature === lastSeen) break; // reached previously-seen boundary

          const swap = parseHeliusSwap(tx, wallet.address);
          if (!swap) continue;

          const token = await resolveToken(swap.mint);
          newAlerts.push({
            ts: new Date(tx.timestamp * 1000).toISOString(),
            wallet_label: wallet.label,
            wallet_address: wallet.address,
            action: swap.action,
            mint: swap.mint,
            token_amount: swap.token_amount,
            decimals: swap.decimals,
            token,
            signature: tx.signature,
            description: tx.description || null,
          });
        }

        if (txs.length > 0) cfg.seen_signatures[wallet.address] = txs[0].signature;

      } else {
        // Public RPC fallback — no swap parsing, just activity detection
        const sigs = await fetchRpcSignatures(wallet.address, 10);
        const lastSeen = cfg.seen_signatures[wallet.address];
        const newIdx = lastSeen ? sigs.findIndex(s => s.signature === lastSeen) : sigs.length;
        const newCount = newIdx < 0 ? sigs.length : newIdx;

        if (newCount > 0) {
          newAlerts.push({
            ts: new Date().toISOString(),
            wallet_label: wallet.label,
            wallet_address: wallet.address,
            action: 'ACTIVITY',
            new_tx_count: newCount,
            latest_signature: sigs[0]?.signature,
            note: 'Add a Helius API key via sniper_set_api_key for detailed swap data (free at helius.xyz)',
          });
          cfg.seen_signatures[wallet.address] = sigs[0]?.signature;
        }
      }
    } catch (err) {
      newAlerts.push({
        ts: new Date().toISOString(),
        wallet_label: wallet.label,
        wallet_address: wallet.address,
        error: err.message,
      });
    }
  }

  // Prepend new alerts to history
  cfg.alert_history = [...newAlerts, ...(cfg.alert_history || [])];
  saveConfig(cfg, config_path);

  // Auto-snap to most recent buy if enabled
  let autoSnapResult = null;
  if (cfg.auto_snap && newAlerts.length > 0) {
    const buy = newAlerts.find(a => a.action === 'BUY' && a.token?.tv_symbol);
    if (buy) {
      autoSnapResult = await snapToToken({ mint: buy.mint, config_path }).catch(e => ({ error: e.message }));
    }
  }

  return {
    success: true,
    new_alerts: newAlerts.length,
    alerts: newAlerts,
    wallets_scanned: cfg.wallets.length,
    ...(autoSnapResult && { auto_snap: autoSnapResult }),
  };
}

// ── Token snap ────────────────────────────────────────────────────────────────

export async function snapToToken({ mint, config_path = DEFAULT_CONFIG_PATH }) {
  const token = await resolveToken(mint);
  if (!token) {
    return { success: false, error: `No DexScreener data for mint: ${mint}` };
  }
  try {
    const result = await chart.setSymbol({ symbol: token.tv_symbol });
    return { success: true, token, chart: result };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      token,
      hint: 'TradingView may not list this token yet, or CDP is not connected.',
    };
  }
}

// ── Alert history ─────────────────────────────────────────────────────────────

export function getHistory({ config_path = DEFAULT_CONFIG_PATH, limit = 30 } = {}) {
  const cfg = loadConfig(config_path);
  const history = cfg.alert_history || [];
  return {
    success: true,
    alerts: history.slice(0, limit),
    total: history.length,
    showing: Math.min(limit, history.length),
  };
}
