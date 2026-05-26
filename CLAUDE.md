# TradingView MCP — Claude Instructions

MCP bridge + `tv` CLI that reads and controls a live TradingView Desktop chart via the Chrome DevTools Protocol on `localhost:9222`. **81 MCP tools** exposed; the same core logic is also reachable from the terminal as `tv <command>`.

```
Claude Code ↔ MCP Server (stdio) ↔ CDP (port 9222) ↔ TradingView Desktop (Electron)
                                                      │
              src/server.js  ─►  src/tools/*.js  ─►  src/core/*.js  ─►  src/connection.js
              src/cli/index.js ─► src/cli/commands/*.js ─► (same core/*.js)
```

There is no separate TradingView API. Every tool ultimately runs `Runtime.evaluate` against TradingView's in-page JS objects (mainly `window.TradingViewApi._activeChartWidgetWV.value()`). Tools fail when TV isn't open with `--remote-debugging-port=9222`.

---

## Project Layout

| Path | What's in it |
|------|--------------|
| `src/server.js` | MCP entry — registers all tool groups, prints stderr disclaimer, opens stdio transport |
| `src/connection.js` | CDP client (singleton), retry/backoff, `evaluate()` / `evaluateAsync()`, `KNOWN_PATHS` to TradingView internals |
| `src/core/*.js` | Pure logic. Each module exports plain async functions that **throw** on error. Shared by both MCP tools and the CLI. |
| `src/tools/*.js` | MCP tool registration — Zod schemas, descriptions, and a thin try/catch that wraps `core.*` and returns `jsonResult(...)`. |
| `src/tools/_format.js` | `jsonResult(obj, isError)` — the standard MCP content shape. Use it for every tool reply. |
| `src/cli/index.js`, `router.js` | Zero-dep CLI built on `node:util parseArgs`. Routes `tv <cmd> [<subcmd>] [--flags]` to handlers that call `core.*` and print JSON. |
| `src/cli/commands/*.js` | One file per command group (chart, pine, data, stream, …). |
| `scripts/pine_push.js`, `scripts/pine_pull.js` | Standalone CDP scripts: read/write `scripts/current.pine` ↔ Pine Editor. Used by the `pine-develop` skill loop. |
| `scripts/launch_tv_debug_*` | OS-specific launchers that start TV with the CDP flag. |
| `tests/e2e.test.js` | Live TV required. Touches all tool groups. |
| `tests/pine_analyze.test.js` | Pure unit tests for the static Pine analyzer. |
| `tests/cli.test.js` | Spawns `node src/cli/index.js`, checks help / exit codes / JSON shape. |
| `rules.json` (sample: `rules.example.json`) | User trading rules consumed by `morning_brief`. Path is validated — must live in project root or `~/.tradingview-mcp/`. |
| `skills/*/SKILL.md` | Self-contained Claude skills (chart-analysis, pine-develop, replay-practice, strategy-report, multi-symbol-scan). |
| `agents/performance-analyst.md` | Sonnet subagent for backtest review. |

Module count today: **15 tool modules → 81 `server.tool()` registrations**.

| Module | Tools |
|--------|------:|
| `health` | 4 (`tv_health_check`, `tv_discover`, `tv_ui_state`, `tv_launch`) |
| `chart` | 10 (state, set symbol/timeframe/type, manage_indicator, visible range, scroll_to_date, symbol_info, symbol_search) |
| `data` | 12 (OHLCV, indicator, strategy results/trades/equity, quote, depth, pine lines/labels/tables/boxes, study values) |
| `pine` | 12 (get/set source, compile, smart_compile, errors, save, console, new, open, list, analyze, check) |
| `ui` | 12 (click, open_panel, fullscreen, layout list/switch, keyboard, type_text, hover, scroll, mouse_click, find_element, evaluate) |
| `replay` | 6 (start, step, autoplay, stop, trade, status) |
| `drawing` | 5 (shape, list, clear, remove_one, properties) |
| `tab` | 4 (list, new, close, switch) |
| `pane` | 4 (list, set_layout, focus, set_symbol) |
| `alerts` | 3 (create, list, delete) |
| `morning` | 3 (`morning_brief`, `session_save`, `session_get`) |
| `indicators` | 2 (set_inputs, toggle_visibility) |
| `watchlist` | 2 (get, add) |
| `capture` | 1 (`capture_screenshot`) |
| `batch` | 1 (`batch_run`) |

---

## Tool-Selection Decision Tree

### "What's on my chart right now?"
1. `chart_get_state` → symbol, timeframe, chart type, list of indicators with entity IDs
2. `data_get_study_values` → current numeric values from all visible indicators
3. `quote_get` → latest price / OHLC / volume

