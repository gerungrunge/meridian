/**
 * Find Pump.fun short-held closes.
 *
 * Usage: node scripts/find-pump-fun.js [--max-minutes 5]
 */

import fs from "fs";
import { dataPath } from "../data-dir.js";

const args = process.argv.slice(2);
const maxMin = Number(args.find((a, i) => args[i - 1] === "--max-minutes") ?? 5);

const LESSONS = dataPath("lessons.json");
if (!fs.existsSync(LESSONS)) {
  console.log(`Missing ${LESSONS}`);
  process.exit(1);
}

const d = JSON.parse(fs.readFileSync(LESSONS, "utf8"));
const pf = (d.performance || []).filter((p) =>
  p.pool_name && p.pool_name.toLowerCase().includes("pump") &&
  p.minutes_held != null && p.minutes_held <= maxMin
);

console.log(`Pump.fun <=${maxMin}min closes: ${pf.length}\n`);

if (pf.length === 0) {
  console.log("No matches.");
  process.exit(0);
}

for (const p of pf.slice(-10)) {
  const pos = (p.position || "").slice(0, 12);
  const name = p.pool_name || "?";
  const held = p.minutes_held;
  const pnl = p.pnl_pct?.toFixed(2) ?? "?";
  const usd = p.pnl_usd?.toFixed(2) ?? "?";
  const reason = p.close_reason || "?";
  const when = p.recorded_at?.slice(0, 19) ?? "?";
  console.log(`  ${pos}  ${name.padEnd(20)}  ${String(held).padStart(3)}m  ${pnl.padStart(7)}% ($${usd})`);
  console.log(`    reason: ${reason}`);
  console.log(`    when:   ${when}`);
  console.log("");
}

// Summary by reason
const byReason = new Map();
for (const p of pf) {
  const r = (p.close_reason || "unknown").toLowerCase();
  let key = "other";
  if (r.includes("auto-closed") || r.includes("not found on-chain")) key = "auto-closed";
  else if (r.includes("agent decision") || r.includes("relay")) key = "agent/relay";
  else if (r.includes("stop loss")) key = "stop_loss";
  else if (r.includes("pumped")) key = "rule3";
  else if (r.includes("trailing tp")) key = "trailing_tp";
  else if (r.includes("quick profit")) key = "quick_profit";
  else if (r.includes("take profit")) key = "take_profit";
  if (!byReason.has(key)) byReason.set(key, []);
  byReason.get(key).push(p);
}

console.log(`\n=== Summary ===`);
for (const [reason, rows] of byReason) {
  const sumPnl = rows.reduce((s, r) => s + (r.pnl_usd ?? 0), 0);
  console.log(`  ${reason.padEnd(20)}  n=${String(rows.length).padStart(3)}  total=$${sumPnl.toFixed(2)}`);
}
