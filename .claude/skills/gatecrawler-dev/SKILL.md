---
name: gatecrawler-dev
description: Build, test, and screenshot the Gate Crawler game. Use for any code work in ~/.local/share/gatecrawler — running the harness, seed sweeps, headless screenshots, the commit convention, and the architecture rules (canvas 2D, no build step, sub-modes not new g.state).
---

# Gate Crawler dev

Procedural top-down Stargate SG-1 twin-stick roguelite. Vanilla ES modules + HTML5
canvas 2D. **No build step.** Repo: `~/.local/share/gatecrawler`, branch `master`.

## Test (the gate — always run before commit)

```
node test/harness.mjs                 # must print  RESULT: PASS
SEED=<n> node test/harness.mjs        # seeded run; want RESULT: PASS + "failsafe used 0x"
```

Seed sweep before every commit that touches gameplay:

```
for s in 2 999 12345 7 42 88888 314159 31337 777 55; do
  SEED=$s node test/harness.mjs 2>&1 | grep -E "RESULT|failsafe"
done
```

All must be `PASS` with `failsafe used 0x`. `node --check src/<file>.js` first for a fast
syntax gate — game.js is ~8k lines and slow to fail in the harness.

## Screenshots (headless)

```
GATECRAWLER_PORT=8777 python3 server.py &     # serves on 127.0.0.1:8777
```

Then load `test/play-shot.html` with query params via headless chromium:

- `?nofx` — skip the WebGL colour grade (swiftshader chokes on readback). Use always headless.
- `?f=600` — frames to simulate before the shot (bot auto-plays toward the DHD).
- `?hub` — land in the SGC hub floor. `?hub=<kind>` opens a station panel
  (`workbench`, `operations`, `base`, `roster`, `research`, `infirmary`, `requisitions`).
- `?hub&room=<kind>` — frame one named hub room (kinds in `src/hub.js` ROOMS).
- `?panel` — open the inventory/panel UI.

Backgrounded `python3 server.py` procs are flaky — they get culled. Harness PASS is the
real gate; treat screenshots as best-effort. Agents can self-screenshot.

## Architecture rules (do not break)

- `checkInvariants` asserts `g.state ∈ {menu, play, gatemap, dead}` **only**. Any new UI
  screen (pause, debrief, roster, stash, research tabs…) must be a **sub-mode** — a flag
  on `g` read inside an existing state — never a new `g.state` string. Debrief folds onto
  `'dead'` and reads outcome from `g.debrief`.
- Worldgen is seeded + deterministic: `worldParams(addr, hop)`, `neighbors(addr, count)`,
  `buildWorld` → room graph, `bakeWorld` → offscreen canvas. Never introduce
  `Math.random()` into worldgen — use the address hash stream (`hashStr`).
- Rooms 15×11 tiles, `TILE=34`, `WALL_H=16`. `room.props` tiles are `grid=1` (block LOS +
  bullets). `BIOMES` table lives in `src/worldgen.js`.
- `ctx.textAlign` / `ctx.textBaseline` leak between render fns — `render()` resets them
  each frame; any fn that sets them must reset before returning.
- Save: `defaultSave()` + `normalizeSave(s)` (localStorage). Every new save key needs a
  default in both. Harness has mirrored `DEFAULTS` for tech/branches — update it too.

## Key modules

- `src/game.js` — core loop, all update*/render*. The serialization bottleneck: only one
  agent edits it at a time.
- `src/weapons.js` WEAPONS table · `src/weaponmods.js` `weaponStats(wid, state, techMul)`
  → mults + `altFire` tag · `src/tech.js` 69-node tree · `src/campaign.js` OPERATIONS +
  FINALE · `src/roster.js` SG teams + BASE_UPGRADES · `src/entities.js` enemy classes
  (incl. `nexus` finale boss) · `src/worldgen.js` BIOMES + rooms · `src/textures.js` +
  `src/draw.js` procedural art · `src/audio.js` synth sfx/beds · `src/hub.js` SGC layout.
- `fx(g)` = folded tech effects + `applyRoster` + base-upgrade effects. Read it, don't
  re-fold.

## Commit convention

Commit **only when asked**. If on `master`, that's fine here (solo repo).

```
git -c user.name=gatecrawler -c user.email=dev@localhost commit -q -m "area: summary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014RE9gAnFvL6tbQNmHAhGHC"
```

Prefix `area:` = `combat`, `worldgen`, `hub`, `ui`, `tech`, `campaign`, `audio`, `test`.
