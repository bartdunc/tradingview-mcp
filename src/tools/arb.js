import { z } from 'zod';
import { jsonResult } from './_format.js';
import { scanFundingRates } from '../core/arb.js';

export function registerArbTools(server) {
  server.tool(
    'arb_scan_funding',
    'Scan Crypto.com perpetual futures for funding rate arbitrage opportunities. Returns instruments ranked by funding rate with projected daily/weekly/monthly/annual returns and cycle context. Strategy: long spot + short perp (or reverse for negative rates) = delta-neutral income.',
    {
      min_annual_pct: z.coerce.number().optional().describe(
        'Minimum annualised return % to include (default 0 = show all). Recommended: 10 to filter noise.'
      ),
      top_n: z.coerce.number().optional().describe(
        'Max instruments to return (default 20)'
      ),
      include_reverse: z.coerce.boolean().optional().describe(
        'Include negative funding rate opportunities (short spot + long perp). Default false.'
      ),
    },
    async ({ min_annual_pct = 0, top_n = 20, include_reverse = false }) => {
      try {
        return jsonResult(await scanFundingRates({ min_annual_pct, top_n, include_reverse }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    }
  );
}
