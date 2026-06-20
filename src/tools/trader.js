import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as trader from '../core/trader.js';
import { loadConfig, saveConfig, DEFAULT_CONFIG_PATH } from '../core/sniper.js';

const cfg = z.string().optional().describe('Path to sniper.json (default: project root)');

export function registerTraderTools(server) {
  server.tool(
    'trader_balance',
    'Check the SOL balance of the bot trading wallet. SOLANA_PRIVATE_KEY must be set in the environment.',
    { config_path: cfg },
    async ({ config_path }) => {
      try { return jsonResult(await trader.getBalance(config_path)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'trader_setup',
    'Configure auto-trade risk parameters: position size, slippage, liquidity/market-cap filters, stop-loss, take-profit, circuit breaker. Pass auto_trade=true to enable automatic copy-buying on every sniper_scan BUY detection.',
    {
      auto_trade: z.coerce.boolean().optional().describe('Enable automatic buy execution on detected swaps'),
      max_sol_per_trade: z.coerce.number().optional().describe('Max SOL to spend per trade (default 0.1)'),
      slippage_bps: z.coerce.number().optional().describe('Slippage tolerance in basis points (default 300 = 3%)'),
      min_liquidity_usd: z.coerce.number().optional().describe('Skip tokens with pool liquidity below this USD value (default 10000)'),
      min_market_cap_usd: z.coerce.number().optional().describe('Skip tokens with market cap below this USD value (default 50000)'),
      stop_loss_pct: z.coerce.number().optional().describe('Sell if token drops this % from entry price (default 50)'),
      take_profit_pct: z.coerce.number().optional().describe('Sell if token rises this % from entry price (default 300 = 3x)'),
      max_open_positions: z.coerce.number().optional().describe('Maximum simultaneous open positions (default 5)'),
      circuit_breaker_sol: z.coerce.number().optional().describe('Stop all trading if cumulative loss exceeds this many SOL (default 1)'),
      config_path: cfg,
    },
    async ({ auto_trade, config_path, ...tradeParams }) => {
      try {
        const cp = config_path || DEFAULT_CONFIG_PATH;
        const c = loadConfig(cp);
        if (auto_trade !== undefined) c.auto_trade = auto_trade;
        const validKeys = ['max_sol_per_trade', 'slippage_bps', 'min_liquidity_usd',
          'min_market_cap_usd', 'stop_loss_pct', 'take_profit_pct',
          'max_open_positions', 'circuit_breaker_sol'];
        for (const k of validKeys) {
          if (tradeParams[k] !== undefined) c.trade[k] = tradeParams[k];
        }
        saveConfig(c, cp);
        return jsonResult({
          success: true,
          auto_trade: c.auto_trade,
          trade: c.trade,
          note: 'Set SOLANA_PRIVATE_KEY in .env before enabling auto_trade',
        });
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    'trader_buy',
    'Manually execute a buy — swap SOL for a specific Solana token via Jupiter DEX. Useful for testing or acting on a manual signal. SOLANA_PRIVATE_KEY must be set.',
    {
      mint: z.string().describe('Solana token mint address to buy'),
      amount_sol: z.coerce.number().optional().describe('SOL to spend (default: max_sol_per_trade from config)'),
      config_path: cfg,
    },
    async ({ mint, amount_sol, config_path }) => {
      try {
        const cp = config_path || DEFAULT_CONFIG_PATH;
        const c = loadConfig(cp);
        const amountSol = amount_sol ?? (c.trade?.max_sol_per_trade ?? 0.1);
        // Resolve token info
        const { resolveToken } = await import('../core/sniper.js');
        const token = await resolveToken(mint);
        return jsonResult(await trader.executeBuy({ mint, amountSol, token, config_path: cp }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    'trader_positions',
    'List open or closed trading positions, including entry price, tokens received, and P&L status.',
    {
      status: z.enum(['open', 'closed', 'all']).optional().describe('Filter by status (default: open)'),
      config_path: cfg,
    },
    async ({ status, config_path }) => {
      try { return jsonResult(trader.listPositions({ status, config_path })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'trader_check_positions',
    'Check all open positions against current prices and execute stop-loss or take-profit sells where triggered. Called automatically by the Telegram bot every minute.',
    { config_path: cfg },
    async ({ config_path }) => {
      try { return jsonResult(await trader.checkPositions({ config_path })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );
}
