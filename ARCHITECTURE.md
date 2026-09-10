# Gate Crawler — architecture

Vanilla ES modules, **no build step**. `index.html` loads `src/main.js` as a
module; everything else is `import`ed from there. A tiny Python static server
(`server.py`) serves the folder for local play and for the headless test pages.

## The loop

`main.js` builds the game, wires input/audio, and hands `update` + `render` to
`loop.js`, a fixed-timestep runner: `update(1/60)` is called 0–5× per frame to
drain the accumulator, then `render(dt)` once. All simulation is in `update`;
`render` only draws.

## Module map

| module | owns |
|---|---|
| `main.js` | bootstrap: make the game, start input/audio/loop |
| `game.js` | the state machine + every gameplay and UI **system** (see below) |
| `enemydraw.js` | the figure/shadow render cluster: `drawShadow`, `drawHumanoid`, `drawPlayer`, `drawEnemy`, `enemyBuilds`, `FACTION_TINT` (one-way: game.js imports it) |
| `stationpanels.js` | the between-runs SGC console screens (roster / base ops / research / infirmary / operations + war map / workbench). `renderStationPanel` in game.js routes here; game.js ↔ this file is a render-time-only import cycle |
| `address.js` | gate glyphs, seed hashing, `neighbors(addr)`, `worldParams(addr, hop)` |
| `worldgen.js` | `worldParams` → room graph (`buildWorld`) → tile map → offscreen `bakeWorld`; the `BIOMES` table; `TILE` / `WALL_H` |
| `pathfind.js` | BFS flow field the enemy AI steers along |
| `entities.js` | `Player` / `Enemy` / `Bullet` / `Pickup` / `Grenade` / `Block` / `Particle` / `Decal` / `Hazard` / `Trap` / `Captive` / `Vendor` / `NexusPylon` classes; `circleVsGrid` collision; the `ENEMY_KIND` stat table |
| `weapons.js` | the base weapon stat table (`WEAPONS`) |
| `weaponmods.js` | per-weapon mastery + mod maths: `weaponStats(wid, state, techMul)`, XP curves, install/upgrade/scrap costs |
| `items.js` | gear + consumable catalogue (`ITEMS`), equip slots, rarity multipliers |
| `inventory.js` | grid / equipment / hotbar **state** + the pure move / equip / derive logic |
| `tech.js` | the research tree: `TECH` node data, `techEffects(ownedIds)` fold, `canResearch` gating |
| `campaign.js` | the Incursion campaign: `OPERATIONS`, `FINALE`, per-run event recording, progress/milestone tracking |
| `roster.js` | recoverable `SG_TEAMS` (permanent passives) + purchasable `BASE_UPGRADES` (naquadah sink) |
| `hub.js` | the walkable SGC: room layout, decor bake, station-console art, crew patrol sim |
| `icons.js` | procedural item icons + the rarity colour / label tables |
| `draw.js` | low-level canvas toolkit: shapes (`glowCircle`, `ngon`…), figures (`figure`, `spider`, `critter`), and shared text/colour utils (`hexA`, `textReset`, `wrapText`) |
| `textures.js` | procedural wall / floor / prop textures used by the world bake |
| `fx.js` | transient eye-candy: particles (`spark`/`burst`/`kawoosh`), screen shake, muzzle/hit flashes, persistent battlefield decals, per-biome impact dust |
| `vis.js` | line of sight: `computeVisPoly`, the fog draw, `litAt(g, x, y)` |
| `audio.js` | synth sfx, per-biome ambient beds, the evolving music bed |
| `postfx.js` | optional WebGL colour-grade pass composited over the 2D canvas |
| `rng.js` | `mulberry32` PRNG, `hashStr`, seeded `rngHelpers`, and unseeded `rr` (cosmetic only) |
| `input.js` | keyboard/mouse/gamepad capture + per-frame edge detection |
| `loop.js` | the fixed-timestep frame runner |

`game.js` is still the big one (~8k lines) but it is sectioned: open it and
search for the `// ▸ ` markers. The header comment lists every section and
restates the hard rules.

## Data flow of a run

```
address string ──worldParams(addr,hop)──▶ params {faction,biome,threat,mods,rooms}
                                              │
                                     buildWorld(params) ──▶ room graph + tile grid
                                              │
                                     bakeWorld(world)  ──▶ offscreen canvas (static art)
                                              │
                                     populateWorld(g)  ──▶ enemies / loot / hazards / specials
                                              │
   update ─▶ updatePlay: movement ▸ combat ▸ flow/room ▸ grenades ▸ heat ▸
                         hazards ▸ enemies ▸ projectiles ▸ compact ▸ room-clears ▸
                         camera ▸ combat-audio  (each an `update*` sub-function)
   render ─▶ computeVisPoly ▸ world bake ▸ decals ▸ entities ▸ fog ▸ lights ▸ HUD
```

