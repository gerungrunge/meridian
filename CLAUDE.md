# Meridian — CLAUDE.md

Autonomous DLMM liquidity provider agent for Meteora pools on Solana.

---

## Architecture Overview

```
index.js            Main entry: REPL + cron orchestration + Telegram bot polling
agent.js            ReAct loop (OpenRouter/OpenAI-compatible): LLM → tool call → repeat
config.js           Runtime config from user-config.json + .env; exposes config object
prompt.js           Builds system prompt per agent role (SCREENER / MANAGER / GENERAL)
state.js            Position registry (state.json): tracks bin ranges, OOR timestamps, notes
lessons.js          Learning engine: records closed-position perf, derives lessons, evolves thresholds
pool-memory.js      Per-pool deploy history + snapshots (pool-memory.json)
strategy-library.js Saved LP strategies (strategy-library.json)
briefing.js         Daily Telegram briefing (HTML)
telegram.js         Telegram bot: polling, notifications (deploy/close/swap/OOR)
hive-mind.js        Optional collective intelligence server sync
smart-wallets.js    KOL/alpha wallet tracker (smart-wallets.json)
token-blacklist.js  Permanent token blacklist (token-blacklist.json)
chart-indicators.js Chart indicator confirmation (RSI, Bollinger, Supertrend, Fibonacci) via Agent Meridian API
logger.js           Daily-rotating log files + action audit trail

tools/
  definitions.js    Tool schemas in OpenAI format (what LLM sees)
  executor.js       Tool dispatch: name → fn, safety checks, pre/post hooks
  dlmm.js           Meteora DLMM SDK wrapper (deploy, close, claim, positions, PnL)
  screening.js      Pool discovery from Meteora API
  wallet.js         SOL/token balances (Helius) + Jupiter swap
  token.js          Token info/holders/narrative (Jupiter API)
  study.js          Top LPer study via LPAgent (routed through Agent Meridian relay)
```

---

## Agent Roles & Tool Access

Three agent roles filter which tools the LLM can call:

| Role | Purpose | Key Tools |
|------|---------|-----------|
| `SCREENER` | Find and deploy new positions | deploy_position, get_top_candidates, get_token_holders, check_smart_wallets_on_pool |
| `MANAGER` | Manage open positions | close_position, claim_fees, swap_token, get_position_pnl, set_position_note |
| `GENERAL` | Chat / manual commands | All tools |

Sets defined in `agent.js:6-7`. If you add a tool, also add it to the relevant set(s).

---

## Windows Shell Usage

