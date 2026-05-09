/**
 * envcrypt.js — env loader with optional AES-256-GCM decryption.
 *
 * Behavior:
 *  1. Load .env via dotenv/config (standard plaintext path).
 *  2. If .env.enc + ENV_ENCRYPTION_KEY (32 bytes hex) present, decrypt and merge
 *     into process.env. Decrypted keys override plaintext .env.
 *  3. If neither present, run silently — process.env still populated by host.
 *
 * Imported as side-effect from index.js / setup.js. Must be safe to load before
 * any other module that reads process.env.
 *
 * Encrypt format (.env.enc):
 *   <iv-hex>:<authTag-hex>:<ciphertext-hex>
 * Plaintext is the same format as .env (KEY=VALUE per line).
 *
 * To encrypt:
 *   node scripts/envrypt.js encrypt   (script not yet implemented; this file
 *   is decrypt-only for now — add encryption helper later if needed).
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENC_PATH  = path.join(__dirname, ".env.enc");

function decryptEnv() {
  const key = process.env.ENV_ENCRYPTION_KEY;
  if (!key || !fs.existsSync(ENC_PATH)) return;

  try {
    const keyBuf = Buffer.from(key, "hex");
    if (keyBuf.length !== 32) {
      console.error("[envcrypt] ENV_ENCRYPTION_KEY must be 32 bytes (64 hex chars). Skipping decrypt.");
      return;
    }

    const blob = fs.readFileSync(ENC_PATH, "utf8").trim();
    const [ivHex, tagHex, dataHex] = blob.split(":");
    if (!ivHex || !tagHex || !dataHex) {
      console.error("[envcrypt] .env.enc malformed. Expected iv:tag:ciphertext.");
      return;
    }

    const iv     = Buffer.from(ivHex,  "hex");
    const tag    = Buffer.from(tagHex, "hex");
    const cipher = Buffer.from(dataHex, "hex");

    const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(cipher), decipher.final()]).toString("utf8");

    let count = 0;
    for (const line of plaintext.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Z0-9_]+)=(.*)$/i);
      if (!m) continue;
      const k = m[1];
      const v = m[2].replace(/^["']|["']$/g, "");
      process.env[k] = v;
      count++;
    }

    console.log(`[envcrypt] Loaded ${count} encrypted env var(s) from .env.enc`);
  } catch (err) {
    console.error(`[envcrypt] Decrypt failed: ${err.message}`);
  }
}

decryptEnv();
