import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/sniper.js';

const cfg = z.string().optional().describe('Path to sniper.json (default: project root)');

export function registerSniperTools(server) {
  server.tool(
    'sniper_add_wallet',
    'Add a Solana wallet to the smart-money tracking list. Future sniper_scan calls will monitor this wallet for new swap activity.',
    {
      address: z.string().describe('Solana wallet address (base58)'),
      label: z.string().optional().describe('Human-readable name, e.g. "Alpha Whale 1"'),
      config_path: cfg,
    },
    async ({ address, label, config_path }) => {
      try { return jsonResult(core.addWallet({ address, label, config_path })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'sniper_remove_wallet',
    'Remove a Solana wallet from the tracking list.',
    {
      address: z.string().describe('Solana wallet address to remove'),
      config_path: cfg,
    },
    async ({ address, config_path }) => {
      try { return jsonResult(core.removeWallet({ address, config_path })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'sniper_list_wallets',
    'List all tracked Solana wallets and current sniper configuration.',
    { config_path: cfg },
    async ({ config_path }) => {
      try { return jsonResult(core.listWallets({ config_path })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'sniper_set_api_key',
    'Save a Helius API key for enhanced Solana swap parsing. Without this key, only raw transaction counts are visible. Get a free key at helius.xyz.',
    {
      api_key: z.string().describe('Helius API key'),
      config_path: cfg,
    },
    async ({ api_key, config_path }) => {
      try { return jsonResult(core.setApiKey({ api_key, config_path })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'sniper_configure',
    'Configure sniper behaviour. auto_snap=true automatically switches the TradingView chart to the token a tracked wallet just bought.',
    {
      auto_snap: z.coerce.boolean().optional().describe('Auto-switch TradingView chart when a BUY is detected'),
      config_path: cfg,
    },
    async ({ auto_snap, config_path }) => {
      try { return jsonResult(core.configure({ auto_snap, config_path })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'sniper_scan',
    'Scan all tracked wallets for new swap activity since the last scan. With a Helius API key returns full swap details (token bought/sold, amount, DexScreener data). Without one, returns only new transaction counts. If auto_snap is enabled and a BUY is found, the TradingView chart switches to that token automatically.',
    { config_path: cfg },
    async ({ config_path }) => {
      try { return jsonResult(await core.scan({ config_path })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'sniper_get_history',
    'Retrieve recent wallet activity alerts from the local history (last N entries from previous scans).',
    {
      limit: z.coerce.number().optional().describe('Max alerts to return (default 30)'),
      config_path: cfg,
    },
    async ({ limit, config_path }) => {
      try { return jsonResult(core.getHistory({ limit, config_path })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'sniper_snap_to_token',
    'Resolve a Solana token mint address via DexScreener and switch the TradingView chart to that token. Useful for immediately pulling up a chart after spotting a wallet buy.',
    {
      mint: z.string().describe('Solana SPL token mint address'),
      config_path: cfg,
    },
    async ({ mint, config_path }) => {
      try { return jsonResult(await core.snapToToken({ mint, config_path })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );
}
