/**
 * Chart Indicators — fetches RSI, Bollinger Bands, Supertrend, and Fibonacci
 * from the Agent Meridian API and evaluates entry/exit preset conditions.
 *
 * Falls back silently when data is unavailable — this is confirmation logic only,
 * not a replacement for the existing strategy.
 */

import { config } from "./config.js";
import { log } from "./logger.js";

// ═══════════════════════════════════════════
//  API FETCH
// ═══════════════════════════════════════════

/**
 * Fetch chart indicators for a given token mint.
 *
 * @param {string} mint - Token mint address
 * @param {object} [opts] - Optional overrides
 * @param {string[]} [opts.intervals] - e.g. ["5_MINUTE"]
 * @param {number}  [opts.rsiLength] - RSI period length
 * @returns {object|null} - Indicator data or null on failure
 */
export async function fetchChartIndicators(mint, opts = {}) {
  const cfg = config.indicators;
  if (!cfg?.enabled) return null;

  const apiUrl = config.api.url;
  if (!apiUrl) {
    log("indicators_warn", "agentMeridianApiUrl not configured — skipping chart indicators");
    return null;
  }

  const intervals = opts.intervals || cfg.intervals || ["5_MINUTE"];
  const rsiLength = opts.rsiLength || cfg.rsiLength || 14;

  try {
    const url = `${apiUrl}/chart-indicators`;
    const body = {
      mint,
      intervals,
      rsiLength,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      log("indicators_warn", `Chart indicators API returned ${response.status} for ${mint}`);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    log("indicators_warn", `Chart indicators fetch failed for ${mint}: ${error.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════
//  PRESET EVALUATORS
// ═══════════════════════════════════════════

/**
 * Extract the latest indicator values from the API response for a given interval.
 */
function extractLatest(data, interval = "5_MINUTE") {
  if (!data) return null;

  const intervalData = data[interval] || data.indicators?.[interval] || data;

  const rsi = intervalData.rsi?.value ?? intervalData.rsi ?? null;
  const supertrend = intervalData.supertrend ?? null;
  const bollinger = intervalData.bollinger ?? intervalData.bollingerBands ?? null;
  const fibonacci = intervalData.fibonacci ?? null;
  const price = intervalData.price ?? intervalData.close ?? null;

  return { rsi, supertrend, bollinger, fibonacci, price };
}

/**
 * Evaluate a preset condition.
 *
 * @param {string} preset - Preset name (e.g. "supertrend_break")
 * @param {object} indicators - Extracted indicator values
 * @param {"entry"|"exit"} direction - Whether this is an entry or exit check
 * @returns {{ confirmed: boolean, reason: string, signals: object }}
 */
function evaluatePreset(preset, indicators, direction = "entry") {
  if (!indicators) {
    return { confirmed: false, reason: "no indicator data", signals: {} };
  }

  const cfg = config.indicators || {};
  const oversold = cfg.rsiOversold ?? 30;
  const overbought = cfg.rsiOverbought ?? 80;

  const { rsi, supertrend, bollinger, fibonacci, price } = indicators;
  const signals = { rsi, supertrend: supertrend?.direction ?? supertrend?.trend, price };

  switch (preset) {
    // ── supertrend_break ──────────────────
    case "supertrend_break": {
      const stDirection = supertrend?.direction ?? supertrend?.trend;
      if (stDirection == null) return { confirmed: false, reason: "supertrend data unavailable", signals };
      if (direction === "entry") {
        const confirmed = stDirection === "up" || stDirection === "bullish" || stDirection === 1;
        return { confirmed, reason: confirmed ? "supertrend bullish" : "supertrend bearish — no entry", signals };
      } else {
        const confirmed = stDirection === "down" || stDirection === "bearish" || stDirection === -1;
        return { confirmed, reason: confirmed ? "supertrend bearish — exit" : "supertrend still bullish — hold", signals };
      }
    }

    // ── rsi_reversal ─────────────────────
    case "rsi_reversal": {
      if (rsi == null) return { confirmed: false, reason: "RSI data unavailable", signals };
      if (direction === "entry") {
        const confirmed = rsi <= oversold;
        return { confirmed, reason: confirmed ? `RSI ${rsi.toFixed(1)} ≤ ${oversold} — oversold entry` : `RSI ${rsi.toFixed(1)} — not oversold`, signals };
      } else {
        const confirmed = rsi >= overbought;
        return { confirmed, reason: confirmed ? `RSI ${rsi.toFixed(1)} ≥ ${overbought} — overbought exit` : `RSI ${rsi.toFixed(1)} — not overbought`, signals };
      }
    }

    // ── bollinger_reversion ──────────────
    case "bollinger_reversion": {
      if (!bollinger || price == null) return { confirmed: false, reason: "Bollinger data unavailable", signals };
      const lower = bollinger.lower ?? bollinger.lowerBand;
      const upper = bollinger.upper ?? bollinger.upperBand;
      if (lower == null || upper == null) return { confirmed: false, reason: "Bollinger bands incomplete", signals };
      if (direction === "entry") {
        const confirmed = price <= lower;
        return { confirmed, reason: confirmed ? `price ${price} ≤ BB lower ${lower} — reversion entry` : `price ${price} above BB lower`, signals: { ...signals, bb_lower: lower, bb_upper: upper } };
      } else {
        const confirmed = price >= upper;
        return { confirmed, reason: confirmed ? `price ${price} ≥ BB upper ${upper} — reversion exit` : `price ${price} below BB upper`, signals: { ...signals, bb_lower: lower, bb_upper: upper } };
      }
    }

    // ── rsi_plus_supertrend ──────────────
    case "rsi_plus_supertrend": {
      const stResult = evaluatePreset("supertrend_break", indicators, direction);
      const rsiResult = evaluatePreset("rsi_reversal", indicators, direction);
      const confirmed = stResult.confirmed && rsiResult.confirmed;
      return {
        confirmed,
        reason: confirmed
          ? `BOTH confirmed: ${stResult.reason} + ${rsiResult.reason}`
          : `NOT confirmed: ST=${stResult.confirmed}, RSI=${rsiResult.confirmed}`,
        signals,
      };
    }

    // ── supertrend_or_rsi ────────────────
    case "supertrend_or_rsi": {
      const stResult = evaluatePreset("supertrend_break", indicators, direction);
      const rsiResult = evaluatePreset("rsi_reversal", indicators, direction);
      const confirmed = stResult.confirmed || rsiResult.confirmed;
      return {
        confirmed,
        reason: confirmed
          ? `confirmed: ${stResult.confirmed ? stResult.reason : rsiResult.reason}`
          : `neither ST nor RSI confirmed`,
        signals,
      };
    }

    // ── bb_plus_rsi ──────────────────────
    case "bb_plus_rsi": {
      const bbResult = evaluatePreset("bollinger_reversion", indicators, direction);
      const rsiResult = evaluatePreset("rsi_reversal", indicators, direction);
      const confirmed = bbResult.confirmed && rsiResult.confirmed;
      return {
        confirmed,
        reason: confirmed
          ? `BOTH confirmed: ${bbResult.reason} + ${rsiResult.reason}`
          : `NOT confirmed: BB=${bbResult.confirmed}, RSI=${rsiResult.confirmed}`,
        signals,
      };
    }

    // ── fibo_reclaim ─────────────────────
    case "fibo_reclaim": {
      if (!fibonacci || price == null) return { confirmed: false, reason: "Fibonacci data unavailable", signals };
      // Check if price is reclaiming above a key fib level (0.618 or 0.5)
      const level618 = fibonacci["0.618"] ?? fibonacci.level_618 ?? null;
      const level500 = fibonacci["0.5"] ?? fibonacci.level_500 ?? null;
      const fiboLevel = level618 ?? level500;
      if (fiboLevel == null) return { confirmed: false, reason: "Fibonacci levels incomplete", signals };
      if (direction === "entry") {
        const confirmed = price >= fiboLevel;
        return { confirmed, reason: confirmed ? `price ${price} reclaimed fib ${fiboLevel}` : `price ${price} below fib ${fiboLevel}`, signals: { ...signals, fibo_level: fiboLevel } };
      } else {
        // Exit if price drops back below fib level
        const confirmed = price < fiboLevel;
        return { confirmed, reason: confirmed ? `price ${price} lost fib ${fiboLevel} — exit` : `price ${price} above fib ${fiboLevel} — hold`, signals: { ...signals, fibo_level: fiboLevel } };
      }
    }

    // ── fibo_reject ──────────────────────
    case "fibo_reject": {
      if (!fibonacci || price == null) return { confirmed: false, reason: "Fibonacci data unavailable", signals };
      const resist = fibonacci["0.786"] ?? fibonacci.level_786 ?? fibonacci["0.618"] ?? fibonacci.level_618 ?? null;
      if (resist == null) return { confirmed: false, reason: "Fibonacci resistance level incomplete", signals };
      if (direction === "entry") {
        // Entry when price pulls back from resistance (i.e. price is below fib resistance)
        const confirmed = price < resist;
        return { confirmed, reason: confirmed ? `price ${price} below fib resistance ${resist} — rejection entry` : `price ${price} at/above fib resistance`, signals: { ...signals, fibo_resist: resist } };
      } else {
        // Exit when price reaches resistance
        const confirmed = price >= resist;
        return { confirmed, reason: confirmed ? `price ${price} ≥ fib resistance ${resist} — rejection exit` : `price ${price} below fib resistance — hold`, signals: { ...signals, fibo_resist: resist } };
      }
    }

    default:
      return { confirmed: false, reason: `unknown preset: ${preset}`, signals };
  }
}

// ═══════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════

/**
 * Check entry confirmation for a token.
 *
 * @param {string} mint - Token mint address
 * @returns {{ confirmed: boolean, reason: string, signals: object, preset: string }|null}
 */
export async function checkEntryConfirmation(mint) {
  const cfg = config.indicators;
  if (!cfg?.enabled || !cfg?.entryPreset) return null;

  try {
    const data = await fetchChartIndicators(mint);
    if (!data) return null;

    const interval = (cfg.intervals?.[0]) || "5_MINUTE";
    const indicators = extractLatest(data, interval);
    const result = evaluatePreset(cfg.entryPreset, indicators, "entry");

    log("indicators", `Entry check [${cfg.entryPreset}] for ${mint.slice(0, 8)}...: ${result.confirmed ? "✅" : "❌"} ${result.reason}`);

    return { ...result, preset: cfg.entryPreset };
  } catch (error) {
    log("indicators_warn", `Entry confirmation error: ${error.message}`);
    return null;
  }
}

/**
 * Check exit confirmation for a token.
 *
 * @param {string} mint - Token mint address
 * @returns {{ confirmed: boolean, reason: string, signals: object, preset: string }|null}
 */
export async function checkExitConfirmation(mint) {
  const cfg = config.indicators;
  if (!cfg?.enabled || !cfg?.exitPreset) return null;

  try {
    const data = await fetchChartIndicators(mint);
    if (!data) return null;

    const interval = (cfg.intervals?.[0]) || "5_MINUTE";
    const indicators = extractLatest(data, interval);
    const result = evaluatePreset(cfg.exitPreset, indicators, "exit");

    log("indicators", `Exit check [${cfg.exitPreset}] for ${mint.slice(0, 8)}...: ${result.confirmed ? "✅" : "❌"} ${result.reason}`);

    return { ...result, preset: cfg.exitPreset };
  } catch (error) {
    log("indicators_warn", `Exit confirmation error: ${error.message}`);
    return null;
  }
}

/**
 * Get a compact summary string of indicator data for a token (for LLM context).
 *
 * @param {string} mint - Token mint address
 * @returns {string|null}
 */
export async function getIndicatorSummary(mint) {
  const cfg = config.indicators;
  if (!cfg?.enabled) return null;

  try {
    const data = await fetchChartIndicators(mint);
    if (!data) return null;

    const interval = (cfg.intervals?.[0]) || "5_MINUTE";
    const ind = extractLatest(data, interval);
    if (!ind) return null;

    const parts = [];
    if (ind.rsi != null) parts.push(`RSI=${ind.rsi.toFixed(1)}`);
    if (ind.supertrend) {
      const dir = ind.supertrend.direction ?? ind.supertrend.trend ?? ind.supertrend;
      parts.push(`ST=${dir}`);
    }
    if (ind.bollinger) {
      const lower = ind.bollinger.lower ?? ind.bollinger.lowerBand ?? "?";
      const upper = ind.bollinger.upper ?? ind.bollinger.upperBand ?? "?";
      const mid = ind.bollinger.middle ?? ind.bollinger.middleBand ?? "?";
      parts.push(`BB=${lower}/${mid}/${upper}`);
    }
    if (ind.fibonacci) {
      const levels = Object.entries(ind.fibonacci)
        .filter(([k, v]) => v != null && !k.startsWith("level_"))
        .map(([k, v]) => `${k}=${v}`)
        .slice(0, 3);
      if (levels.length) parts.push(`Fib=[${levels.join(",")}]`);
    }
    if (ind.price != null) parts.push(`price=${ind.price}`);

    if (parts.length === 0) return null;

    // Add entry/exit confirmation status
    const entryResult = cfg.entryPreset ? evaluatePreset(cfg.entryPreset, ind, "entry") : null;
    const exitResult = cfg.exitPreset ? evaluatePreset(cfg.exitPreset, ind, "exit") : null;

    let summary = `[${interval}] ${parts.join(" | ")}`;
    if (entryResult) summary += ` | entry(${cfg.entryPreset}): ${entryResult.confirmed ? "✅" : "❌"}`;
    if (exitResult) summary += ` | exit(${cfg.exitPreset}): ${exitResult.confirmed ? "✅" : "❌"}`;

    return summary;
  } catch (error) {
    log("indicators_warn", `Indicator summary failed for ${mint}: ${error.message}`);
    return null;
  }
}
