/**
 * Shared data directory utility.
 * Uses DATA_DIR env var (for Docker volumes) or current directory.
 * Auto-creates the directory on import so writes never fail with ENOENT.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname;

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
  console.error(`[data-dir] Failed to create ${DATA_DIR}: ${err.message}`);
}

export function dataPath(filename) {
  return path.join(DATA_DIR, filename);
}

export { DATA_DIR };
