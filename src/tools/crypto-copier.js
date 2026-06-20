import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/crypto-copier.js';

export function registerCopierTools(server) {
  server.tool(
    'copier_find_traders',
    'Search BitGet copy trading leaderboard for profitable traders. Filters and ranks by composite score (win rate × 0.4 + ROI × 0.3 − max drawdown × 0.3). No API credentials required for this tool.',
    {
      productType: z.enum(['USDT-FUTURES', 'COIN-FUTURES']).optional()
        .describe('Futures product type (default: USDT-FUTURES)'),
      pageSize: z.coerce.number().min(1).max(100).optional()
        .describe('Number of results per page (default: 20, max: 100)'),
      pageNo: z.coerce.number().min(1).optional()
        .describe('Page number for pagination (default: 1)'),
      minWinRate: z.coerce.number().min(0).max(100).optional()
        .describe('Minimum win rate % to include (e.g., 55 filters to traders with 55%+ win rate)'),
      minRoi: z.coerce.number().optional()
        .describe('Minimum total ROI % to include (e.g., 20 filters to 20%+ return traders)'),
      maxDrawdown: z.coerce.number().min(0).max(100).optional()
        .describe('Maximum drawdown % allowed (e.g., 20 excludes traders with >20% max drawdown)'),
      sortBy: z.enum(['score', 'roi', 'winRate', 'followers']).optional()
        .describe('Sort order (default: score — composite metric; or roi, winRate, followers)'),
    },
    async (args) => {
      try { return jsonResult(await core.findTraders(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'copier_trader_profile',
    "Get a specific trader's detailed profile including trading pairs, performance stats, and configuration. Use traderId from copier_find_traders. No API credentials required.",
    {
      traderId: z.string().describe('Trader ID (from copier_find_traders results)'),
      productType: z.enum(['USDT-FUTURES', 'COIN-FUTURES']).optional()
        .describe('Product type (default: USDT-FUTURES)'),
    },
    async (args) => {
      try { return jsonResult(await core.getTraderProfile(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'copier_trader_positions',
    "See a trader's live open positions in real time — symbol, direction (long/short), size, entry price, current mark price, unrealised PnL. No API credentials required.",
    {
      traderId: z.string().describe('Trader ID (from copier_find_traders results)'),
      productType: z.enum(['USDT-FUTURES', 'COIN-FUTURES']).optional()
        .describe('Product type (default: USDT-FUTURES)'),
    },
    async (args) => {
      try { return jsonResult(await core.getTraderPositions(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'copier_follow',
    'Start copy trading a specific trader on BitGet futures. Requires BITGET_API_KEY, BITGET_SECRET_KEY, BITGET_PASSPHRASE in your .env file. Use fixed_amount mode to set a fixed USDT amount per trade.',
    {
      traderId: z.string().describe('Trader ID to follow (from copier_find_traders)'),
      productType: z.enum(['USDT-FUTURES', 'COIN-FUTURES']).optional()
        .describe('Product type (default: USDT-FUTURES)'),
      copyMode: z.enum(['fixed_amount', 'proportion']).optional()
        .describe('Copy mode: fixed_amount uses a set USDT per trade; proportion mirrors the trader\'s position size ratio (default: fixed_amount)'),
      copyAmount: z.coerce.number().positive().optional()
        .describe('USDT to allocate per copied trade (required for fixed_amount mode)'),
      maxCopyAmount: z.coerce.number().positive().optional()
        .describe('Maximum total USDT exposure across all positions from this trader'),
      stopLossPercent: z.coerce.number().min(0).max(100).optional()
        .describe('Auto stop-loss: close all copy positions if loss exceeds this % (e.g., 10)'),
      takeProfitPercent: z.coerce.number().min(0).max(100).optional()
        .describe('Auto take-profit: close all copy positions when profit reaches this % (e.g., 50)'),
    },
    async (args) => {
      try { return jsonResult(await core.followTrader(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'copier_unfollow',
    'Stop copy trading a specific trader. Note: existing positions opened by that trader remain open — close them manually or set a stop-loss before unfollowing. Requires BITGET credentials in .env.',
    {
      traderId: z.string().describe('Trader ID to unfollow'),
      productType: z.enum(['USDT-FUTURES', 'COIN-FUTURES']).optional()
        .describe('Product type (default: USDT-FUTURES)'),
    },
    async (args) => {
      try { return jsonResult(await core.unfollowTrader(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'copier_status',
    'Check your copy trading status: list of traders you are currently following, your per-trader ROI, profit, copy amount, and mode. Requires BITGET credentials in .env.',
    {
      productType: z.enum(['USDT-FUTURES', 'COIN-FUTURES']).optional()
        .describe('Product type (default: USDT-FUTURES)'),
    },
    async (args) => {
      try { return jsonResult(await core.getCopyStatus(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'copier_my_positions',
    'View your currently open copy trading positions — optionally filtered to a specific followed trader. Shows symbol, side, size, entry/mark price, and unrealised PnL. Requires BITGET credentials in .env.',
    {
      traderId: z.string().optional()
        .describe('Filter by a specific trader ID (optional — omit to see all copy positions)'),
      productType: z.enum(['USDT-FUTURES', 'COIN-FUTURES']).optional()
        .describe('Product type (default: USDT-FUTURES)'),
    },
    async (args) => {
      try { return jsonResult(await core.getMyPositions(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );
}
