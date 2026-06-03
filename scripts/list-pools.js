/**
 * List all pool names from pool-memory.json.
 *
 * Usage: node scripts/list-pools.js
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

console.log(`Total pools in pool-memory.json: ${all.length}\n`);

// Sort by last_deployed_at desc
all.sort(([, a], [, b]) => String(b?.last_deployed_at || "").localeCompare(String(a?.last_deployed_at || "")));

for (const [k, v] of all) {
  const name = v?.pool_name || "?";
  const addr = k.slice(0, 12);
  const last = v?.last_deployed_at?.slice(0, 19) || "?";
  const deploys = v?.deploy_history || [];
  console.log(`  ${addr}  ${name.padEnd(30)}  last: ${last}  deploys: ${deploys.length}`);
}
