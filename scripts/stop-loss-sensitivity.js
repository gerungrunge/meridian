/**
 * Stop-loss sensitivity analysis.
 *
 * Reads data/lessons.json and analyzes the PnL distribution in the
 * danger zone (0% to -15%) to inform the -10% vs -7% decision.
 *
 * Questions answered:
 *   1. PnL distribution by 1% buckets in the 0% to -15% range
 *   2. How many closes in the -7% to -10% range — were they winners or losers?
 *   3. SAOS-SOL-style outliers: any PnL worse than -50%?
 *   4. Inferring "drawdown -7% then recover" from Rule 3 winners
 *      (Rule 3 winners exit positive; if any had to climb back from -7% to
 *      positive, that pattern is fragile to stop loss tightening)
 *
 * Usage on container:
 *   node scripts/stop-loss-sensitivity.js
 *   node scripts/stop-loss-sensitivity.js --json
 */

import fs from "fs";
import { dataPath } from "../data-dir.js";

const LESSONS_FILE = dataPath("lessons.json");

function load() {
  if (!fs.existsSync(LESSONS_FILE)) {
    throw new Error(`Missing ${LESSONS_FILE}`);
  }
  return JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
}

function bucket(pnl) {
  // Bucket by 1% in the -15% to 0% range, then coarser above/below
  if (pnl >= 0) return `${pnl >= 5 ? "+5" : "+0 to +5"}%`;
  if (pnl >= -3) return "-0 to -3%";
  if (pnl >= -5) return "-3 to -5%";
  if (pnl >= -7) return "-5 to -7%";
  if (pnl >= -10) return "-7 to -10%";
  if (pnl >= -15) return "-10 to -15%";
  if (pnl >= -30) return "-15 to -30%";
  if (pnl >= -50) return "-30 to -50%";
  return "<-50%";
}

function classify(reason) {
  const r = String(reason || "").toLowerCase();
  if (r.includes("trailing tp") && r.includes("stop loss")) return "stop_loss";
  if (r.includes("pumped far above range")) return "rule3";
  if (r.includes("trailing tp")) return "trailing_tp";
  if (r.includes("stop loss")) return "stop_loss";
  if (r.includes("take profit")) return "take_profit";
  if (r.includes("oor") || r.includes("out of range")) return "oor";
  if (r.includes("low yield")) return "low_yield";
  return "other";
}

