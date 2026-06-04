/**
 * Verify r20 redeploy gate + catastrophic loss config.
 *
 * Usage: node scripts/verify-r20-config.js
 */

import("./config.js").then((m) => {
  const c = m.config.management;
  console.log("netPnl gate: " + c.repeatDeployCooldownMinNetPnlPct);
  console.log("catastrophicPct: " + c.catastrophicLossPct);
  console.log("cooldownDays: " + c.catastrophicLossCooldownDays);
  console.log("---");
  console.log("repeatDeployCooldownEnabled: " + c.repeatDeployCooldownEnabled);
  console.log("repeatDeployCooldownHours: " + c.repeatDeployCooldownHours);
  console.log("repeatDeployCooldownScope: " + c.repeatDeployCooldownScope);
});
