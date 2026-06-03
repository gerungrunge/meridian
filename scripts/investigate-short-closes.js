/**
 * Investigate anomalous short-held position closes.
 *
 * Scans data/lessons.json for positions that closed in < N minutes with
 * small PnL loss (the 1m 31s Pump.fun pattern), prints their close
 * reasons, and optionally greps the day's log file for matching
 * position addresses.
 *
 * Usage on container:
 *   node scripts/investigate-short-closes.js
 *   node scripts/investigate-short-closes.js --max-minutes 5
 *   node scripts/investigate-short-closes.js --last 10
 *   node scripts/investigate-short-closes.js --no-logs   # skip log grep
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dataPath } from "../data-dir.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const get = (k, dflt) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : dflt;
};
const maxMinutes = Number(get("--max-minutes", 5));
const last = Number(get("--last", 10));
const skipLogs = args.includes("--no-logs");

const LESSONS_FILE = dataPath("lessons.json");
const LOG_DIR = "/app/logs";

function todayLog() {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `cron-${today}.log`);
}

function main() {
  if (!fs.existsSync(LESSONS_FILE)) {
    console.log(`Missing ${LESSONS_FILE}`);
    return;
  }
  const data = JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
  const records = data.performance || [];

  // Find short-held positions
  const short = records.filter((p) =>
    p.minutes_held != null && p.minutes_held <= maxMinutes
  );

  console.log(`\n=== Short-held positions (<= ${maxMinutes} min) — ${short.length} of ${records.length} ===\n`);

  if (short.length === 0) {
    console.log("No short-held positions found.");
    return;
  }

  // Print the most recent N
  const recent = short.slice(-last);
  for (const p of recent) {
    const pos = (p.position || "").slice(0, 12);
    const pool = p.pool_name || "?";
    const held = p.minutes_held;
    const pnl = p.pnl_pct?.toFixed(2) ?? "?";
    const usd = p.pnl_usd?.toFixed(2) ?? "?";
    const reason = p.close_reason || "?";
    const when = p.recorded_at?.slice(0, 19) ?? "?";
    console.log(`  ${pos}  ${pool.padEnd(20)}  ${String(held).padStart(3)}m  ${pnl.padStart(6)}% ($${usd})`);
    console.log(`    reason: ${reason}`);
    console.log(`    when:   ${when}`);
    console.log("");
  }

  // Bucket by close reason
  console.log(`\n=== By close reason ===`);
  const byReason = new Map();
  for (const p of short) {
    const r = (p.close_reason || "unknown").toLowerCase();
    let key = "other";
    if (r.includes("auto-closed") || r.includes("not found on-chain")) key = "auto-closed/not-found";
    else if (r.includes("agent decision") || r.includes("relay")) key = "agent/relay";
    else if (r.includes("stop loss")) key = "stop_loss";
    else if (r.includes("oor") || r.includes("out of range")) key = "oor";
    else if (r.includes("pumped")) key = "rule3";
    else if (r.includes("trailing tp")) key = "trailing_tp";
    else if (r.includes("quick profit")) key = "quick_profit";
    else if (r.includes("take profit")) key = "take_profit";
    else if (r.includes("yield")) key = "low_yield";
    if (!byReason.has(key)) byReason.set(key, []);
    byReason.get(key).push(p);
  }
  for (const [reason, rows] of byReason) {
    const sumPnl = rows.reduce((s, r) => s + (r.pnl_usd ?? 0), 0);
    console.log(`  ${reason.padEnd(24)}  n=${String(rows.length).padStart(3)}  total=$${sumPnl.toFixed(2)}`);
  }

  // Grep logs for the most recent short-held position
  if (!skipLogs) {
    const logFile = todayLog();
    if (!fs.existsSync(logFile)) {
      console.log(`\nNo log file at ${logFile} — skipping log grep.`);
      return;
    }
    const target = recent[recent.length - 1];
    if (!target?.position) {
      console.log(`\nNo position address to grep.`);
      return;
    }
    console.log(`\n=== Log entries for ${target.position} (${logFile}) ===`);
    try {
      const log = fs.readFileSync(logFile, "utf8");
      const lines = log.split("\n").filter((l) => l.includes(target.position));
      console.log(`  ${lines.length} matching lines`);
      lines.slice(-30).forEach((l) => console.log("  " + l));
    } catch (e) {
      console.log(`  Log read error: ${e.message}`);
    }
  }
}

main();