- **User Environment**: Microsoft Windows / PowerShell
- **Command Separator**: Use `;` (semicolon) instead of `&&`.
- **Path Separator**: Use `\` for local system commands.
- **Rule File**: See `.agent/rules/windows.md` for details.

---

## Adding a New Tool

1. **`tools/definitions.js`** — Add OpenAI-format schema object to the `tools` array
2. **`tools/executor.js`** — Add `tool_name: functionImpl` to `toolMap`
3. **`agent.js`** — Add tool name to `MANAGER_TOOLS` and/or `SCREENER_TOOLS` if role-restricted
4. If the tool writes on-chain state, add it to `WRITE_TOOLS` in executor.js for safety checks

---

## Config System

`config.js` loads `user-config.json` at startup. Runtime mutations go through `update_config` tool (executor.js) which:
- Updates the live `config` object immediately
- Persists to `user-config.json`
- Restarts cron jobs if intervals changed

**Valid config keys and their sections:**

| Key | Section | Default |
|-----|---------|---------|
| minFeeActiveTvlRatio | screening | 0.05 |
| maxVolatility | screening | 15.0 |
| minTvl / maxTvl | screening | 10k / 150k |
| minVolume | screening | 500 |
| minOrganic | screening | 60 |
| minHolders | screening | 500 |
| minMcap / maxMcap | screening | 150k / 10M |
| minBinStep / maxBinStep | screening | 80 / 125 |
| timeframe | screening | "5m" |
| category | screening | "trending" |
| minTokenFeesSol | screening | 30 |
| maxBundlersPct | screening | 30 |
| maxTop10Pct | screening | 60 |
| blockedLaunchpads | screening | [] |
| deployAmountSol | management | 0.5 |
| maxDeployAmount | risk | 50 |
| maxPositions | risk | 3 |
| gasReserve | management | 0.2 |
| positionSizePct | management | 0.35 |
| minSolToOpen | management | 0.55 |
| outOfRangeWaitMinutes | management | 30 |
| managementIntervalMin | schedule | 10 |
| screeningIntervalMin | schedule | 30 |
| managementModel / screeningModel / generalModel | llm | nousresearch/hermes-3-llama-3.1-405b |

**`computeDeployAmount(walletSol)`** — scales position size with wallet balance (compounding). Formula: `clamp(deployable × positionSizePct, floor=deployAmountSol, ceil=maxDeployAmount)`.

---

## Strict Profit Management (Deterministic Rules)

Meridian enforces strict, non-negotiable exit rules that bypass the LLM manager to ensure safety and lock in profits:
1. **Tiered Take-Profit**:
   - `feeYieldEvalPct` (3%): Evaluate exit. Closes if volume is declining.
   - `feeYieldClosePct` (5%): Immediate close. No exceptions.
   - `feeYieldEmergencyPct` (8%): Emergency close.
2. **IL Protection (`ilPriceMovePct`)**: If price moves > 15% from entry bin, calculate IL. If IL exceeds collected fees, close immediately.
3. **Volume Decay Detection**:
   - `volumeDecayAlertPct` (40%): Triggers high alert.
   - `volumeDecayClosePct` (60%): Closes position immediately due to volume collapse.
4. **Time-Based Stop**: Closes if open > `deadPoolMaxMinutes` (default 4h) with fee yield < `deadPoolMinYieldPct` (default 1%).

These run in `getDeterministicCloseRule` and `updatePnlAndCheckExits`.

---

## Position Lifecycle

1. **Deploy**: `deploy_position` → executor safety checks → `trackPosition()` in state.js → Telegram notify
2. **Monitor**: management cron → `getMyPositions()` → `getPositionPnl()` → OOR detection → pool-memory snapshots
3. **Close**: `close_position` → `recordPerformance()` in lessons.js → auto-swap base token to SOL → `sweepDust()` (cleans residual SPL dust) → Telegram notify
4. **Learn**: `evolveThresholds()` runs on performance data → updates config.screening → persists to user-config.json

### Dust Sweep (wallet.js)

`sweepDust({ min_usd, slippage_bps, skip_mints })` — walks all SPL tokens in the wallet, skips SOL/USDC/USDT and any mint passed in `skip_mints` (typically active LP base mints), then swaps each remaining token above `min_usd` to SOL. Per-token try/catch so a single failure doesn't block the rest. Runs automatically after `close_position` and `claim_fees` when `dustSweepEnabled: true`. Also exposed as the `sweep_dust` tool for manual MANAGER calls.

Config: `dustSweepEnabled` (default true), `dustSweepMinUsd` (default 0.05), `dustSweepSlippageBps` (default 500 = 5% — generous to handle thin-liquidity dust).

---

## Screener Safety Checks (executor.js)

Before `deploy_position` executes:
- `bin_step` must be within `[minBinStep, maxBinStep]`
- Position count must be below `maxPositions` (force-fresh scan, no cache)
- No duplicate pool allowed (same pool_address)
- No duplicate base token allowed (same base_mint in another pool)
- Same pool 24h cap: `countRecentDeploys(pool, 24) < maxDeploysPerPool24h` (default 2; set 0/null to disable). Blocks trend-chasing — repeated redeploys on the same pool within 24h.
- If `amount_x > 0`: strip `amount_y` and `amount_sol` (tokenX-only deploy — no SOL needed)
- SOL balance must cover `amount_y + gasReserve` (skipped for tokenX-only)
- `blockedLaunchpads` enforced in `getTopCandidates()` before LLM sees candidates

---

## bins_below Calculation (SCREENER)

Linear formula based on pool volatility (set in screener prompt, `index.js`):

```
bins_below = round(35 + (volatility / 5) * 34), clamped to [35, 69]
```

- Low volatility (0) → 35 bins
- High volatility (5+) → 69 bins
- Any value in between is valid (continuous, not tiered)

---

## Telegram Commands

Handled directly in `index.js` (bypass LLM):

| Command | Action |
|---------|--------|
| `/positions` | List open positions with progress bar |
| `/close <n>` | Close position by list index |
| `/set <n> <note>` | Set note on position by list index |

Progress bar format: `[████████░░░░░░░░░░░░] 40%` (no bin numbers, no arrows)

---

## Race Condition: Double Deploy

`_screeningLastTriggered` in index.js prevents concurrent screener invocations. Management cycle sets this before triggering screener. Also, `deploy_position` safety check uses `force: true` on `getMyPositions()` for a fresh count.

---

## Bundler Detection (token.js)

Two signals used in `getTokenHolders()`:
- `common_funder` — multiple wallets funded by same source
- `funded_same_window` — multiple wallets funded in same time window

**Thresholds in config**: `maxBundlersPct` (default 30%), `maxTop10Pct` (default 60%)
Jupiter audit API: `botHoldersPercentage` (5–25% is normal for legitimate tokens)

---

## Base Fee Calculation (dlmm.js)

Read from pool object at deploy time:
```js
const baseFactor = pool.lbPair.parameters?.baseFactor ?? 0;
const actualBaseFee = baseFactor > 0
  ? parseFloat((baseFactor * actualBinStep / 1e6 * 100).toFixed(4))
  : null;
