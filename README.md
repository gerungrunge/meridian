# Meridian

**Autonomous Meteora DLMM liquidity management agent for Solana, powered by LLMs.**

Meridian runs continuous screening and management cycles, deploying capital into high-quality Meteora DLMM pools and closing positions based on live PnL, yield, and range data. It learns from every position it closes.

---

## What it does

- **Screens pools** — scans Meteora DLMM pools against configurable thresholds (fee/TVL ratio, organic score, holder count, market cap, bin step, etc.) to surface high-quality opportunities
- **Manages positions** — opens, monitors, and closes LP positions autonomously; decides to STAY, CLOSE, or REDEPLOY based on live PnL, yield, and range data
- **Claims fees** — tracks unclaimed fees per position and claims when thresholds are met
- **Learns from performance** — studies top LPers in target pools, saves structured lessons, and evolves screening thresholds based on closed position history
- **Agent Meridian relay** — routes open positions, PnL, top LP, study top LP, chart indicators, and discovery through the centralized Agent Meridian API
- **Chart indicators** — optional RSI, Bollinger Bands, Supertrend, and Fibonacci confirmation logic for entry/exit decisions (never overrides TP/SL/OOR/trailing exit)
- **Decision log** — records structured reasoning for every deploy, close, or skip decision
- **Telegram chat** — full agent chat via Telegram, plus cycle reports and out-of-range alerts sent automatically
- **Hive Mind** — opt-in collective intelligence: share lessons, outcomes, and thresholds with other Meridian agents

---

## How it works

Meridian runs a **ReAct agent loop** — each cycle the LLM reasons over live data, calls tools, and acts. Two specialized agents run on independent cron schedules:

| Agent | Default interval | Role |
|---|---|---|
| **Hunter Alpha** | Every 30 min | Pool screening — finds and deploys into the best candidate |
| **Healer Alpha** | Every 10 min | Position management — evaluates each open position and acts |

A third **health check** runs hourly to summarize portfolio state.

**Data sources used by the agents:**
- `@meteora-ag/dlmm` SDK — on-chain position data, active bin, deploy/close transactions
- Meteora DLMM PnL API — position yield, fee accrual, PnL
- Agent Meridian API — open positions, PnL relay, top LP analysis, chart indicators
- Pool screening API — fee/TVL ratios, volume, organic scores, holder counts
- Jupiter API — token audit, mcap, launchpad, price stats

Agents are powered via **OpenRouter** and can be swapped for any compatible model by changing `managementModel` / `screeningModel` in `user-config.json`.

---

## Requirements

