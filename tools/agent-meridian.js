/**
 * Agent Meridian API helpers.
 * Centralises base-URL, auth headers, and JSON fetch for all tools.
 */
import { config } from "../config.js";

const DEFAULT_PUBLIC_KEY = "bWVyaWRpYW4taXMtdGhlLWJlc3QtYWdlbnRz";

export function getAgentMeridianBase() {
  return config.api.url;
}

export function getAgentMeridianHeaders({ json = false } = {}) {
  const key = config.api.publicApiKey || DEFAULT_PUBLIC_KEY;
  const h = { "x-api-key": key };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

/** Returns the agentId to attach to relay requests. */
export function getAgentIdForRequests() {
  return config.hiveMind?.agentId ?? null;
}

/**
 * Fetch a JSON endpoint on the Agent Meridian API.
 * Throws a descriptive error on non-2xx.
 */
export async function agentMeridianJson(path, fetchOpts = {}) {
  const url = `${getAgentMeridianBase()}${path}`;
  const res = await fetch(url, fetchOpts);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AgentMeridian ${res.status} ${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
}