### "What levels/lines/labels are showing?"
Custom Pine indicators draw with `line.new()`, `label.new()`, `table.new()`, `box.new()`. They're invisible to the normal data tools. Use:
1. `data_get_pine_lines` → horizontal levels (deduplicated, sorted high→low)
2. `data_get_pine_labels` → text annotations with prices ("PDH 24550")
3. `data_get_pine_tables` → table data as rows (session-stats dashboards)
4. `data_get_pine_boxes` → price zones `{ high, low }`

Always pass `study_filter: "..."` when you know which indicator you want.

### "Give me price data"
- `data_get_ohlcv` with `summary: true` → compact stats + last 5 bars
- `data_get_ohlcv` without summary → all bars (cap via `count`; default 100, max 500)
- `quote_get` → single-tick snapshot

### "Daily session bias" (the morning-brief workflow)
1. `morning_brief` → scans `rules.json` watchlist, sets each symbol on the chart, reads indicators + quote, restores the chart, and returns structured data + the bias-criteria block
2. **Claude** applies the criteria itself and emits the one-line-per-symbol bias
3. `session_save` with the printed brief → `~/.tradingview-mcp/sessions/YYYY-MM-DD.json`
4. Next day: `session_get` returns today's, or falls back to yesterday's

`rules.json` is loaded from (in order) `rules_path` arg → `<project>/rules.json` → `~/.tradingview-mcp/rules.json`. Paths outside those two roots are rejected. Date args must match `YYYY-MM-DD`.

### "Analyze my chart" (one-shot report)
`quote_get` → `data_get_study_values` → `data_get_pine_lines` → `data_get_pine_labels` → `data_get_pine_tables` (if present) → `data_get_ohlcv {summary:true}` → `capture_screenshot`.

### "Change the chart"
- `chart_set_symbol` (`BTCUSD`, `AAPL`, `ES1!`, `NYMEX:CL1!`)
- `chart_set_timeframe` (`1`, `5`, `15`, `60`, `D`, `W`, `M`)
- `chart_set_type` (number 0–9 or name: Candles, HeikinAshi, Line, Area, Renko, …)
- `chart_manage_indicator` (use **full** names: `"Relative Strength Index"`, not `"RSI"`)
- `chart_scroll_to_date` (ISO `2025-01-15` or unix seconds string)
- `chart_set_visible_range` (unix seconds, both ends)

### "Work on Pine Script"
Two paths exist — pick one and stick with it.

| Path | When |
|------|------|
| **In-process tools** (`pine_set_source` → `pine_smart_compile` → `pine_get_errors` → `pine_save`) | When iterating inside an MCP session and the script is small enough to send as a string. |
| **File-driven** (`scripts/pine_push.js` + `scripts/current.pine` + `pine_pull.js`) | When editing a long script — keep it on disk, push via the script, read errors back. Used by the `pine-develop` skill. |

Other Pine tools:
- `pine_get_source` — **avoid on large scripts** (200KB+). Only call when you need to edit.
- `pine_analyze` — offline static checks (array bounds, implicit bool casts, version header). No CDP needed.
- `pine_check` — TradingView server-side compile check (no chart needed).
- `pine_new`, `pine_open`, `pine_list_scripts`, `pine_get_console`.

### "Practice trading with replay"
`replay_start { date }` → `replay_step` / `replay_autoplay { speed }` → `replay_trade { action: "buy"/"sell"/"close" }` → `replay_status` → `replay_stop`.

### "Screen multiple symbols"
`batch_run { symbols, timeframes?, action: "screenshot" | "get_ohlcv" | "get_strategy_results", delay_ms?, ohlcv_count? }`.

### "Multi-pane layouts"
`pane_set_layout { layout: "s" | "2h" | "2v" | "2x2" | "4" | "6" | "8" }` → `pane_set_symbol { index, symbol }` → `pane_focus { index }`. `pane_list` to see current state.

### "Draw on the chart"
`draw_shape { shape: "horizontal_line"|"trend_line"|"rectangle"|"text", point, point2?, overrides?, text? }`. `draw_list` / `draw_remove_one { entity_id }` / `draw_clear`. `draw_get_properties` to read a drawing's geometry.

### "Manage alerts"
`alert_create { condition: "crossing"|"greater_than"|"less_than", price, message? }`, `alert_list`, `alert_delete { delete_all? }`.

### "Navigate the UI"
`ui_open_panel { panel: "pine-editor"|"strategy-tester"|"watchlist"|"alerts"|"trading", action }`, `ui_click { by: "aria-label"|"data-name"|"text"|"class-contains", value }`, `ui_find_element`, `ui_keyboard`, `ui_type_text`, `ui_hover`, `ui_scroll`, `ui_mouse_click`, `ui_fullscreen`, `layout_list` / `layout_switch`, `ui_evaluate` (raw JS escape hatch — last resort).

