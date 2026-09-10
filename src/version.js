// ── Version ──────────────────────────────────────────────────────────────────
// VERSION is bumped BY HAND on a real release. Semver-ish:
//   patch  0.1.x — bug fixes / tuning only
//   minor  0.x.0 — new features, save stays compatible
//   major  x.0.0 — a save-breaking or sweeping change  (also bump SAVE_SCHEMA)
//
// BUILD / BUILD_DATE / BUILD_REV below are regenerated from git by
//   node scripts/stamp-version.mjs        (npm run stamp)
// and the pre-push hook refuses to push if they're stale — so the string on the
// main menu always matches the commit that's actually deployed.
export const VERSION = '0.1.0';
export const BUILD = 133;
export const BUILD_DATE = '2026-09-10';
export const BUILD_REV = 'v0.1.0-8-g8562445';

export const versionLine = () => `v${VERSION}  ·  build ${BUILD}  ·  ${BUILD_DATE}  ·  ${BUILD_REV}`;
