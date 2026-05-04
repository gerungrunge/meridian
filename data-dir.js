/**
 * Shared data directory utility.
 * Uses DATA_DIR env var (for Docker volumes) or current directory.
 */

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname;

export function dataPath(filename) {
  return path.join(DATA_DIR, filename);
}

export { DATA_DIR };