```

---

## Model Configuration

- Default model: `process.env.LLM_MODEL` or `nousresearch/hermes-3-llama-3.1-405b`
- Fallback on 502/503/529: `stepfun/step-3.5-flash:free` (2nd attempt), then retry
- Per-role models: `managementModel`, `screeningModel`, `generalModel` in user-config.json
- LM Studio: set `LLM_BASE_URL=http://localhost:1234/v1` and `LLM_API_KEY=lm-studio`
- `maxOutputTokens` minimum: 2048 (free models may have lower limits causing empty responses)

---

## Lessons System

`lessons.js` records closed position performance and auto-derives lessons. Key points:
- `getLessonsForPrompt({ agentType })` — injects relevant lessons into system prompt
- `evolveThresholds()` — adjusts screening thresholds based on winners vs losers
- Performance recorded via `recordPerformance()` called from executor.js after `close_position`
- **Data dependency**: `evolveThresholds()` reads `volatility`, `fee_tvl_ratio`, `organic_score` from `recordPerformance()` records. These must be present at deploy time (via `trackPosition()` args). If LLM forgets to pass them when calling `deploy_position`, `dlmm.js:deployPosition` falls back to enriching from `getPoolDetail()` so the learning loop stays alive.

---

## Hive Mind (hive-mind.js)

Optional feature. Enabled by setting `HIVE_MIND_URL` and `HIVE_MIND_API_KEY` in `.env`.
Syncs lessons/deploys to a shared server, queries consensus patterns.
Not required for normal operation.

---

## Agent Meridian Relay (LPAgent)

PnL, Top LP, and Study Top LP data is sourced from LPAgent, routed for free through Agent Meridian. No LPAgent API key needed on your side.

**Config in `user-config.json`:**

```json
{
  "publicApiKey": "bWVyaWRpYW4taXMtdGhlLWJlc3QtYWdlbnRz",
  "agentMeridianApiUrl": "https://api.agentmeridian.xyz/api",
  "lpAgentRelayEnabled": true
}
```

**Current data flow:**
- PnL → LPAgent via Agent Meridian
- Top LP → LPAgent via Agent Meridian
- Study Top LP → LPAgent via Agent Meridian
- Open positions / zap-out can use Agent Meridian relay
- Deploy still uses local SDK path

**Privacy note:** Agent Meridian server does not store your data. It only bridges your agent to the LPAgent API.

---

## Chart Indicators (chart-indicators.js)

Optional confirmation logic that fetches RSI, Bollinger Bands, Supertrend, and Fibonacci data from the Agent Meridian API. Used as entry/exit timing confirmation — not a full strategy replacement.

**Config in `user-config.json`:**

```json
{
  "agentMeridianApiUrl": "https://api.agentmeridian.xyz/api",
  "chartIndicators": {
    "enabled": true,
    "entryPreset": "supertrend_break",
    "exitPreset": "supertrend_break",
    "rsiLength": 2,
    "intervals": ["5_MINUTE"],
    "rsiOversold": 30,
    "rsiOverbought": 80
  }
}
```

**Available presets:** `supertrend_break`, `rsi_reversal`, `bollinger_reversion`, `rsi_plus_supertrend`, `supertrend_or_rsi`, `bb_plus_rsi`, `fibo_reclaim`, `fibo_reject`

**Behavioral notes:**
- If indicator data is unavailable, agent falls back to old behavior automatically
- Entry confirmation: added as `chart_indicators` line in screening candidate blocks
- Exit confirmation: added as `chart_exit_signal` line in management action blocks
- Indicators are fetched in parallel alongside existing recon (smart wallets, narrative, token info)
- This is confirmation-only logic — hard rules (stop loss, trailing TP) always override

---

## Environment Variables

| Var | Required | Purpose |
|-----|----------|---------|
| `WALLET_PRIVATE_KEY` | Yes | Base58 or JSON array private key |
| `RPC_URL` | Yes | Solana RPC endpoint |
| `OPENROUTER_API_KEY` | Yes | LLM API key |
| `TELEGRAM_BOT_TOKEN` | No | Telegram notifications |
| `TELEGRAM_CHAT_ID` | No | Telegram chat target |
| `LLM_BASE_URL` | No | Override for local LLM (e.g. LM Studio) |
| `LLM_MODEL` | No | Override default model |
| `JUPITER_API_KEY` | Yes | Jupiter swap & price API key |
| `DRY_RUN` | No | Skip all on-chain transactions |
| `HIVE_MIND_URL` | No | Collective intelligence server |
| `HIVE_MIND_API_KEY` | No | Hive mind auth token |
| `HELIUS_API_KEY` | No | Enhanced wallet balance data |
| `LPAGENT_API_KEY` | No | Direct LPAgent access (not needed when `lpAgentRelayEnabled: true`) |

---

## Known Issues / Tech Debt

- `get_wallet_positions` tool (dlmm.js) is in definitions.js but not in MANAGER_TOOLS or SCREENER_TOOLS — only available in GENERAL role.

