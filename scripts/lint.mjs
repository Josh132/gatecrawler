#!/usr/bin/env node
// Tiny dependency-free hygiene linter for Gate Crawler.
//
// Fails (exit 1) on:
//   - Math.random( or a bare rr( call in src/worldgen.js or src/address.js
//     (worldgen must stay seeded + deterministic)
//   - a g.state = '<x>' assignment in any src/*.js where <x> is not one of the
//     four legal states plus the walkable hub
// Warns (no exit code) on:
//   - a leftover console.log( in any src/*.js
//
// Run: node scripts/lint.mjs   (wired as `npm run lint`)

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const LEGAL_STATES = new Set(['menu', 'play', 'hub', 'gatemap', 'dead']);
const SEEDED_ONLY = ['worldgen.js', 'address.js'];

const failures = [];
const warnings = [];

const srcFiles = readdirSync(SRC)
  .filter((f) => f.endsWith('.js'))
  .sort();

for (const name of srcFiles) {
  const path = join(SRC, name);
  const lines = readFileSync(path, 'utf8').split('\n');
  const rel = `src/${name}`;

  lines.forEach((line, i) => {
    const ln = i + 1;

    // strip line comments so commented-out code doesn't trip the linter
    const code = line.replace(/\/\/.*$/, '');

    if (SEEDED_ONLY.includes(name)) {
      if (/Math\.random\s*\(/.test(code)) {
        failures.push(`${rel}:${ln}  Math.random( in seeded worldgen module`);
      }
      if (/\brr\s*\(/.test(code)) {
        failures.push(`${rel}:${ln}  rr( (unseeded cosmetic RNG) in seeded worldgen module`);
      }
    }

    // g.state = '<x>'  (assignment, not comparison — '=' not followed by '=')
    const m = code.match(/\bg\.state\s*=\s*(['"`])([^'"`]*)\1/);
    if (m && !LEGAL_STATES.has(m[2])) {
      failures.push(`${rel}:${ln}  g.state = '${m[2]}' — not a legal state (use a sub-mode flag)`);
    }

    if (/console\.log\s*\(/.test(code)) {
      warnings.push(`${rel}:${ln}  ${line.trim()}`);
    }
  });
}

for (const w of warnings) console.warn(`WARN  ${w}`);
for (const f of failures) console.error(`FAIL  ${f}`);

if (failures.length) {
  console.error(`\nlint: FAIL — ${failures.length} error(s), ${warnings.length} warning(s)`);
  process.exit(1);
}
console.log(`\nlint: PASS — 0 errors, ${warnings.length} warning(s)`);