### "TradingView isn't running"
`tv_launch { port?, kill_existing? }` — auto-detects install on Mac/Win/Linux. Then `tv_health_check`.

### CLI (terminal mirror of every MCP tool)
```bash
tv status                          # health check
tv quote                           # current price
tv symbol BTCUSD                   # change symbol
tv ohlcv --summary                 # price summary
tv brief                           # morning_brief
tv session get | tv session save --brief "..."
tv pine compile                    # smart compile
tv pine analyze -f file.pine       # offline static check
tv pine check -f file.pine         # server-side compile check
tv pane layout 2x2
tv stream quote | jq '.close'      # JSONL stream
tv screenshot -r chart
```
Stream commands (`tv stream quote|bars|values|lines|labels|tables|all`) write JSONL forever and never resolve — they're for piping into other tools, not for MCP sessions.

---

## Context-Management Rules (read these before pulling data)

1. **Always pass `summary: true`** to `data_get_ohlcv` unless you need individual bars.
2. **Always pass `study_filter`** to pine graphics tools when you know which indicator you want.
3. **Never pass `verbose: true`** on pine tools unless the user explicitly asked for raw IDs/colors.
4. **Avoid `pine_get_source`** on complex scripts — can be 200KB+.
5. **Avoid `data_get_indicator`** on protected indicators — inputs come back as encoded blobs. Use `data_get_study_values` for live readings.
6. **Prefer `capture_screenshot`** (~300 bytes — returns a path, not the image) over pulling large datasets for visual context.
7. **Call `chart_get_state` once** at session start and reuse the entity IDs.
8. **Cap your bar counts**: 20 for a quick look, 100 for analysis, 500 only when needed.

### Output-size cheat sheet (compact mode)

| Tool | Typical |
|------|---------|
| `quote_get` | ~200 B |
| `data_get_study_values` | ~500 B |
| `data_get_pine_lines` (per study) | 1–3 KB |
| `data_get_pine_labels` (capped 50) | 2–5 KB |
| `data_get_pine_tables` | 1–4 KB |
| `data_get_pine_boxes` | 1–2 KB |
| `data_get_ohlcv {summary:true}` | ~500 B |
| `data_get_ohlcv` (100 bars) | ~8 KB |
| `capture_screenshot` | ~300 B (path only) |

---

## Tool Conventions

- Every tool reply is `{ success: true, ... }` or `{ success: false, error, hint? }`. The MCP wrappers in `src/tools/*.js` catch `core.*` throws and call `jsonResult(payload, isError)`.
- **Errors throw in `core/`, get formatted in `tools/`.** Don't return error objects from core; throw real `Error`s.
- Entity IDs from `chart_get_state` / `draw_list` are session-specific — do not cache across CDP sessions.
- Pine graphics tools only see studies that are **visible** on the chart. Hidden indicators return nothing.
- `chart_manage_indicator` requires **full TradingView names** (`"Moving Average Exponential"`, not `"EMA"`).
- Screenshots write into `screenshots/` with a timestamped filename and return the path. The directory is gitignored.
- OHLCV is capped at 500 bars; trades at 20 per request; pine labels at 50 per study (`max_labels` to override).
- Coercion: tool schemas use `z.coerce.number()` / `z.coerce.boolean()` so CLI/string inputs are accepted.
- The MCP server's `instructions` block (in `src/server.js`) is sent to the model on connection — it duplicates the rules above. Keep them in sync if you change one.

---

## CDP Internals (so you can reason when a tool breaks)

Known paths cached in `src/connection.js` `KNOWN_PATHS`:

| Name | Path |
|------|------|
| Chart API | `window.TradingViewApi._activeChartWidgetWV.value()` |
| Chart widget collection | `window.TradingViewApi._chartWidgetCollection` |
| Bottom widget bar | `window.TradingView.bottomWidgetBar` |
| Replay API | `window.TradingViewApi._replayApi` |
| Alert service | `window.TradingViewApi._alertService` |
| Main series bars | `<chartApi>._chartWidget.model().mainSeries().bars()` |
| Strategy study | `<chartApi>._chartWidget.model().model().dataSources()` |
| Layouts | `window.TradingViewApi.getSavedCharts` |
| Symbol search | `window.TradingViewApi.searchSymbols` |
| Pine REST | `https://pine-facade.tradingview.com/pine-facade` |

Pine drawings live deep under each study:
```
study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById
```
The path is fragile across TradingView Desktop versions — when a pine graphics tool stops working, check this chain first with `ui_evaluate`.

