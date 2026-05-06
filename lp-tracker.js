/**
 * LP Tracker — pool-level top-LPer signal cache + volatility percentile.
 *
 * Responsibilities:
 *  enrichWithLPSignals(candidates) — fetches /study-top-lp + /top-lp for top N
 *    candidates, attaches top_lper_count / suggested_strategy / crowding fields.
 *    Mutates in-place. Re-sort after calling to reflect updated scores.
 *
 *  observeVolatility(vol) — feeds rolling sample for dynamic vol floor.
 *  getVolPercentileFloor(pct) — Nth percentile of recent samples (fallback: static config).
 *
 *  recordPoolObservation() / getLPTrackerSummary() — persistence + diagnostics.
 */

import { config } from "./config.js";
import { log } from "./logger.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACKER_FILE   = path.join(__dirname, "lp-tracker.json");
const CACHE_TTL_MS   = 30 * 60 * 1000; // 30 min — aligns with one screening run cadence
const VOL_SAMPLE_MAX = 300;            // ring buffer size (~2–3 days of screening)
const LP_ENRICH_LIMIT = 5;            // only enrich top N score-ranked candidates

// Inline helpers to avoid circular import with tools/agent-meridian.js
const DEFAULT_KEY = "bWVyaWRpYW4taXMtdGhlLWJlc3QtYWdlbnRz";
const apiBase    = () => config.api.url;
const apiHeaders = () => ({ "x-api-key": config.api.publicApiKey || DEFAULT_KEY });

// ─── Volatility percentile ────────────────────────────────────────────────────

let _volSamples = [];

/**
 * Record one pool's volatility. Called for every screened pool in discoverPools().
 * Thread-safe (single-threaded JS), ignores invalid/zero values.
 */
export function observeVolatility(vol) {
  const n = Number(vol);
  if (!Number.isFinite(n) || n <= 0) return;
  _volSamples.push(n);
  if (_volSamples.length > VOL_SAMPLE_MAX) _volSamples.shift();
}

/**
 * Returns the Nth percentile of recent volatility samples.
 * Requires ≥30 samples to be meaningful; falls back to config.screening.minVolatility.
 * Use pct=25 for a dynamic lower filter floor.
 */
export function getVolPercentileFloor(pct = 25) {
  if (_volSamples.length < 30) return config.screening.minVolatility ?? 1.5;
  const sorted = [..._volSamples].sort((a, b) => a - b);
  const idx    = Math.max(0, Math.floor((pct / 100) * sorted.length) - 1);
  return Number(sorted[idx].toFixed(2));
}

// ─── Pool signal cache ────────────────────────────────────────────────────────

const _cache = new Map(); // pool_address → { ts, signal }