The gate network is one fixed infinite graph: a world's neighbours and every
`param` are a pure function of `address + hop`, so a given address always leads
to the same worlds regardless of the path taken.

## The game object `g`

`createGame(canvas)` builds one long-lived object `g` and returns
`{ update, render }` closed over it. Everything is a field on `g`: `g.state`,
`g.player`, `g.world`, `g.enemies`, `g.bullets`, `g.particles`, `g.save`,
`g.inv`, `g.cam`, `g.view`, `g.time`, … Systems are plain functions
`doThing(g, …)` that read and mutate `g` — there is no `this`, no classes for
systems, no event bus.

## Invariants (the test harness enforces the first three)

- **`g.state ∈ {menu, play, hub, gatemap, dead}` — only.** Every other screen
  (pause, debrief, roster, research tabs, workbench, gate map overlay…) is a
  **sub-mode**: a flag on `g` (`g.paused`, `g.station`, `g.panelOpen`,
  `g.debrief`, …) read inside one of those five states. The post-run debrief
  folds onto `'dead'`. `'hub'` is the walkable SGC (no enemies) — the only
  full state added past the original four; do not add more.
- **Worldgen is seeded and deterministic.** Never call `Math.random()` — or
  `fx.js`'s `rr` — anywhere that feeds worldgen. Use the address hash stream
  (`hashStr` / `makeRng` / `rngHelpers`). `rr` is for cosmetic jitter only.
- **`checkInvariants`** asserts the state set and a few structural facts every
  frame under test.
- **Canvas text state leaks between frames.** `render()` resets
  `ctx.textAlign` / `textBaseline`; any function that sets them must reset before
  returning (`textReset(ctx)`).
- **Save schema.** A new `save` key needs a default in **both** `defaultSave()`
  and `normalizeSave()` in `game.js`, **and** a mirrored entry in the harness's
  `DEFAULTS` (tech/branch tables especially).

## Tests

```
node test/harness.mjs              # headless: worldgen, determinism, full play
SEED=42 node test/harness.mjs      # a specific seed; want PASS + "failsafe used 0x"
```

The harness runs the real modules against a mock 2D context, drives a bot
through hub → worlds → bosses → death/debrief for ~3000 frames, and asserts
~48k facts. It calls `render()` every frame, so a broken import or a missing
reference in draw code fails the run. Before any gameplay commit, sweep:

```
for s in 2 999 12345 7 42 88888 314159 31337 777 55; do
  SEED=$s node test/harness.mjs 2>&1 | grep -E "RESULT|failsafe"
done
```

`test/play-shot.html` renders the real game headless for screenshots
(`?nofx` to skip the WebGL grade, `?hub`, `?f=<frames>`, `?panel`, …).

## Where to change what

| you want to… | edit |
|---|---|
| tune a weapon | `weapons.js` (base) / `weaponmods.js` (mods + mastery) |
| add a weapon | `weapons.js`, `items.js` (the `w_*` item), `weaponmods.js` (mod list), `tech.js` (unlock node), `audio.js` (`sfx.fire` voice), `game.js ▸ combat` (`fireWeapon` if it needs special handling) |
| add / rebalance gear | `items.js`; icon in `icons.js` |
| change enemy behaviour | `game.js ▸ enemy AI` / `▸ new enemy kinds` / `▸ squad AI` |
| add an enemy kind | `entities.js` (`ENEMY_KIND` + `Enemy` fields), `game.js ▸ enemy AI` (an `update<Kind>`), `enemydraw.js` (`drawEnemy` case), `game.js` spawn tables |
| add a biome | `worldgen.js` (`BIOMES` + room dressing), `textures.js`, `audio.js` (an ambient bed), `fx.js` (`BIOME_IMPACT` entry) |
| add a research node | `tech.js` (`TECH` + `EFFECT_APPLY`), and mirror any new default in the harness `DEFAULTS` |
| add a campaign operation | `campaign.js` (`OPERATIONS`) |
| tweak the SGC layout / props | `hub.js` |
| tune particles / shake / decals | `fx.js` |
| touch line of sight / fog | `vis.js` |
| add a between-runs panel | `stationpanels.js` next to the existing `render<Name>Panel`; route it in `game.js` `renderStationPanel` |
| a new full-screen UI | **not** a new `g.state` — add a sub-mode flag and branch inside `menu`/`play`, like `renderCodex` / the pause overlay |
