/**
 * Find closes by recorded_at timestamp prefix.
 *
 * Usage:
 *   node scripts/find-closes-by-time.js 2026-06-03T03
 *   node scripts/find-closes-by-time.js 2026-06-03
 *   node scripts/find-closes-by-time.js 2026-06-03T03:51
 */

import fs from "fs";
import { dataPath } from "../data-dir.js";

const prefix = process.argv[2];
if (!prefix) {
  console.log("Usage: node scripts/find-closes-by-time.js <iso-date-prefix>");
  console.log("Examples:");
  console.log("  node scripts/find-closes-by-time.js 2026-06-03");
  console.log("  node scripts/find-closes-by-time.js 2026-06-03T03");
  process.exit(1);
}

const LESSONS = dataPath("lessons.json");
if (!fs.existsSync(LESSONS)) {
  console.log(`Missing ${LESSONS}`);
  process.exit(1);
}

const d = JSON.parse(fs.readFileSync(LESSONS, "utf8"));
const matches = (d.performance || []).filter((p) =>
  (p.recorded_at || "").startsWith(prefix)
);

console.log(`Closes with recorded_at starting with "${prefix}": ${matches.length}\n`);

for (const p of matches) {
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
