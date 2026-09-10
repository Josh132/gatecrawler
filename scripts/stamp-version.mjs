#!/usr/bin/env node
// Refresh the BUILD / BUILD_DATE / BUILD_REV fields of src/version.js from git.
// VERSION itself is hand-maintained and never touched here.
//
//   node scripts/stamp-version.mjs           rewrite src/version.js from HEAD
//   node scripts/stamp-version.mjs --check    used by the pre-push hook: exit 1
//                                             only if the stamp is clearly stale
//                                             (>1 commit behind), touch nothing
//
// Normal flow:  make your commits  ->  npm run stamp  ->  git commit -am "chore: stamp"  ->  git push
// BUILD is the commit count; BUILD_REV is `git describe` (shows the latest tag,
// e.g. v0.1.0 or v0.1.0-3-gabc123, or a bare short hash before any tag).

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'src', 'version.js');
const check = process.argv.includes('--check');
const git = (a) => execSync('git ' + a, { cwd: ROOT }).toString().trim();

let build, date, rev;
try {
  build = parseInt(git('rev-list --count HEAD'), 10);
  date = git('log -1 --format=%cs');
  rev = git('describe --tags --always --dirty');
} catch (e) {
  console.error('stamp-version: not a git checkout — skipping (' + (e && e.message) + ')');
  process.exit(0);
}

const src = readFileSync(FILE, 'utf8');
const fileBuild = parseInt((src.match(/export const BUILD = (\d+)/) || [])[1] || '0', 10);

if (check) {
  // tolerate a single un-stamped "chore: stamp" commit on top; block real drift
  if (build - fileBuild > 1) {
    console.error(
      `\n  src/version.js is stale — it says build ${fileBuild}, HEAD is ${build}.\n` +
        '  Run:  npm run stamp  &&  git commit -am "chore: stamp version"\n'
    );
    process.exit(1);
  }
  process.exit(0);
}

const stamped = src
  .replace(/export const BUILD = .*;/, `export const BUILD = ${build};`)
  .replace(/export const BUILD_DATE = .*;/, `export const BUILD_DATE = '${date}';`)
  .replace(/export const BUILD_REV = .*;/, `export const BUILD_REV = '${rev}';`);

if (stamped === src) {
  console.log(`version.js already current — build ${build}, ${rev}`);
} else {
  writeFileSync(FILE, stamped);
  console.log(`version.js stamped -> build ${build}, ${date}, ${rev}`);
}
