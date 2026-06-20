/**
 * Telegram bot for the Solana smart-money wallet sniper.
 *
 * Setup:
 *  1. Create a bot with @BotFather on Telegram → copy the token
 *  2. Run: sniper_set_telegram in Claude  (or edit sniper.json manually)
 *  3. Message your new bot once, then run:
 *       curl https://api.telegram.org/bot<TOKEN>/getUpdates
 *     Copy the chat.id from the response → sniper_set_telegram again with chat_id
 *  4. Start: npm run telegram-bot
 *
 * Commands inside Telegram:
 *   /start | /help  — show commands
 *   /wallets        — list tracked wallets
 *   /scan           — trigger an immediate scan
 *   /status         — show current config
 *   /add <address> [label]  — add a wallet
 *   /remove <address>       — remove a wallet
 */

import {
  loadConfig,
  scan,
  listWallets,
  addWallet,
  removeWallet,
  DEFAULT_CONFIG_PATH,
} from './core/sniper.js';

const TG = (token) => `https://api.telegram.org/bot${token}`;

let updateOffset = 0;
let isScanning = false;

// ── Formatting ────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtUsd(n) {
  if (n == null) return 'N/A';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtTokenAmount(raw, decimals) {
  if (raw == null || decimals == null) return null;
  const n = Number(raw) / Math.pow(10, decimals);
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatAlert(alert) {
  if (alert.error) {
    return `⚠️ <b>Error</b> — ${esc(alert.wallet_label)}\n${esc(alert.error)}`;
  }

  if (alert.action === 'ACTIVITY') {
    return (
      `📡 <b>ACTIVITY</b> — ${esc(alert.wallet_label)}\n` +
      `${alert.new_tx_count} new transaction${alert.new_tx_count !== 1 ? 's' : ''}\n` +
      `<i>Add a Helius API key for swap details</i>`
    );
  }

  const emoji = alert.action === 'BUY' ? '🟢' : '🔴';
  const t = alert.token;
  let msg = `${emoji} <b>${alert.action}</b> — ${esc(alert.wallet_label)}\n`;

  if (t) {
    msg += `\n<b>Token:</b> ${esc(t.symbol)} <i>${esc(t.name)}</i>\n`;
    const amount = fmtTokenAmount(alert.token_amount, alert.decimals);
    if (amount) msg += `<b>Amount:</b> ${esc(amount)} ${esc(t.symbol)}\n`;
    if (t.price_usd != null) {
      const p = Number(t.price_usd);
      msg += `<b>Price:</b> $${p < 0.01 ? p.toPrecision(3) : p.toFixed(4)}\n`;
    }
    if (t.price_change_24h != null) {
      const sign = t.price_change_24h > 0 ? '+' : '';
      msg += `<b>24h:</b> ${sign}${t.price_change_24h.toFixed(1)}%\n`;
    }
    if (t.market_cap) msg += `<b>MC:</b> ${fmtUsd(t.market_cap)}\n`;
    if (t.liquidity_usd) msg += `<b>Liq:</b> ${fmtUsd(t.liquidity_usd)}\n`;
    if (t.volume_24h) msg += `<b>Vol:</b> ${fmtUsd(t.volume_24h)}\n`;
    msg += `<b>DEX:</b> ${esc(t.dex || 'unknown')}\n`;

    const links = [];
    if (t.dexscreener_url) links.push(`<a href="${t.dexscreener_url}">📊 Chart</a>`);
    if (alert.signature) links.push(`<a href="https://solscan.io/tx/${alert.signature}">🔗 Tx</a>`);
    if (links.length) msg += `\n${links.join('  ')}`;
  } else {
    msg += `\n<b>Mint:</b> <code>${esc(alert.mint)}</code>\n<i>Token data unavailable on DexScreener</i>`;
    if (alert.signature) msg += `\n<a href="https://solscan.io/tx/${alert.signature}">🔗 Tx</a>`;
  }

  return msg;
}

// ── Telegram API helpers ──────────────────────────────────────────────────────

async function tgPost(token, method, body = {}) {
  try {
    const res = await fetch(`${TG(token)}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return res.json();
  } catch (err) {
    console.error(`[telegram] ${method} failed:`, err.message);
    return { ok: false };
  }
}

async function send(token, chatId, text) {
  return tgPost(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

async function fetchUpdates(token) {
  try {
    const res = await fetch(
      `${TG(token)}/getUpdates?offset=${updateOffset}&timeout=25`,
      { signal: AbortSignal.timeout(35000) },
    );
    const data = await res.json();
    return data.ok ? data.result : [];
  } catch {
    return [];
  }
}

// ── Command handler ───────────────────────────────────────────────────────────

async function handleCommand(token, chatId, text) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase().replace(/@.*$/, ''); // strip @botname suffix
  const args = parts.slice(1);

  if (cmd === '/start' || cmd === '/help') {
    return send(token, chatId,
      `🎯 <b>Wallet Sniper</b>\n\n` +
      `/wallets — list tracked wallets\n` +
      `/scan — scan now for new swaps\n` +
      `/status — show config\n` +
      `/add &lt;address&gt; [label] — add wallet\n` +
      `/remove &lt;address&gt; — remove wallet\n` +
      `/help — show this`,
    );
  }

  if (cmd === '/wallets') {
    const { wallets } = listWallets({ config_path: DEFAULT_CONFIG_PATH });
    if (!wallets.length) return send(token, chatId, 'No wallets tracked yet.\nUse /add &lt;address&gt; &lt;label&gt;');
    const list = wallets.map((w, i) =>
      `${i + 1}. <b>${esc(w.label)}</b>\n   <code>${w.address}</code>`,
    ).join('\n\n');
    return send(token, chatId, `<b>Tracked Wallets (${wallets.length})</b>\n\n${list}`);
  }

  if (cmd === '/status') {
    const cfg = loadConfig(DEFAULT_CONFIG_PATH);
    return send(token, chatId,
      `<b>Sniper Status</b>\n\n` +
      `Wallets: ${cfg.wallets.length}\n` +
      `Helius API: ${cfg.api_key ? '✅ set' : '❌ not set'}\n` +
      `Auto-snap: ${cfg.auto_snap ? '✅' : '❌'}\n` +
      `Poll interval: ${(cfg.poll_interval_ms || 30000) / 1000}s`,
    );
  }

  if (cmd === '/scan') {
    if (isScanning) return send(token, chatId, '⏳ Scan already running…');
    isScanning = true;
    await send(token, chatId, '🔍 Scanning wallets…');
    try {
      const result = await scan({ config_path: DEFAULT_CONFIG_PATH });
      if (!result.alerts.length) {
        return send(token, chatId, `✅ No new activity (${result.wallets_scanned} wallets checked)`);
      }
      for (const alert of result.alerts) {
        await send(token, chatId, formatAlert(alert));
      }
    } catch (err) {
      await send(token, chatId, `❌ Scan error: ${esc(err.message)}`);
    } finally {
      isScanning = false;
    }
    return;
  }

  if (cmd === '/add') {
    const address = args[0];
    const label = args.slice(1).join(' ') || undefined;
    if (!address) return send(token, chatId, 'Usage: /add &lt;address&gt; [label]');
    const result = addWallet({ address, label, config_path: DEFAULT_CONFIG_PATH });
    return send(token, chatId,
      result.success
        ? `✅ Added <b>${esc(result.wallet.label)}</b>\n<code>${address}</code>`
        : `❌ ${esc(result.error)}`,
    );
  }

  if (cmd === '/remove') {
    const address = args[0];
    if (!address) return send(token, chatId, 'Usage: /remove &lt;address&gt;');
    const result = removeWallet({ address, config_path: DEFAULT_CONFIG_PATH });
    return send(token, chatId,
      result.success
        ? `✅ Removed <code>${esc(address.slice(0, 8))}…</code>`
        : `❌ ${esc(result.error)}`,
    );
  }
}

// ── Main loops ────────────────────────────────────────────────────────────────

async function commandLoop(token) {
  while (true) {
    const updates = await fetchUpdates(token);
    for (const update of updates) {
      updateOffset = update.update_id + 1;
      const msg = update.message;
      if (msg?.text?.startsWith('/')) {
        handleCommand(token, String(msg.chat.id), msg.text).catch(console.error);
      }
    }
  }
}

async function scanLoop(token, chatId, intervalMs) {
  while (true) {
    await new Promise(r => setTimeout(r, intervalMs));
    if (isScanning) continue;
    isScanning = true;
    try {
      const result = await scan({ config_path: DEFAULT_CONFIG_PATH });
      for (const alert of result.alerts) {
        await send(token, chatId, formatAlert(alert));
      }
      if (result.alerts.length) {
        console.log(`[scan] ${result.alerts.length} alert(s) sent`);
      }
    } catch (err) {
      console.error('[scan error]', err.message);
    } finally {
      isScanning = false;
    }
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────

const cfg = loadConfig(DEFAULT_CONFIG_PATH);

if (!cfg.telegram_token) {
  console.error('❌  telegram_token not set in sniper.json');
  console.error('   Use sniper_set_telegram in Claude, or edit sniper.json directly.');
  process.exit(1);
}
if (!cfg.telegram_chat_id) {
  console.error('❌  telegram_chat_id not set in sniper.json');
  console.error('   Message your bot once on Telegram, then run:');
  console.error(`   curl "${TG(cfg.telegram_token)}/getUpdates"`);
  console.error('   Copy chat.id from the result and set it with sniper_set_telegram.');
  process.exit(1);
}

const intervalMs = cfg.poll_interval_ms || 30000;
const { wallets } = listWallets({ config_path: DEFAULT_CONFIG_PATH });

console.log('✅  Wallet Sniper bot started');
console.log(`   Wallets : ${wallets.length}`);
console.log(`   Interval: ${intervalMs / 1000}s`);
console.log(`   Helius  : ${cfg.api_key ? 'configured' : 'NOT SET (basic mode)'}`);

await send(cfg.telegram_token, cfg.telegram_chat_id,
  `🎯 <b>Wallet Sniper Online</b>\n\n` +
  `Tracking <b>${wallets.length}</b> wallet${wallets.length !== 1 ? 's' : ''}\n` +
  `Scan every <b>${intervalMs / 1000}s</b>\n\n` +
  `Send /help for commands`,
);

await Promise.all([
  commandLoop(cfg.telegram_token),
  scanLoop(cfg.telegram_token, cfg.telegram_chat_id, intervalMs),
]);
