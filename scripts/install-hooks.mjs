#!/usr/bin/env node
// Copy scripts/hooks/* into .git/hooks/ and make them executable.  npm run hooks
import { readdirSync, copyFileSync, chmodSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'scripts', 'hooks');
const DST = join(ROOT, '.git', 'hooks');

mkdirSync(DST, { recursive: true });
for (const f of readdirSync(SRC)) {
  const to = join(DST, f);
  copyFileSync(join(SRC, f), to);
  chmodSync(to, 0o755);
  console.log(`installed .git/hooks/${f}`);
}