Connection lifecycle: `getClient()` returns a cached client after a `Runtime.evaluate("1")` liveness probe; reconnects with exponential backoff (500 ms → 30 s, 5 tries) if it fails. `findChartTarget()` picks the first CDP target whose URL matches `/tradingview\.com\/chart/i`.

---

## Development Workflow

```bash
npm install
npm test               # tests/e2e.test.js + tests/pine_analyze.test.js — e2e needs TV running
npm run test:unit      # offline only (pine_analyze + cli) — safe in CI
npm run test:cli       # CLI tests only
npm run test:e2e       # E2E only (TV required)
npm start              # run MCP server over stdio (for manual MCP client testing)
tv status              # quick CDP health check; needs `npm link` first or use `npm run tv -- status`
```

`npm link` installs the `tv` binary globally (declared in `package.json` → `bin`).

### Adding a new MCP tool

1. **Write the logic in `src/core/<group>.js`** — pure async function that `throw`s on failure. Reuse `evaluate(...)` / `evaluateAsync(...)` from `connection.js`. Keep payloads compact by default; add a `verbose`/`summary` flag if you need both.
2. **Register the tool in `src/tools/<group>.js`** with `server.tool(name, description, zodSchema, async handler)`. Wrap the core call in `try { jsonResult(await core.fn(args)) } catch (err) { jsonResult({ success: false, error: err.message }, true) }`. Match the existing one-liner style — don't introduce abstractions.
3. **Mirror it in the CLI** — add a subcommand in `src/cli/commands/<group>.js` via `register(...)`. The handler returns a plain object; the router prints JSON.
4. **Update the MCP `instructions` block** in `src/server.js` if the tool changes the recommended decision tree, and **update this CLAUDE.md** if it adds a new workflow.
5. **Add an E2E test** in `tests/e2e.test.js` under the matching `describe(...)` block. Pure logic gets a unit test in `tests/<feature>.test.js`.

### Adding a new core module

If you're adding a whole new group (e.g. `news.js`):
- Export from `src/core/index.js` so it shows up under `tradingview-mcp/core`.
- Register in `src/server.js`: `import { registerNewsTools } from "./tools/news.js"; registerNewsTools(server);`.
- Add a CLI bootstrap line in `src/cli/index.js`.

### Pine Script dev loop (the file-driven path)

```bash
node scripts/pine_pull.js       # editor → scripts/current.pine
# edit scripts/current.pine in your editor
node scripts/pine_push.js       # scripts/current.pine → editor, click compile, print errors
```
`scripts/current.pine` is gitignored. `htf_short_scanner_READY.pine` at the repo root is a worked example (~38 KB).

### `morning_brief` development notes

- The tool **does not** generate the bias text itself — it returns structured data plus an `instruction` string. The model applies the criteria. This is intentional: bias logic stays in the model's reasoning, not in code.
- It saves and restores the original symbol + timeframe around the scan. If your tool changes the chart, do the same.
- `assertSafeRulesPath()` and `assertSafeDate()` (in `src/core/morning.js`) are the path-traversal and date-format guards. Reuse the same pattern for any new tool that touches the filesystem with user input.

---

## Skills and Subagents

The `skills/` directory holds self-contained `SKILL.md` workflows the agent can invoke. They map onto common multi-tool flows:

| Skill | Trigger |
|-------|---------|
| `chart-analysis` | "Analyze AAPL on the daily" |
| `pine-develop` | "Write me a Pine indicator that…" (uses the file-driven push/pull loop) |
| `replay-practice` | "Let me practice trading from March 1" |
| `strategy-report` | "Backtest report for this strategy" |
| `multi-symbol-scan` | "Compare ES/NQ/YM" |

`agents/performance-analyst.md` is a Sonnet subagent for deeper backtest analysis.

---

## Things That Will Bite You

- **`pine_get_source` on complex scripts is huge.** Don't call it speculatively.
- **`chart_manage_indicator` silently no-ops on a short name.** "RSI" looks fine in the response but no indicator is added — always pass the full name.
- **Pine graphics require the study to be visible.** A hidden but loaded study returns nothing from `data_get_pine_*`.
- **Stream commands never resolve.** Don't call them from MCP tools or expect a return value.
- **Replay trades are simulated only.** No real orders are placed — but `replay_trade` does mutate chart state, so users will see it.
- **`scalper-run.js`** is a standalone YouTube-demo script that talks to BitGet via `.env` credentials. It is **not** part of the MCP tool surface. `.env` is gitignored — never commit credentials.
- **Undocumented internals.** Every CDP path can change in a TradingView Desktop update. When a tool starts returning `null`, probe with `tv_discover` or `ui_evaluate` before assuming a logic bug.
