import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Load the repo-root .env once (Next only reads web/.env by default). */
let loaded = false;
export function loadRootEnv() {
  if (loaded) return;
  loaded = true;
  const p = path.join(process.cwd(), '..', '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