async function fetchLPSignal(pool_address) {
  const hit = _cache.get(pool_address);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.signal;

  try {
    const base = apiBase();
    const hdrs = apiHeaders();

    // Parallel fetch: aggregate signal + per-owner stats
    const [studyRes, topRes] = await Promise.all([
      fetch(`${base}/study-top-lp/${pool_address}`, { headers: hdrs }),
      fetch(`${base}/top-lp/${pool_address}`,       { headers: hdrs }),
    ]);

    const study = studyRes.ok ? await studyRes.json() : {};
    const top   = topRes.ok  ? await topRes.json()   : {};

    const lpers    = Array.isArray(top.topLpers)          ? top.topLpers          : [];
    const hist     = Array.isArray(top.historicalOwners)  ? top.historicalOwners  : [];

    // Aggregate quality metrics across top LPers
    const avgRoi = lpers.length
      ? lpers.reduce((s, l) => s + (Number(l.roiPct) || 0),      0) / lpers.length : 0;
    const avgWr  = lpers.length
      ? lpers.reduce((s, l) => s + (Number(l.winRatePct) || 0),  0) / lpers.length : 0;

    // Strategy preference from historical owners
    const stratFreq = hist
      .map((o) => o.preferredStrategy)
      .filter(Boolean)
      .reduce((acc, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {});
    const topStrategy = Object.entries(stratFreq)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const signal = {
      suggested_strategy:    study.suggestedStyle || topStrategy || null,
      top_lper_count:        lpers.length,
      owner_count:           study.ownerCount          ?? hist.length,
      active_position_count: study.activePositionCount ?? 0,
      avg_roi_pct:           Number(avgRoi.toFixed(2)),
      avg_win_rate:          Number((avgWr / 100).toFixed(3)),
      preferred_strategies:  stratFreq,
    };

    _cache.set(pool_address, { ts: Date.now(), signal });
    return signal;
  } catch (err) {
    log("lp_tracker", `fetchLPSignal ${pool_address.slice(0, 8)}: ${err.message}`);
    return null;
  }
}

// ─── Public enrichment ────────────────────────────────────────────────────────

/**
 * Enrich top LP_ENRICH_LIMIT candidates with LPer signals.
 * Mutates each candidate object in-place. Caller should re-sort after.
 *
 * Fields added:
 *   top_lper_count      — # top LPers active in pool
 *   suggested_strategy  — "bid_ask" | "spot" | "curve" | null
 *   lper_owner_count    — total distinct owners
 *   lper_avg_roi_pct    — mean ROI across top LPers
 *   lper_avg_win_rate   — mean win rate across top LPers
 *   bot_fee_share_pct   — estimated % of active-bin fees bot would capture
 *   is_crowded          — true when bot's fee share < 3% AND many owners
 */
export async function enrichWithLPSignals(candidates) {
  if (!candidates?.length) return;

  const shortlist = candidates.slice(0, LP_ENRICH_LIMIT);
  const results   = await Promise.allSettled(shortlist.map((c) => fetchLPSignal(c.pool)));

  for (let i = 0; i < shortlist.length; i++) {
    const r = results[i];
    if (r.status !== "fulfilled" || !r.value) continue;

    const sig = r.value;
    const p   = shortlist[i];

    p.top_lper_count     = sig.top_lper_count;
    p.suggested_strategy = sig.suggested_strategy;
    p.lper_owner_count   = sig.owner_count;
    p.lper_avg_roi_pct   = sig.avg_roi_pct;
    p.lper_avg_win_rate  = sig.avg_win_rate;

    // Crowding: rough deploy_usd / (active_tvl + deploy_usd)
    // SOL price hard-coded to ~180 for order-of-magnitude only (not used for trades)
    const activeTvl  = Number(p.active_tvl || 0);
    const deployUsd  = (config.management.deployAmountSol ?? 0.3) * 180;
    const botShare   = activeTvl > 0 ? deployUsd / (activeTvl + deployUsd) : 1.0;
    p.bot_fee_share_pct = Number((botShare * 100).toFixed(2));
    p.is_crowded        = botShare < 0.03 && sig.owner_count > 25;

    if (sig.top_lper_count > 0 || p.is_crowded) {
      log(
        "lp_tracker",
        `${p.name}: lpers=${sig.top_lper_count} strategy=${sig.suggested_strategy} ` +
        `bot_share=${p.bot_fee_share_pct}% crowded=${p.is_crowded} roi=${sig.avg_roi_pct}%`,
      );
    }

    // Persist observation for future offline analysis
    recordPoolObservation(p.pool, {
      pool_name:          p.name,
      top_lper_count:     sig.top_lper_count,
      suggested_strategy: sig.suggested_strategy,
      owner_count:        sig.owner_count,
      avg_roi_pct:        sig.avg_roi_pct,
      avg_win_rate:       sig.avg_win_rate,
      active_tvl:         activeTvl,
      bot_fee_share_pct:  p.bot_fee_share_pct,
      is_crowded:         p.is_crowded,
    });
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

let _tracker = null;

function loadTracker() {
  if (_tracker) return _tracker;
  try {
    _tracker = JSON.parse(fs.readFileSync(TRACKER_FILE, "utf8"));
  } catch {
    _tracker = { version: 1, pools: {} };
  }
  return _tracker;
}

function saveTracker() {
  if (!_tracker) return;
  try {
    fs.writeFileSync(TRACKER_FILE, JSON.stringify(_tracker, null, 2));
  } catch (err) {
    log("lp_tracker", `save failed: ${err.message}`);
  }
}

/**
 * Append one observation snapshot for a pool.
 * Keeps the last 30 entries per pool to bound file size.
 */
export function recordPoolObservation(pool_address, obs) {
  const t = loadTracker();
  if (!t.pools[pool_address]) {
    t.pools[pool_address] = { first_seen: new Date().toISOString(), observations: [] };
  }
  const entry = t.pools[pool_address];
  entry.last_seen = new Date().toISOString();
  entry.observations.push({ ts: new Date().toISOString(), ...obs });
  if (entry.observations.length > 30) {
    entry.observations = entry.observations.slice(-30);
  }
  saveTracker();
}

/**
 * Quick summary for /status or Telegram diagnostics.
 */
export function getLPTrackerSummary() {
  const t          = loadTracker();
  const poolCount  = Object.keys(t.pools).length;
  const obsCount   = Object.values(t.pools).reduce((s, p) => s + p.observations.length, 0);
  const volFloor   = getVolPercentileFloor(25);
  const staticFloor = config.screening.minVolatility ?? 1.5;
  return {
    pools_tracked:      poolCount,
    total_observations: obsCount,
    vol_samples:        _volSamples.length,
    vol_percentile_25:  volFloor,
    vol_static_floor:   staticFloor,
    vol_floor_drift:    Number((volFloor - staticFloor).toFixed(2)),
  };
}
