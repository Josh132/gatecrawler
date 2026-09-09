---
name: gatecrawler-dev
description: Build, test, and screenshot the Gate Crawler game. Use for any code work in ~/.local/share/gatecrawler — running the harness, seed sweeps, headless screenshots, the commit convention, and the architecture rules (canvas 2D, no build step, sub-modes not new g.state).
---

# Gate Crawler dev

Procedural top-down Stargate SG-1 twin-stick roguelite. Vanilla ES modules + HTML5
canvas 2D. **No build step.** Repo: `~/.local/share/gatecrawler`, branch `master`.

Full map (modules, data flow, the `g` object, "where to change what") is in
**`ARCHITECTURE.md`** at the repo root — read it before non-trivial work.

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
syntax gate — `game.js` is ~9k lines and slow to fail in the harness. The harness calls
`render()` every frame against a mock ctx, so a broken import or missing reference in
draw code also fails it.

## Screenshots (headless)

```
GATECRAWLER_PORT=8777 python3 server.py &     # serves on 127.0.0.1:8777
```

Then load `test/play-shot.html` with query params via headless chromium. Wrap the
chromium call in `timeout 30 …` — it sometimes hangs on exit:

```
timeout 30 chromium --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1200,760 --screenshot=out.png \
  "http://127.0.0.1:8777/test/play-shot.html?nofx&hub"
```

- `?nofx` — skip the WebGL colour grade (swiftshader chokes on readback). Use always headless.
- `?f=600` — frames to simulate before the shot (bot auto-plays toward the DHD).
- `?hub` — land in the SGC hub floor. `?hub=<kind>` opens a station panel
  (`workbench`, `operations`, `base`, `roster`, `research`, `infirmary`, `requisitions`).
- `?hub&room=<kind>` — frame one named hub room (kinds in `src/hub.js` ROOMS).
- `?panel` — open the inventory/panel UI.

Backgrounded `python3 server.py` procs are flaky — they get culled. Harness PASS is the
real gate; treat screenshots as best-effort. Agents can self-screenshot.

## Navigating game.js

Still the big file, but sectioned. The header comment is a table of contents;
jump to a section by searching its marker, e.g. `// ▸ enemy AI`, `// ▸ combat`,
`// ▸ render`, `// ▸ spawning`. Markers: save · effects · createGame · run
lifecycle · update · spawning · special rooms · combat · enemy AI · new enemy
kinds · squad AI · traps · camera · render · fake-3d light · lights · HUD ·
loadout panel · pause + settings · front-of-house UI · roster / base ops /
operations / workbench · debrief.

Prefer editing the **sibling module** when the change fits one — visual polish
in `fx.js`, line of sight in `vis.js`, weapon numbers in `weapons.js`, etc. —
so two people can work without colliding in `game.js`.

## Architecture rules (do not break)

- `checkInvariants` asserts `g.state ∈ {menu, play, gatemap, dead}` **only**. Any new UI
  screen (pause, debrief, roster, stash, research tabs…) must be a **sub-mode** — a flag
  on `g` read inside an existing state — never a new `g.state` string. Debrief folds onto
  `'dead'` and reads outcome from `g.debrief`.
- Worldgen is seeded + deterministic: `worldParams(addr, hop)`, `neighbors(addr, count)`,
  `buildWorld` → room graph, `bakeWorld` → offscreen canvas. Never introduce
  `Math.random()` into worldgen — use the address hash stream (`hashStr`). `rr` (from
  `rng.js`) is unseeded and **cosmetic only** (particles, shake) — never in worldgen.
- Rooms 15×11 tiles, `TILE=34`, `WALL_H=16`. `room.props` tiles are `grid=1` (block LOS +
  bullets). `BIOMES` table lives in `src/worldgen.js`.
- `ctx.textAlign` / `ctx.textBaseline` leak between render fns — `render()` resets them
  each frame; any fn that sets them must reset before returning (`textReset(ctx)` from
  `draw.js`).
- Save: `defaultSave()` + `normalizeSave(s)` (localStorage). Every new save key needs a
  default in both. Harness has mirrored `DEFAULTS` for tech/branches — update it too.
- No top-level `await` in `game.js` — all imports are static. Keep it that way so
  circular-import splits stay possible.

## Key modules

- `src/game.js` — core loop, the state machine, all `update*`/`render*`. Still the
  contention point: try to land a change in a sibling module instead.
- `src/fx.js` — particles (`spark`/`burst`/`kawoosh`), `addShake`, `addFlash`, decals
  (`addDecal`/`scorch`/`splat`/`ejectCasing`), `biomeImpact`/`biomeDust`. One-way: it
  pushes onto `g.particles`/`g.flashes`/`g.decals`, never calls back into game.js.
  ⚠️ Not to be confused with `fx(g)` in game.js, which folds tech/roster/base effects.
- `src/vis.js` — `computeVisPoly`, `drawFog`, `litAt(g,x,y)`. Pure geometry.
- `src/draw.js` — canvas toolkit + shared `hexA` / `textReset` / `wrapText` / `wrapLines`.
- `src/weapons.js` WEAPONS table · `src/weaponmods.js` `weaponStats(wid, state, techMul)`
  → mults + `altFire` tag · `src/tech.js` 69-node tree · `src/campaign.js` OPERATIONS +
  FINALE · `src/roster.js` SG teams + BASE_UPGRADES · `src/entities.js` enemy classes
  (incl. `nexus` finale boss) · `src/worldgen.js` BIOMES + rooms · `src/textures.js`
  procedural art · `src/audio.js` synth sfx/beds · `src/hub.js` SGC layout.
- `fx(g)` (in game.js) = folded tech effects + `applyRoster` + base-upgrade effects.
  Read it, don't re-fold.

## Commit convention

Commit **only when asked**. If on `master`, that's fine here (solo repo).

```
git -c user.name=gatecrawler -c user.email=dev@localhost commit -q -m "area: summary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014RE9gAnFvL6tbQNmHAhGHC"
```

Prefix `area:` = `combat`, `worldgen`, `hub`, `ui`, `tech`, `campaign`, `audio`,
`test`, `refactor`, `docs`.