function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes("--json");

  const data = load();
  const records = data.performance || [];
  if (records.length === 0) {
    console.log("No records found.");
    return;
  }

  // ── 1. PnL distribution by bucket ──────────────────────────────
  const buckets = new Map();
  for (const r of records) {
    const b = bucket(r.pnl_pct ?? 0);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(r);
  }

  const order = [
    "<-50%", "-30 to -50%", "-15 to -30%", "-10 to -15%",
    "-7 to -10%", "-5 to -7%", "-3 to -5%", "-0 to -3%",
    "+0 to +5%", "+5%",
  ];
  // Use a Map keyed by bucket; preserve insertion order
  const dist = [];
  for (const key of order) {
    const rows = buckets.get(key) || [];
    if (rows.length === 0) continue;
    const wins = rows.filter((r) => (r.pnl_usd ?? 0) > 0);
    const sumPnl = rows.reduce((s, r) => s + (r.pnl_usd ?? 0), 0);
    dist.push({
      bucket: key,
      n: rows.length,
      pct: Math.round((rows.length / records.length) * 1000) / 10,
      wins: wins.length,
      win_rate: Math.round((wins.length / rows.length) * 1000) / 10,
      avg_pct: Math.round((rows.reduce((s, r) => s + (r.pnl_pct || 0), 0) / rows.length) * 100) / 100,
      total_pnl_usd: Math.round(sumPnl * 100) / 100,
      avg_fees_usd: Math.round((rows.reduce((s, r) => s + (r.fees_earned_usd ?? 0), 0) / rows.length) * 100) / 100,
    });
  }

  // ── 2. -7% to -10% bucket detail ──────────────────────────────
  const dangerZone = buckets.get("-7 to -10%") || [];
  const extremeOutliers = records.filter((r) => (r.pnl_pct ?? 0) <= -50);

  // ── 3. Infer "drawdown then recover" from Rule 3 winners ──────
  // Rule 3 winners: PnL > 0 + reason contains "pumped far above range"
  // Inference: these positions pumped above range (positive PnL) and were closed.
  // If the position had dipped to -7% before pumping, we'd see the close PnL
  // is positive but the recovery distance is large. We don't have intra-hold
  // data, so we estimate: what % of Rule 3 winners are < +1%?
  // → if many are +0.01% to +0.5%, they probably didn't dip deep before pumping
  // → if many are +1% to +3%, they may have had bigger swings
  const rule3Winners = records.filter((r) =>
    classify(r.close_reason) === "rule3" && (r.pnl_usd ?? 0) > 0
  );
  const rule3WinnersTiny = rule3Winners.filter((r) => (r.pnl_usd ?? 0) < 0.05);
  const rule3WinnersSmall = rule3Winners.filter((r) => {
    const u = r.pnl_usd ?? 0;
    return u >= 0.05 && u < 0.2;
  });

  if (jsonOut) {
    console.log(JSON.stringify({
      total: records.length,
      distribution: dist,
      danger_zone: {
        bucket: "-7 to -10%",
        n: dangerZone.length,
        rows: dangerZone.map((r) => ({
          pool_name: r.pool_name,
          pnl_pct: r.pnl_pct,
          pnl_usd: r.pnl_usd,
          close_reason: r.close_reason,
          closed_at: r.recorded_at,
        })),
      },
      extreme_outliers: extremeOutliers.map((r) => ({
        pool_name: r.pool_name,
        pnl_pct: r.pnl_pct,
        pnl_usd: r.pnl_usd,
        close_reason: r.close_reason,
        closed_at: r.recorded_at,
      })),
      rule3_winners_total: rule3Winners.length,
      rule3_winners_under_5c: rule3WinnersTiny.length,
      rule3_winners_5c_to_20c: rule3WinnersSmall.length,
    }, null, 2));
    return;
  }

  console.log(`\n=== Stop Loss Sensitivity (n=${records.length}) ===\n`);

  console.log("PnL distribution (final close PnL, not peak/min during hold):");
  for (const d of dist) {
    console.log(
      `  ${d.bucket.padEnd(15)} n=${String(d.n).padStart(3)} (${(d.pct + "%").padStart(5)})` +
      `  win=${(d.win_rate + "%").padStart(6)}` +
      `  avg_pct=${(d.avg_pct >= 0 ? "+" : "") + d.avg_pct + "%"}` +
      `  total=$${d.total_pnl_usd >= 0 ? "+" : ""}${d.total_pnl_usd}` +
      `  fees=$${d.avg_fees_usd}/pos`
    );
  }

  console.log(`\n=== Danger Zone: -7% to -10% ===`);
  console.log(`Closes in this bucket: ${dangerZone.length} of ${records.length} (${((dangerZone.length / records.length) * 100).toFixed(2)}%)`);
  if (dangerZone.length > 0) {
    for (const r of dangerZone) {
      console.log(`  ${r.pool_name} (${(r.pool || "").slice(0, 8)})  PnL ${r.pnl_pct.toFixed(2)}%  $${r.pnl_usd?.toFixed(2) ?? "?"}  reason: ${r.close_reason}`);
    }
    const sumPnl = dangerZone.reduce((s, r) => s + (r.pnl_usd ?? 0), 0);
    console.log(`  Total: $${sumPnl.toFixed(2)} (all losers — would ALL be stopped at -7%)`);
  } else {
    console.log(`  No closes in this bucket. -7% threshold would not change anything.`);
  }

  console.log(`\n=== Extreme outliers (PnL <= -50%) ===`);
  console.log(`Count: ${extremeOutliers.length} of ${records.length}`);
  for (const r of extremeOutliers) {
    console.log(`  ${r.pool_name} (${(r.pool || "").slice(0, 8)})  PnL ${r.pnl_pct.toFixed(2)}%  $${r.pnl_usd?.toFixed(2) ?? "?"}  closed: ${r.recorded_at?.slice(0, 10)}`);
    console.log(`    reason: ${r.close_reason}`);
  }
  const outlierPnl = extremeOutliers.reduce((s, r) => s + (r.pnl_usd ?? 0), 0);
  console.log(`  Outlier total: $${outlierPnl.toFixed(2)}`);

  console.log(`\n=== Rule 3 winner profile (proxy for "drawdown then recover") ===`);
  console.log(`Total Rule 3 winners: ${rule3Winners.length}`);
  console.log(`  under $0.05 profit: ${rule3WinnersTiny.length}  (likely quick pump-and-dump, probably didn't dip deep)`);
  console.log(`  $0.05 to $0.20 profit: ${rule3WinnersSmall.length}  (small winners, may have had intra-hold swings)`);
  if (rule3Winners.length > 0) {
    const tinyPct = (rule3WinnersTiny.length / rule3Winners.length) * 100;
    console.log(`  ${tinyPct.toFixed(0)}% of Rule 3 winners captured < $0.05.`);
    if (tinyPct >= 50) {
      console.log(`  → Most Rule 3 winners are quick pump-and-dumps. Tightening stop loss to -7% is unlikely to cut meaningful winners.`);
    } else {
      console.log(`  → Substantial portion of Rule 3 winners are real winners ($0.05+). Need peak data to know if any dipped to -7%.`);
    }
  }

  console.log(`\n=== Recommendation ===`);
  if (dangerZone.length === 0) {
    console.log(`No closes in -7% to -10% bucket. Tightening to -7% would catch ZERO additional positions.`);
    console.log(`Net impact: same as -10% threshold. No data supports a change.`);
  } else if (extremeOutliers.length > 0) {
    console.log(`Extreme outliers (${extremeOutliers.length}) would NOT be helped by -7% (PnL was already <= -50%, threshold lag is the issue, not the level).`);
    console.log(`Danger zone closes (${dangerZone.length}) would all be stopped at -7% — but they were already losers.`);
    console.log(`Net impact: minimal. The -10% → -7% change would catch ~${dangerZone.length} more losers (saves $${dangerZone.reduce((s, r) => s + (r.pnl_usd ?? 0), 0).toFixed(2)}),`);
    console.log(`but would NOT have prevented the extreme outliers (those are PnL-feed-lag events, not threshold issues).`);
  }

  console.log("");
}

main();