- Node.js 18+
- [OpenRouter](https://openrouter.ai) API key
- Solana wallet (base58 private key)
- Solana RPC endpoint ([Helius](https://helius.xyz) recommended)
- Telegram bot token (optional, for notifications)

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/gerungrunge/meridian
cd meridian
npm install
```

### 2. Run the setup wizard

```bash
npm run setup
```

The wizard walks you through creating `.env` (API keys, wallet, RPC, Telegram) and `user-config.json` (risk preset, deploy size, thresholds, models). Takes about 2 minutes.

Or set up manually:

### 3. Create `.env`

```env
WALLET_PRIVATE_KEY=your_base58_private_key
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
OPENROUTER_API_KEY=sk-or-...
HELIUS_API_KEY=your_helius_key         # for wallet balance lookups
TELEGRAM_BOT_TOKEN=123456:ABC...       # optional — for notifications + chat
TELEGRAM_CHAT_ID=                      # auto-filled on first message
TELEGRAM_ALLOWED_USER_IDS=             # comma-separated user IDs for control
DRY_RUN=true                           # set false for live trading
```

> **Never** put your private key or API keys in `user-config.json` — use `.env` only.

### 4. Copy the example config

```bash
cp user-config.example.json user-config.json
```

See [Config reference](#config-reference) below.

### 5. Run

```bash
npm run dev    # dry run — no on-chain transactions
npm start      # live mode
```

On startup Meridian fetches your wallet balance, open positions, and the top pool candidates, then begins autonomous cycles immediately.

---

## Config reference

All fields are optional — defaults shown. Edit `user-config.json`.

### Risk limits

| Field | Default | Description |
|---|---|---|
| `maxPositions` | `3` | Maximum concurrent open positions |
| `maxDeployAmount` | `50` | Hard ceiling on deploy amount (SOL) |

### Pool screening

| Field | Default | Description |
|---|---|---|
| `minFeeActiveTvlRatio` | `0.05` | Minimum fee/active-TVL ratio (5%) |
| `minTvl` | `10000` | Minimum pool TVL in USD |
| `maxTvl` | `150000` | Maximum pool TVL in USD |
| `minOrganic` | `60` | Minimum organic score (0–100) |
| `minQuoteOrganic` | `60` | Minimum quote token organic score |
| `minHolders` | `500` | Minimum token holder count |
| `minMcap` | `150000` | Minimum market cap in USD |
| `maxMcap` | `10000000` | Maximum market cap in USD |
| `minBinStep` | `80` | Minimum bin step |
| `maxBinStep` | `125` | Maximum bin step |
| `timeframe` | `5m` | Candle timeframe used in screening |
| `category` | `trending` | Pool category filter for screening |
| `minTokenFeesSol` | `30` | Token priority+jito fees floor (filters bundled scams) |
| `maxBundlePct` | `30` | Max bundle holding % |
| `maxBotHoldersPct` | `30` | Max bot holder addresses % |
| `maxTop10Pct` | `60` | Max top 10 holders concentration |
| `minTokenAgeHours` | `null` | Minimum token age (null = no minimum) |
| `maxTokenAgeHours` | `null` | Maximum token age (null = no maximum) |
| `athFilterPct` | `null` | Filter by distance from ATH (e.g. `-20`) |
| `maxVolatility` | `15.0` | Max pool volatility ceiling |

### Position management

| Field | Default | Description |
|---|---|---|
| `deployAmountSol` | `0.5` | SOL to deploy per new position |
| `minSolToOpen` | `0.55` | Minimum wallet SOL balance before opening |
| `gasReserve` | `0.2` | SOL reserved for gas fees |
| `positionSizePct` | `0.35` | Fraction of deployable balance per position |
| `stopLossPct` | `-50` | Close position at this PnL % loss |
| `takeProfitPct` | `5` | Close position when PnL reaches this % |
| `trailingTakeProfit` | `true` | Enable trailing take-profit |
| `trailingTriggerPct` | `3` | Activate trailing at this PnL % |
| `trailingDropPct` | `1.5` | Close when PnL drops this % from peak |
| `outOfRangeWaitMinutes` | `30` | Minutes a position can be OOR before acting |
| `minAgeBeforeYieldCheck` | `60` | Minutes before low yield can trigger close |
| `solMode` | `false` | Report positions/PnL in SOL instead of USD |

### Tiered profit management

| Field | Default | Description |
|---|---|---|
| `feeYieldEvalPct` | `3` | Fee yield ≥ X% → evaluate exit |
| `feeYieldClosePct` | `5` | Fee yield ≥ X% → close immediately |
| `feeYieldEmergencyPct` | `8` | Fee yield ≥ X% → emergency close |
| `volumeDecayAlertPct` | `40` | Volume dropped X% from peak → alert |
| `volumeDecayClosePct` | `60` | Volume dropped X% from peak → close |
| `ilPriceMovePct` | `15` | Price moved X% from entry → check IL |
| `deadPoolMaxMinutes` | `240` | Close dead pools after 4 hours |
| `deadPoolMinYieldPct` | `1` | Fee yield below X% = dead pool |

### Strategy

| Field | Default | Description |
|---|---|---|
| `strategy` | `bid_ask` | Deploy strategy: `bid_ask`, `spot`, or `curve` |
| `binsBelow` | `69` | Number of bins below active bin |

### Scheduling

| Field | Default | Description |
|---|---|---|
| `managementIntervalMin` | `10` | Management agent cycle (minutes) |
| `screeningIntervalMin` | `30` | Screening agent cycle (minutes) |
| `healthCheckIntervalMin` | `60` | Health check interval (minutes) |

### LLM

| Field | Default | Description |
|---|---|---|
| `managementModel` | `nousresearch/hermes-3-llama-3.1-405b` | Model for position management |
| `screeningModel` | `nousresearch/hermes-3-llama-3.1-405b` | Model for pool screening |
| `generalModel` | `nousresearch/hermes-3-llama-3.1-405b` | Model for REPL chat |
| `temperature` | `0.373` | LLM temperature |
| `maxTokens` | `4096` | Max output tokens |
| `maxSteps` | `20` | Max agent reasoning steps |

### Chart indicators (optional)

| Field | Default | Description |
|---|---|---|
| `chartIndicators.enabled` | `false` | Enable chart indicator evaluation |
| `chartIndicators.entryPreset` | `null` | Entry preset (see presets below) |
| `chartIndicators.exitPreset` | `null` | Exit preset (see presets below) |
| `chartIndicators.intervals` | `["5_MINUTE"]` | Candle intervals to evaluate |
| `chartIndicators.rsiLength` | `14` | RSI period length |
| `chartIndicators.rsiOversold` | `30` | RSI oversold threshold |
| `chartIndicators.rsiOverbought` | `80` | RSI overbought threshold |

**Available indicator presets:**

| Preset | Entry condition | Exit condition |
|---|---|---|
| `supertrend_break` | Supertrend turns bullish | Supertrend turns bearish |
| `rsi_reversal` | RSI ≤ oversold | RSI ≥ overbought |
| `bollinger_reversion` | Price ≤ BB lower band | Price ≥ BB upper band |
| `rsi_plus_supertrend` | Both RSI + Supertrend confirm | Both confirm exit |
| `supertrend_or_rsi` | Either RSI or Supertrend confirm | Either confirms exit |
| `bb_plus_rsi` | Both BB + RSI confirm | Both confirm exit |
| `fibo_reclaim` | Price reclaims 0.618 fib level | Price loses fib level |
| `fibo_reject` | Price below fib resistance | Price reaches fib resistance |

> **Important:** Indicators are confirmation-only — they never override take-profit, stop-loss, out-of-range, or trailing exit logic.

### Environment variable overrides

These override `user-config.json` values and cannot be overwritten by self-tune or evolve:

```env
DEPLOY_AMOUNT_SOL=0.5
MAX_POSITIONS=3
MIN_SOL_TO_OPEN=0.55
MAX_DEPLOY_AMOUNT=50
GAS_RESERVE=0.2
POSITION_SIZE_PCT=0.35
STOP_LOSS_PCT=-50
TAKE_PROFIT_PCT=5
MANAGEMENT_INTERVAL_MIN=10
SCREENING_INTERVAL_MIN=30
```

---

## REPL commands

After startup, an interactive prompt is available. The prompt shows a live countdown to the next management and screening cycle.

```
[manage: 8m 12s | screen: 24m 3s]
>
```

| Command | Description |
|---|---|
| `1`, `2`, `3` ... | Deploy into that numbered pool from the current candidates list |
| `auto` | Let the agent pick the best pool and deploy automatically |
| `/status` | Refresh and display wallet balance and open positions |
| `/candidates` | Re-screen and display the current top pool candidates |
| `/learn` | Study top LPers across all current candidate pools and save lessons |
| `/learn <pool_address>` | Study top LPers from a specific pool address |
| `<wallet_address>` | Ask the agent to check any wallet's positions or a pool's top LPers |
| `/thresholds` | Show current screening thresholds and closed-position performance stats |
| `/evolve` | Trigger threshold evolution from performance data (requires 5+ closed positions) |
| `/stop` | Graceful shutdown |
| `<anything else>` | Free-form chat — ask the agent questions, request actions, analyze pools |

Free-form chat persists session history (last 10 exchanges), so you can have a continuous conversation: `"what do you think of pool #2?"`, `"close all positions"`, `"how much have we earned today?"`.

---

## Telegram

**Setup:**

1. Create a bot via [@BotFather](https://t.me/BotFather) and copy the token
2. Add `TELEGRAM_BOT_TOKEN=<token>` to your `.env`
3. Set the exact Telegram chat and allowed controller user IDs in `.env`

```env
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<target chat id>
TELEGRAM_ALLOWED_USER_IDS=<comma-separated Telegram user ids>
```

Security notes:
- If `TELEGRAM_CHAT_ID` is not set, inbound Telegram control is ignored.
- If the target chat is a group/supergroup and `TELEGRAM_ALLOWED_USER_IDS` is empty, inbound control is ignored.
- Notifications still go to the configured chat, but command/control is limited to the allowed user IDs.

**Notifications sent:**
- After every management cycle: full agent report (reasoning + decisions)
- After every screening cycle: full agent report (what it found, whether it deployed)
- When a position goes out of range past `outOfRangeWaitMinutes`
- On deploy: pair, amount, position address, tx hash
- On close: pair and PnL

You can also chat with the agent via Telegram using the same free-form interface as the REPL.

---

## How it learns

Meridian accumulates structured knowledge in `lessons.json` with two components:

### Lessons (`/learn`)

Running `/learn` triggers the agent to call `study_top_lpers` on each top candidate pool. It analyzes the on-chain behavior of the best-performing LPs in those pools — hold duration, entry/exit timing, scalping vs. holding patterns, win rates — and saves 4–8 concrete, actionable lessons. Cross-pool patterns are weighted more heavily since they generalize better.

Saved lessons are injected into subsequent agent cycles as part of the system context, improving decision quality over time.

### Threshold evolution (`/evolve`)

After at least 5 positions have been closed, `/evolve` analyzes the performance record (win rate, average PnL, fee yields) and adjusts the screening thresholds in `user-config.json` accordingly. Changes take effect immediately — no restart needed. The rationale for each change is printed to the console.

Use `/thresholds` to see current values alongside performance stats.

---

## Decision log

Every deploy, close, or skip action is recorded in `decision-log.json` with structured fields:

- **type** — `deploy`, `close`, `skip`, `note`
- **actor** — `HUNTER`, `HEALER`, or `GENERAL`
- **summary** — what happened
- **reason** — why the decision was made
- **risks** — risk factors considered
- **rejected** — alternatives that were passed over
- **metrics** — relevant PnL, fee, or pool data at decision time

The last 6 decisions are injected into subsequent agent prompts as context, helping the agent maintain consistency across cycles.

---

## Agent Meridian relay

Meridian routes the following through the Agent Meridian public API:

- **Open positions** — relay-fetched position data with Meteora SDK fallback
- **PnL** — position performance via relay
- **Top LP** — top liquidity providers for a pool
- **Study top LP** — in-depth LP behavior analysis
- **Chart indicators** — RSI, Bollinger Bands, Supertrend, Fibonacci
- **Discovery** — pool and token discovery

All relay calls use centralized request and header logic with shared `publicApiKey`. If the relay is unavailable, the agent falls back to direct Meteora SDK calls where possible.

### Built-in defaults

The Agent Meridian API URL and public API key are pre-configured:

```json
{
  "agentMeridianApiUrl": "https://api.agentmeridian.xyz/api",
  "publicApiKey": "bWVyaWRpYW4taXMtdGhlLWJlc3QtYWdlbnRz"
}
```

No setup needed — these work out of the box.

---

## Hive Mind (optional)

Meridian includes an **opt-in** collective intelligence system called **Hive Mind**. When enabled, your agent anonymously shares what it learns (lessons, deploy outcomes, screening thresholds) with other Meridian agents and receives crowd wisdom in return.

**What you get:**
- Pool consensus from other agents
- Strategy rankings — which strategies actually work across all agents
- Pattern consensus — what works at different volatility levels
- Threshold medians — what screening settings other agents have evolved to

**What you share:**
- Lessons from `lessons.json`
- Deploy outcomes from `pool-memory.json` (pool address, strategy, PnL, hold time)
- Screening thresholds from `user-config.json`
- **NO wallet addresses, private keys, or SOL balances are ever sent**

**Impact:** 1 non-blocking API call per screening cycle (~200ms), 1 fire-and-forget POST on position close. If the hive is down, your agent doesn't notice.

The Hive Mind URL defaults to `https://api.agentmeridian.xyz` and is pre-configured — you only need an API key to participate.

### Setup

**1. Get the registration token** from the private Telegram discussion.

**2. Register your agent**

```bash
node -e "import('./hivemind.js').then(m => m.register('https://api.agentmeridian.xyz', 'YOUR_TOKEN'))"
```

Replace `YOUR_TOKEN` with the registration token from Telegram.

This automatically saves your credentials to `user-config.json`. **Save the API key printed in the terminal** — it will not be shown again.

**3. Done.** No restart needed. Your agent will sync on every position close and query the hive during screening.

### Disable

Clear the API key in `user-config.json`:
```json
{
  "hiveMindApiKey": ""
}
```

---

## Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
CMD ["node", "index.js"]
```

Build and run:

```bash
docker build -t meridian .
docker run -d --env-file .env meridian
```

For Dokploy or similar platforms, use `nixpacks.toml` (included) for automatic builds.

---

## Changelog

### Main branch

- **Agent Meridian relay** — wired for open positions, PnL, top LP, study top LP, chart indicators, and discovery
- **Built-in defaults** — Agent Meridian public API URL and HiveMind URL pre-configured
- **LPAgent relay** — Meteora SDK fallback for open positions and PnL
- **Chart indicators** — optional RSI, Bollinger Bands, Supertrend, Fibonacci (confirmation-only, never overrides TP/SL/OOR/trailing)
- **Decision log** — agent records structured reasoning for every deploy, close, or skip
- **Tool-call safety** — hardened tool execution and strict root tool schemas
- **Config validation** — update validation and value coercion
- **SOL mode fixes** — normalization of SOL-denominated values throughout
- **Cleanup** — removed old `hive-mind.js`, unused imports, and dead code
- **Centralized relay** — shared Agent Meridian request and header logic

### Experimental branch ([`experimental`](https://github.com/gerungrunge/meridian/tree/experimental))

Includes everything in main, plus:

- **Jupiter Ultra** — single-key and referral config for Jupiter Ultra swaps
- **Config hardening** — empty strings in config fields no longer disable Agent Meridian or HiveMind defaults

---

## Disclaimer

This software is provided as-is, with no warranty. Running an autonomous trading agent carries real financial risk — you can lose funds. Always start with `npm run dev` (dry run) to verify behavior before going live. Never deploy more capital than you can afford to lose. This is not financial advice.

The authors are not responsible for any losses incurred through use of this software.
