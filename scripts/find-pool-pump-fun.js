/**
 * Find Pump.fun entries in pool-memory.json.
 *
 * Usage: node scripts/find-pool-pump-fun.js
 */

import fs from "fs";
import { dataPath } from "../data-dir.js";

const POOL_MEM = dataPath("pool-memory.json");
if (!fs.existsSync(POOL_MEM)) {
  console.log(`Missing ${POOL_MEM}`);
  process.exit(1);
}

const m = JSON.parse(fs.readFileSync(POOL_MEM, "utf8"));
const all = Object.entries(m);
const pf = all.filter(([k, v]) =>
  k.toLowerCase().includes("pump") ||
  (v?.pool_name || "").toLowerCase().includes("pump")
);

console.log(`Pump.fun entries: ${pf.length} of ${all.length} total pools\n`);

for (const [k, v] of pf.slice(0, 5)) {
  const name = v?.pool_name || "?";
  const addr = k.slice(0, 12);
  const deploys = v?.deploy_history || [];
  const closes = deploys.filter((d) => d.closed_at);
  console.log(`  ${addr}  ${name}`);
  console.log(`    total deploys: ${deploys.length}, closes: ${closes.length}`);
  console.log(`    last deployed: ${v?.last_deployed_at || "?"}`);
  if (closes.length > 0) {
    const last3 = closes.slice(-3);
    for (const c of last3) {
      console.log(`    close: pnl_pct=${c.pnl_pct ?? "?"} reason="${c.close_reason || "?"}" at ${c.closed_at?.slice(0, 19) || "?"}`);
    }
  }
  console.log("");
}
