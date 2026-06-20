/**
 * Auto-trade execution core — buys/sells Solana tokens via Jupiter DEX.
 *
 * Requires:
 *   npm install @solana/web3.js
 *   SOLANA_PRIVATE_KEY=<base58 or JSON array> in .env or environment
 *
 * Risk guardrails (all configurable in sniper.json under "trade"):
 *   max_sol_per_trade   — hard cap per buy (default 0.1 SOL)
 *   slippage_bps        — slippage tolerance (default 300 = 3%)
 *   min_liquidity_usd   — skip tokens with thin liquidity (default $10 000)
 *   min_market_cap_usd  — skip micro-cap rugs (default $50 000)
 *   stop_loss_pct       — auto-sell if down this % from entry (default 50)
 *   take_profit_pct     — auto-sell if up this % from entry (default 300 = 3x)
 *   max_open_positions  — don't open more than N positions at once (default 5)
 *   circuit_breaker_sol — stop all trading if total loss exceeds N SOL (default 1)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG_PATH, loadConfig, saveConfig } from './sniper.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_QUOTE = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP = 'https://quote-api.jup.ag/v6/swap';

// ── Base58 decode (no external dependency) ────────────────────────────────────
const B58_ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str) {
  const bytes = [];
  for (const ch of str) {
    let carry = B58_ALPHA.indexOf(ch);
    if (carry < 0) throw new Error(`Invalid base58 char: ${ch}`);
    for (let i = 0; i < bytes.length; ++i) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 255;
      carry >>= 8;
    }
    while (carry) { bytes.push(carry & 255); carry >>= 8; }
  }
  for (const ch of str) {
    if (ch !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

// ── Solana imports (lazy — only load when trading is used) ────────────────────
let _solana = null;
async function getSolana() {
  if (_solana) return _solana;
  try {
    _solana = await import('@solana/web3.js');
    return _solana;
  } catch {
    throw new Error('@solana/web3.js not installed. Run: npm install');
  }
}

function loadKeypair() {
  const raw = process.env.SOLANA_PRIVATE_KEY;
  if (!raw) throw new Error('SOLANA_PRIVATE_KEY not set in environment (add to .env file)');

  const solana = _solana; // must already be loaded
  let secretKey;
  if (raw.trim().startsWith('[')) {
    secretKey = Uint8Array.from(JSON.parse(raw.trim()));
  } else {
    const decoded = base58Decode(raw.trim());
    secretKey = decoded.length === 64 ? decoded : (() => {
      // 32-byte seed → expand to 64-byte keypair
      const kp = solana.Keypair.fromSeed(decoded.slice(0, 32));
      return kp.secretKey;
    })();
  }
  return solana.Keypair.fromSecretKey(secretKey);
}

// ── Network helper ────────────────────────────────────────────────────────────
async function fetchWithTimeout(url, opts = {}, ms = 12000) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
  return res;
}

// ── RPC connection ────────────────────────────────────────────────────────────
function getRpcUrl(cfg) {
  if (cfg?.api_key) {
    return `https://mainnet.helius-rpc.com/?api-key=${cfg.api_key}`;
  }
  return 'https://api.mainnet-beta.solana.com';
}

// ── Balance ───────────────────────────────────────────────────────────────────
export async function getBalance(config_path = DEFAULT_CONFIG_PATH) {
  const { Connection } = await getSolana();
  const cfg = loadConfig(config_path);
  const keypair = loadKeypair();
  const conn = new Connection(getRpcUrl(cfg), 'confirmed');
  const lamports = await conn.getBalance(keypair.publicKey);
  return {
    success: true,
    address: keypair.publicKey.toString(),
    sol: lamports / 1e9,
    lamports,
  };
}

// ── Jupiter swap ──────────────────────────────────────────────────────────────
async function jupiterQuote(inputMint, outputMint, amountLamports, slippageBps) {
  const url = `${JUPITER_QUOTE}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps}`;
  const res = await fetchWithTimeout(url, {}, 15000);
  if (!res.ok) throw new Error(`Jupiter quote ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  if (data.error) throw new Error(`Jupiter quote error: ${data.error}`);
  return data;
}

async function jupiterSwapTx(quoteResponse, userPublicKey) {
  const res = await fetchWithTimeout(JUPITER_SWAP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  }, 15000);
  if (!res.ok) throw new Error(`Jupiter swap ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

// ── Execute buy ───────────────────────────────────────────────────────────────
export async function executeBuy({ mint, amountSol, token, wallet_label, config_path = DEFAULT_CONFIG_PATH }) {
  const { Connection, VersionedTransaction } = await getSolana();
  const cfg = loadConfig(config_path);
  const trade = cfg.trade || {};
  const slippage = trade.slippage_bps ?? 300;

  const keypair = loadKeypair();
  const conn = new Connection(getRpcUrl(cfg), 'confirmed');

  const lamports = Math.floor(amountSol * 1e9);
  const quote = await jupiterQuote(SOL_MINT, mint, lamports, slippage);
  const { swapTransaction } = await jupiterSwapTx(quote, keypair.publicKey.toString());

  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  tx.sign([keypair]);

  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  await conn.confirmTransaction(sig, 'confirmed');

  const outAmount = Number(quote.outAmount);
  const decimals = quote.outputDecimals ?? 0;
  const tokensReceived = outAmount / Math.pow(10, decimals);
  const entryPriceUsd = token?.price_usd ? Number(token.price_usd) : null;

  // Record position
  const position = {
    id: `${Date.now()}`,
    mint,
    symbol: token?.symbol || mint.slice(0, 8),
    name: token?.name || null,
    sol_spent: amountSol,
    tokens_received: tokensReceived,
    out_amount_raw: outAmount,
    decimals,
    entry_price_usd: entryPriceUsd,
    entry_tx: sig,
    opened_at: new Date().toISOString(),
    wallet_trigger: wallet_label || null,
    status: 'open',
    dexscreener_url: token?.dexscreener_url || null,
  };
  addPosition(position, cfg, config_path);

  return {
    success: true,
    signature: sig,
    explorer_url: `https://solscan.io/tx/${sig}`,
    sol_spent: amountSol,
    tokens_received: tokensReceived,
    price_impact_pct: Number(quote.priceImpactPct || 0),
    position_id: position.id,
  };
}

// ── Execute sell ──────────────────────────────────────────────────────────────
export async function executeSell({ mint, amountTokenRaw, decimals, positionId, reason, config_path = DEFAULT_CONFIG_PATH }) {
  const { Connection, VersionedTransaction } = await getSolana();
  const cfg = loadConfig(config_path);
  const trade = cfg.trade || {};
  const slippage = trade.slippage_bps ?? 300;

  const keypair = loadKeypair();
  const conn = new Connection(getRpcUrl(cfg), 'confirmed');

  const quote = await jupiterQuote(mint, SOL_MINT, amountTokenRaw, slippage);
  const { swapTransaction } = await jupiterSwapTx(quote, keypair.publicKey.toString());

  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  tx.sign([keypair]);

  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await conn.confirmTransaction(sig, 'confirmed');

  const solReceived = Number(quote.outAmount) / 1e9;

  // Update position
  closePosition(positionId, { close_tx: sig, sol_received: solReceived, close_reason: reason }, cfg, config_path);

  return {
    success: true,
    signature: sig,
    explorer_url: `https://solscan.io/tx/${sig}`,
    sol_received: solReceived,
    reason,
  };
}

// ── Position management ───────────────────────────────────────────────────────
function addPosition(position, cfg, config_path) {
  if (!cfg.positions) cfg.positions = [];
  cfg.positions.unshift(position);
  if (cfg.positions.length > 200) cfg.positions = cfg.positions.slice(0, 200);
  saveConfig(cfg, config_path);
}

function closePosition(id, updates, cfg, config_path) {
  if (!cfg.positions) return;
  const pos = cfg.positions.find(p => p.id === id);
  if (pos) {
    Object.assign(pos, updates, { status: 'closed', closed_at: new Date().toISOString() });
    saveConfig(cfg, config_path);
  }
}

export function listPositions({ config_path = DEFAULT_CONFIG_PATH, status = 'open' } = {}) {
  const cfg = loadConfig(config_path);
  const all = cfg.positions || [];
  const filtered = status === 'all' ? all : all.filter(p => p.status === status);
  return { success: true, positions: filtered, count: filtered.length };
}

// ── Stop-loss / take-profit monitor ──────────────────────────────────────────
export async function checkPositions({ config_path = DEFAULT_CONFIG_PATH } = {}) {
  const cfg = loadConfig(config_path);
  const trade = cfg.trade || {};
  const stopLoss = trade.stop_loss_pct ?? 50;
  const takeProfit = trade.take_profit_pct ?? 300;
  const openPositions = (cfg.positions || []).filter(p => p.status === 'open');

  if (!openPositions.length) return { actions: [] };

  const actions = [];

  for (const pos of openPositions) {
    if (!pos.entry_price_usd) continue;

    try {
      // Fetch current price from DexScreener
      const res = await fetchWithTimeout(
        `https://api.dexscreener.com/latest/dex/tokens/${pos.mint}`,
        {},
        8000,
      );
      if (!res.ok) continue;
      const data = await res.json();
      const pair = data.pairs?.filter(p => p.chainId === 'solana')
        .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      if (!pair?.priceUsd) continue;

      const currentPrice = Number(pair.priceUsd);
      const changePct = ((currentPrice - pos.entry_price_usd) / pos.entry_price_usd) * 100;
      const changePctStr = `${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%`;

      let reason = null;
      if (changePct <= -stopLoss) reason = `stop_loss (${changePctStr} from entry)`;
      else if (changePct >= takeProfit) reason = `take_profit (${changePctStr} from entry)`;

      if (reason) {
        try {
          const sellResult = await executeSell({
            mint: pos.mint,
            amountTokenRaw: pos.out_amount_raw,
            decimals: pos.decimals,
            positionId: pos.id,
            reason,
            config_path,
          });
          actions.push({
            type: reason.startsWith('stop') ? 'STOP_LOSS' : 'TAKE_PROFIT',
            symbol: pos.symbol,
            change_pct: changePctStr,
            ...sellResult,
          });
        } catch (err) {
          actions.push({ type: 'SELL_ERROR', symbol: pos.symbol, error: err.message });
        }
      }
    } catch {
      // Skip this position if price fetch fails
    }
  }

  return { actions };
}

// ── Safety gate ───────────────────────────────────────────────────────────────
export function checkCircuitBreaker(cfg) {
  const limit = cfg.trade?.circuit_breaker_sol ?? 1;
  const closed = (cfg.positions || []).filter(p => p.status === 'closed' && p.sol_received != null);
  const totalSpent = closed.reduce((s, p) => s + (p.sol_spent || 0), 0);
  const totalReceived = closed.reduce((s, p) => s + (p.sol_received || 0), 0);
  const totalLoss = totalSpent - totalReceived;
  if (totalLoss > limit) {
    throw new Error(`Circuit breaker: total loss ${totalLoss.toFixed(3)} SOL exceeds limit of ${limit} SOL`);
  }
}

export function tradeDefaults() {
  return {
    max_sol_per_trade: 0.1,
    slippage_bps: 300,
    min_liquidity_usd: 10000,
    min_market_cap_usd: 50000,
    stop_loss_pct: 50,
    take_profit_pct: 300,
    max_open_positions: 5,
    circuit_breaker_sol: 1,
  };
}
