/**
 * Bootstrap cleanup for stale/over-strict lessons.
 *
 * Background: lessons.json accumulates AUTO-EVOLVED entries (from
 * lessons.js evolveThresholds) that misinterpret historical loser
 * distributions as rejection thresholds (e.g. "Losers clustered at
 * volatility ~0.7" → LLM rejects all vol < 0.7, ignoring the config).
 *
 * This script runs on every container startup, strips the harmful
 * AUTO-EVOLVED and ZECK-SOL FAILED entries, and ensures a pinned
 * anchor lesson is present telling the SCREENER to defer to current
 * config values.
 *
 * Idempotency:
 *   - AUTO-EVOLVED / ZECK-SOL removal happens every restart
 *     (bot re-adds them via evolveThresholds on every 5 closes)
 *   - Anchor lesson is added once and kept across restarts
 *     (gated by `_bootstrap_clean_v1` marker tag)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "../logger.js";
import { dataPath } from "../data-dir.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LESSONS_FILE = dataPath("lessons.json");
const BOOTSTRAP_TAG = "_bootstrap_clean_v1";

const ANCHOR_RULE =
  "SCREENER: Always defer to CURRENT user-config.json thresholds " +
  "(minFeeActiveTvlRatio, maxVolatility, minOrganic, minHolders). " +
  "Lessons-learned are historical observations of PAST pools, NOT hard " +
  "floors for FUTURE pools. A pool with fee_tvl=0.03 is FINE if " +
  "config.minFeeActiveTvlRatio=0.008. Do not re-interpret or tighten " +
  "config values based on lesson text. AUTO-EVOLVED percentile stats " +
  "(e.g. \"Losers clustered at vol ~0.7\") describe historical loser " +
  "distribution, not rejection thresholds.";

function load() {
  if (!fs.existsSync(LESSONS_FILE)) return { lessons: [], performance: [] };
  try {
    return JSON.parse(fs.readFileSync(LESSONS_FILE, "utf8"));
  } catch {
    return { lessons: [], performance: [] };
  }
}

function save(data) {
  fs.writeFileSync(LESSONS_FILE, JSON.stringify(data, null, 2));
}

export function cleanStaleLessons() {
  const data = load();

  const before = data.lessons.length;
  // Always strip over-strict noise on every startup — these get re-added
  // by evolveThresholds() on every 5 closes, so a one-shot cleanup is not enough.
  data.lessons = data.lessons.filter((l) => !String(l.rule || "").includes("AUTO-EVOLVED"));
  const afterAuto = data.lessons.length;
  data.lessons = data.lessons.filter((l) => !String(l.rule || "").includes("ZECK-SOL"));
  const afterZeck = data.lessons.length;

  // Anchor lesson is added only once (gated by marker tag).
  const hasAnchor = data.lessons.some(
    (l) => Array.isArray(l.tags) && l.tags.includes(BOOTSTRAP_TAG),
  );
  let anchorAdded = 0;
  if (!hasAnchor) {
    data.lessons.push({
      id: Date.now(),
      rule: ANCHOR_RULE,
      tags: ["screening", "config_change", "self_tune", BOOTSTRAP_TAG],
      outcome: "manual",
      sourceType: "config_change",
      pinned: true,
      role: "SCREENER",
      created_at: new Date().toISOString(),
    });
    anchorAdded = 1;
  }

  const removed = {
    auto_evolved: before - afterAuto,
    zeck_sol: afterAuto - afterZeck,
    anchor_added: anchorAdded,
  };
  const changed = removed.auto_evolved + removed.zeck_sol + removed.anchor_added > 0;
  if (changed) save(data);

  log(
    "bootstrap",
    `clean-stale-lessons: removed ${removed.auto_evolved} AUTO-EVOLVED, ` +
      `${removed.zeck_sol} ZECK-SOL; anchor ${anchorAdded ? "added" : "kept"}; ` +
      `total ${before} → ${data.lessons.length}`,
  );
  return { removed, totalBefore: before, totalAfter: data.lessons.length };
}

if (
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}` ||
  import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, "/") || "")
) {
  cleanStaleLessons();
}
