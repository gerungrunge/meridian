/**
 * Dump a single pool-memory entry to see its actual structure.
 *
 * Usage: node scripts/dump-pool-entry.js [partial-address]
 * Example: node scripts/dump-pool-entry.js HJMAxehy
 */

import fs from "fs";
import { dataPath } from "../data-dir.js";

const POOL_MEM = dataPath("pool-memory.json");
if (!fs.existsSync(POOL_MEM)) {
  console.log(`Missing ${POOL_MEM}`);
  process.exit(1);
}

const m = JSON.parse(fs.readFileSync(POOL_MEM, "utf8"));
const keys = Object.keys(m);
const target = process.argv[2];
const match = target
  ? keys.find((k) => k.startsWith(target))
  : keys[0];

if (!match) {
  console.log(`No pool address starting with "${target}"`);
  console.log(`Available keys (first 5):`);
  keys.slice(0, 5).forEach((k) => console.log(`  ${k}`));
  process.exit(1);
}

const v = m[match];
console.log(`Pool address: ${match}\n`);
console.log(`Top-level keys: ${Object.keys(v || {}).join(", ")}\n`);
console.log("Full value:");
console.log(JSON.stringify(v, null, 2).slice(0, 2000));
