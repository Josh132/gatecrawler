#!/usr/bin/env node
// Refresh the build stamp from git. VERSION in src/version.js is hand-maintained
// and never touched here.
//
//   node scripts/stamp-version.mjs           rewrite version.js + index.html
//   node scripts/stamp-version.mjs --check    used by the pre-push hook: exit 1
//                                             only if clearly stale, touch nothing
//
// Normal flow:  make your commits  ->  npm run stamp  ->  git commit -am "chore: stamp"  ->  git push
//
// Stamps:
//   src/version.js  — BUILD (commit count), BUILD_DATE, BUILD_REV (git describe)
//   index.html      — the main.js / style.css URLs get ?v=<BUILD> so a redeploy
//                     forces a fresh entry + stylesheet
// (Deep module files aren't query-busted — that would create duplicate module
//  instances and break the test harness's module sharing. GitHub Pages serves
//  JS with a 10-minute max-age; the build number on the menu tells you what
//  actually loaded, and a private tab / cache clear forces fresh immediately.)

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const git = (a) => execSync('git ' + a, { cwd: ROOT }).toString().trim();

let build, date, rev;
try {
  build = parseInt(git('rev-list --count HEAD'), 10);
  date = git('log -1 --format=%cs');
  rev = git('describe --tags --always');
} catch (e) {
  console.error('stamp-version: not a git checkout — skipping (' + (e && e.message) + ')');
  process.exit(0);
}

const VFILE = join(ROOT, 'src', 'version.js');
const vsrc = readFileSync(VFILE, 'utf8');
const fileBuild = parseInt((vsrc.match(/export const BUILD = (\d+)/) || [])[1] || '0', 10);

if (check) {
  if (build - fileBuild > 1) {
    console.error(
      `\n  src/version.js is stale — it says build ${fileBuild}, HEAD is ${build}.\n` +
        '  Run:  npm run stamp  &&  git commit -am "chore: stamp version"\n'
    );
    process.exit(1);
  }
  process.exit(0);
}

let touched = 0;
const put = (path, next, was) => {
  if (next !== was) {
    writeFileSync(path, next);
    touched++;
  }
};

put(
  VFILE,
  vsrc
    .replace(/export const BUILD = .*;/, `export const BUILD = ${build};`)
    .replace(/export const BUILD_DATE = .*;/, `export const BUILD_DATE = '${date}';`)
    .replace(/export const BUILD_REV = .*;/, `export const BUILD_REV = '${rev}';`),
  vsrc
);

const IFILE = join(ROOT, 'index.html');
const isrc = readFileSync(IFILE, 'utf8');
put(
  IFILE,
  isrc
    .replace(/(src=")(src\/main\.js)(?:\?v=[^"]*)?(")/, `$1$2?v=${build}$3`)
    .replace(/(href=")(style\.css)(?:\?v=[^"]*)?(")/, `$1$2?v=${build}$3`),
  isrc
);

console.log(
  touched
    ? `stamped build ${build} (${date}, ${rev}) — ${touched} file(s)`
    : `already current — build ${build}, ${rev}`
);
