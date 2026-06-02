/**
 * Auto-track smart wallets from LPAgent top-LP studies.
 *
 * For each pool the bot has deployed into (from pool-memory.json), fetch
 * the top LPers via LPAgent, filter for high win rate + ROI + PnL, and
 * add qualifying wallets to data/smart-wallets.json. Idempotent —
 * already-tracked addresses are skipped.
 *
 * Runs daily via cron (after the 01:00 UTC briefing) and on first
 * container startup (if not already run today).
 *
 * Conservative rate-limit posture:
 *   - POOLS_PER_RUN = 5 pools max
 *   - State file in data dir tracks last run date (UTC)
 *   - Failures on individual pools are logged but do not block the run
 */

import fs from "fs";
import { log } from "../logger.js";
import { dataPath } from "../data-dir.js";
import { listSmartWallets, addSmartWallet } from "../smart-wallets.js";
import { studyTopLPers } from "../tools/study.js";

const POOL_MEMORY_FILE = "./pool-memory.json";
const STATE_FILE = dataPath("auto-track-state.json");

const POOLS_PER_RUN = 5;
const LIMIT_PER_POOL = 5;
const MIN_WIN_RATE = 0.7;     // 70%+
const MIN_ROI_PCT = 0.3;      // 30%+
const MIN_TOTAL_PNL_USD = 50;

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { lastRunUtc: null };
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { lastRunUtc: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadPoolMemory() {
  if (!fs.existsSync(POOL_MEMORY_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(POOL_MEMORY_FILE, "utf8"));
  } catch {
    return {};
  }
}

function pickPools(memory, max) {
  // Most-recently-deployed first, exclude pools with no snapshots
  return Object.entries(memory)
    .filter(([, v]) => v && v.last_deployed_at)
    .sort(([, a], [, b]) => String(b.last_deployed_at).localeCompare(String(a.last_deployed_at)))
    .slice(0, max)
    .map(([pool]) => pool);
}

export async function autoTrackSmartWallets({ force = false } = {}) {
  const state = loadState();
  const today = todayUtc();
  if (!force && state.lastRunUtc === today) {
    log("smart_wallets", "auto-track: already ran today, skipping");
    return { skipped: true, reason: "ran today" };
  }

  const memory = loadPoolMemory();
  const pools = pickPools(memory, POOLS_PER_RUN);
  if (pools.length === 0) {
    log("smart_wallets", "auto-track: no pools in memory, skipping");
    saveState({ lastRunUtc: today });
    return { skipped: true, reason: "no pools" };
  }

  const existing = new Set(listSmartWallets().wallets.map((w) => w.address));

  let studied = 0;
  let added = 0;
  const errors = [];

  for (const pool of pools) {
    try {
      const study = await studyTopLPers({ pool_address: pool, limit: LIMIT_PER_POOL });
      studied++;

      for (const lper of study.lpers) {
        if (!lper?.owner) continue;
        const wr = Number(lper.summary?.win_rate ?? 0);
        const roi = Number(lper.summary?.roi ?? 0);
        const pnl = Number(lper.summary?.total_pnl_usd ?? 0);

        if (wr < MIN_WIN_RATE || roi < MIN_ROI_PCT || pnl < MIN_TOTAL_PNL_USD) continue;
        if (existing.has(lper.owner)) continue;

        const result = addSmartWallet({
          name: `auto-${lper.owner_short || lper.owner.slice(0, 8)}`,
          address: lper.owner,
          category: "smart",
          type: "lp",
        });
        if (result.success) {
          added++;
          existing.add(lper.owner);
        }
      }
    } catch (e) {
      const msg = String(e?.message || e);
      errors.push({ pool, error: msg });
      log("smart_wallets_warn", `auto-track: study failed for ${pool.slice(0, 8)}: ${msg}`);
    }
  }

  saveState({ lastRunUtc: today, lastRunAdded: added, lastRunStudied: studied, lastRunErrors: errors.length });

  log(
    "smart_wallets",
    `auto-track: added ${added} new smart wallets from ${studied}/${pools.length} pools (errors: ${errors.length})`,
  );
  return { added, studied, pools: pools.length, errors: errors.length };
}
