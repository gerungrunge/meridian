/**
 * EV analysis by close reason.
 *
 * Reads data/lessons.json and groups closed positions by close_reason family:
 *   - rule3       : "pumped far above range" (Rule 3)
 *   - trailing_tp : trailing TP exits
 *   - stop_loss   : "stop loss" or trailing stop
 *   - take_profit : "take profit" (Rule 2)
 *   - oor         : "OOR" (Rule 4)
 *   - low_yield   : "low yield" (Rule 5)
 *   - other       : everything else
 *
 * Prints a table per family:
 *   count, wins, win_rate, avg_pnl_pct, avg_pnl_usd, total_pnl_usd,
 *   avg_minutes_held, avg_fees_usd
 *
 * Also prints a per-pool breakdown for any pool with >= 3 closes.
 *
 * Designed to be run on the Dokploy container where data/lessons.json lives:
 *   node scripts/ev-by-close-reason.js
 *   node scripts/ev-by-close-reason.js --pool J9qgZAYeycmj5Ct9KmC8RfQZZDVzGwf5VfRoN4KNjnME
 *   node scripts/ev-by-close-reason.js --json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dataPath } from "../data-dir.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LESSONS_FILE = dataPath("lessons.json");

function classify(reason) {
  const r = String(reason || "").toLowerCase();
  // "Trailing TP: Stop loss: PnL -X% <= -10%" — close was routed through the
  // trailing TP handler but the actual trigger was stop loss. Classify as
  // stop_loss for accurate EV accounting.
  if (r.includes("trailing tp") && r.includes("stop loss")) return "stop_loss";
  if (r.includes("pumped far above range")) return "rule3";
  if (r.includes("trailing tp")) return "trailing_tp";
  if (r.includes("stop loss")) return "stop_loss";
  if (r.includes("take profit")) return "take_profit";
  if (r.includes("oor") || r.includes("out of range")) return "oor";
  if (r.includes("low yield")) return "low_yield";
  return "other";
}

// Extract bin distance from older relay-formatted close_reasons like
// "Rule 3: pumped far above range — active bin -695 above upper -700"
function extractBinDistance(reason) {
  if (reason == null) return null;
  const m = String(reason).match(/active bin (-?\d+)\s+above upper (-?\d+)/i);
  if (!m) return null;
  return Number(m[1]) - Number(m[2]);
}

function getBinDistance(r) {
  if (Number.isFinite(r.bin_distance_above_upper)) return r.bin_distance_above_upper;
  return extractBinDistance(r.close_reason);
}

const FAMILY_LABEL = {
  rule3:       "Rule 3 (pumped far above range)",
  trailing_tp: "Trailing TP",
  stop_loss:   "Stop loss",
  take_profit: "Take profit",
  oor:         "OOR",
  low_yield:   "Low yield",
  other:       "Other",
};

function summarize(rows) {
  if (rows.length === 0) {
    return { count: 0 };
  }
  const wins = rows.filter((r) => (r.pnl_usd ?? 0) > 0);
  const losses = rows.filter((r) => (r.pnl_usd ?? 0) < 0);
  const sumPnlUsd = rows.reduce((s, r) => s + (r.pnl_usd ?? 0), 0);
  const sumPnlPct = rows.reduce((s, r) => s + (Number(r.pnl_pct) || 0), 0);
  const sumFees = rows.reduce((s, r) => s + (r.fees_earned_usd ?? 0), 0);
  const sumMinutes = rows.reduce((s, r) => s + (r.minutes_held ?? 0), 0);

  return {
    count: rows.length,
    wins: wins.length,
    losses: losses.length,
    win_rate_pct: Math.round((wins.length / rows.length) * 1000) / 10,
    avg_pnl_pct: Math.round((sumPnlPct / rows.length) * 100) / 100,
    avg_pnl_usd: Math.round((sumPnlUsd / rows.length) * 100) / 100,
    total_pnl_usd: Math.round(sumPnlUsd * 100) / 100,
    avg_fees_usd: Math.round((sumFees / rows.length) * 100) / 100,
    total_fees_usd: Math.round(sumFees * 100) / 100,
    avg_minutes_held: Math.round(sumMinutes / rows.length),
    best_pnl_pct: Math.max(...rows.map((r) => Number(r.pnl_pct) || 0)),
    worst_pnl_pct: Math.min(...rows.map((r) => Number(r.pnl_pct) || 0)),
  };
}

function printRow(label, s) {
  if (s.count === 0) {
    console.log(`  ${label.padEnd(34)}  no closes`);
    return;
  }
  console.log(
    `  ${label.padEnd(34)}  n=${String(s.count).padStart(3)}` +
    `  win=${(s.win_rate_pct + "%").padStart(6)}` +
    `  avg_pct=${(s.avg_pct_str ?? s.avg_pnl_pct + "%").padStart(8)}` +
    `  avg_usd=${(s.avg_usd_str ?? "$" + s.avg_pnl_usd).padStart(8)}` +
    `  total=${(s.total_str ?? "$" + s.total_pnl_usd).padStart(9)}` +
    `  fees=$${s.total_fees_usd.toFixed(2)}` +
    `  held=${s.avg_minutes_held}m` +
    `  best=${s.best_pnl_pct.toFixed(2)}%` +
    `  worst=${s.worst_pnl_pct.toFixed(2)}%`
  );
}

function fmt(s) {
  return {
    ...s,
    avg_pct_str: `${s.avg_pnl_pct >= 0 ? "+" : ""}${s.avg_pnl_pct}%`,
    avg_usd_str: `${s.avg_pnl_usd >= 0 ? "+" : ""}$${s.avg_pnl_usd}`,
    total_str: `${s.total_pnl_usd >= 0 ? "+" : ""}$${s.total_pnl_usd}`,
  };
}

function loadRecords(poolFilter) {
  if (!fs.existsSync(LESSONS_FILE)) {
    throw new Error(`Missing ${LESSONS_FILE}`);
  }
  const data = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
  const all = data.performance || [];
  return poolFilter ? all.filter((r) => r.pool === poolFilter) : all;
}

function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes("--json");
  const poolArgIdx = args.indexOf("--pool");
  const poolFilter = poolArgIdx >= 0 ? args[poolArgIdx + 1] : null;

  const records = loadRecords(poolFilter);
  if (records.length === 0) {
    console.log("No performance records found.");
    return;
  }

  const byFamily = {};
  for (const fam of Object.keys(FAMILY_LABEL)) byFamily[fam] = [];
  for (const r of records) {
    byFamily[classify(r.close_reason)].push(r);
  }

  const report = {};
  for (const [fam, rows] of Object.entries(byFamily)) {
    report[fam] = summarize(rows);
  }

  if (jsonOut) {
    console.log(JSON.stringify({
      total_records: records.length,
      pool_filter: poolFilter,
      by_family: report,
    }, null, 2));
    return;
  }

  console.log(`\n=== EV by close reason (data/lessons.json) ===`);
  if (poolFilter) console.log(`Pool filter: ${poolFilter}`);
  console.log(`Total closes: ${records.length}\n`);

  console.log("By family:");
  for (const [fam, label] of Object.entries(FAMILY_LABEL)) {
    printRow(label, fmt(report[fam]));
  }

  const overall = summarize(records);
  console.log("");
  printRow("ALL", fmt(overall));

  // Per-pool breakdown (only pools with >= 3 closes)
  const byPool = new Map();
  for (const r of records) {
    const key = r.pool || "unknown";
    if (!byPool.has(key)) byPool.set(key, []);
    byPool.get(key).push(r);
  }
  const poolRows = Array.from(byPool.entries())
    .filter(([, rs]) => rs.length >= 3)
    .map(([pool, rs]) => ({ pool, name: rs[0]?.pool_name || pool.slice(0, 8), ...summarize(rs) }))
    .sort((a, b) => b.total_pnl_usd - a.total_pnl_usd);

  if (poolRows.length > 0) {
    console.log("\nPer-pool (>= 3 closes):");
    for (const p of poolRows) {
      printRow(`${p.name} (${p.pool.slice(0, 8)})`, fmt(p));
    }
  }

  // Headline EV
  const rule3 = report.rule3;
  const stop  = report.stop_loss;
  const trail = report.trailing_tp;
  if (rule3.count > 0 || stop.count > 0) {
    console.log("\n=== Headline ===");
    if (rule3.count > 0) {
      console.log(`Rule 3 (pumped above): ${rule3.count} closes, win rate ${rule3.win_rate_pct}%, avg PnL ${rule3.avg_pnl_pct}%, total $${rule3.total_pnl_usd}`);
      if (rule3.worst_pnl_pct > -2) {
        console.log(`  → Rule 3 closes are net positive even on losers. Range-too-narrow hypothesis supported.`);
      } else if (rule3.avg_pnl_pct > 0) {
        console.log(`  → Rule 3 avg positive but with drawdowns — check maxDD during hold.`);
      } else {
        console.log(`  → Rule 3 avg NEGATIVE — these exits happened too early or too late. Investigate.`);
      }
    }
    if (stop.count > 0) {
      console.log(`Stop loss: ${stop.count} closes, avg PnL ${stop.avg_pnl_pct}%, total $${stop.total_pnl_usd}`);
    }
    if (trail.count > 0) {
      console.log(`Trailing TP: ${trail.count} closes, avg PnL ${trail.avg_pnl_pct}%, total $${trail.total_pnl_usd}`);
    }
  }

  // Rule 3 deep-dive: peak vs exit + bin distance
  const rule3Rows = byFamily.rule3;
  const withPeak = rule3Rows.filter((r) => Number.isFinite(r.peak_pnl_pct));
  const withBin  = rule3Rows.filter((r) => Number.isFinite(getBinDistance(r)));

  if (rule3Rows.length > 0) {
    console.log("\n=== Rule 3 deep-dive ===");
    console.log(`Total Rule 3 closes: ${rule3Rows.length}`);
    if (withPeak.length > 0) {
      const avgPeak = withPeak.reduce((s, r) => s + r.peak_pnl_pct, 0) / withPeak.length;
      const avgExit = withPeak.reduce((s, r) => s + r.pnl_pct, 0) / withPeak.length;
      const avgLeftOnTable = withPeak.reduce((s, r) => s + (r.peak_pnl_pct - r.pnl_pct), 0) / withPeak.length;
      console.log(`  with peak data: ${withPeak.length}/${rule3Rows.length}`);
      console.log(`  avg peak PnL:    +${avgPeak.toFixed(2)}%`);
      console.log(`  avg exit PnL:    ${avgExit >= 0 ? "+" : ""}${avgExit.toFixed(2)}%`);
      console.log(`  avg left on table: ${avgLeftOnTable.toFixed(2)}% (peak - exit)`);
      const exitedAtPeak = withPeak.filter((r) => r.pnl_pct >= r.peak_pnl_pct * 0.8).length;
      console.log(`  exited within 80% of peak: ${exitedAtPeak}/${withPeak.length}`);
    } else {
      console.log(`  No peak_pnl_pct data yet — needs new closes after this script is deployed.`);
    }
    if (withBin.length > 0) {
      const avgDist = withBin.reduce((s, r) => s + getBinDistance(r), 0) / withBin.length;
      const maxDist = Math.max(...withBin.map((r) => getBinDistance(r)));
      console.log(`  with bin distance: ${withBin.length}/${rule3Rows.length}`);
      console.log(`  avg distance above upper: ${avgDist.toFixed(0)} bins (max ${maxDist})`);
    } else {
      console.log(`  No bin distance data — older close_reasons don't include the bin IDs.`);
    }
    // Per-pool Rule 3 breakdown
    const byPool3 = new Map();
    for (const r of rule3Rows) {
      const k = r.pool || "unknown";
      if (!byPool3.has(k)) byPool3.set(k, []);
      byPool3.get(k).push(r);
    }
    const pool3Rows = Array.from(byPool3.entries())
      .map(([pool, rs]) => ({
        pool,
        name: rs[0]?.pool_name || pool.slice(0, 8),
        ...summarize(rs),
      }))
      .sort((a, b) => b.total_pnl_usd - a.total_pnl_usd);
    if (pool3Rows.length > 0) {
      console.log(`\n  Per-pool Rule 3:`);
      for (const p of pool3Rows) {
        printRow(`    ${p.name} (${p.pool.slice(0, 8)})`, fmt(p));
      }
    }
  }

  // Stop loss deep-dive: did the position ever see -7% before hitting -10%?
  const stopRows = byFamily.stop_loss;
  if (stopRows.length > 0) {
    const withPeak = stopRows.filter((r) => Number.isFinite(r.peak_pnl_pct));
    const sawSeven = withPeak.filter((r) => r.peak_pnl_pct >= 7).length;
    console.log("\n=== Stop loss deep-dive ===");
    console.log(`Total stop loss closes: ${stopRows.length}`);
    if (withPeak.length > 0) {
      const avgPeak = withPeak.reduce((s, r) => s + r.peak_pnl_pct, 0) / withPeak.length;
      console.log(`  with peak data: ${withPeak.length}/${stopRows.length}`);
      console.log(`  avg peak PnL:    +${avgPeak.toFixed(2)}% (positions that hit stop had previously pumped to here)`);
      console.log(`  saw >=+7% before stop: ${sawSeven}/${withPeak.length} (these would benefit from trailing TP if it was off)`);
    } else {
      console.log(`  No peak data — needs new closes.`);
    }
  }

  console.log("");
}

main();
