# Gate Crawler

A procedurally generated top-down SG-1 roguelite. Dial a gate address, fight
through a generated world to its DHD, dial deeper for better loot, or dial home
to bank your naquadah. Death keeps half.

**Vertical slice** — one biome (desert ruins), two factions (Jaffa, Wraith), a
miniboss (Serpent Guard Prime), the P90 + a scavenged Staff Weapon, the seeded
gate network, world modifiers, and meta progression (banked naquadah → +max HP).

## Run it

```
~/.local/share/gatecrawler/gatecrawler        # or launch "Gate Crawler" from the apps menu
```

Starts a tiny Python static server on `127.0.0.1:8777` and opens a Chromium app
window. `GATECRAWLER_PORT` overrides the port.

## Controls

| | |
|---|---|
| WASD | move |
| mouse | aim |
| LMB | fire |
| SPACE | dodge roll (i-frames) |
| 1–4 | use hotbar consumable |
| G | throw grenade (from grenade slot) |
| Q | swap Weapon 1 / Weapon 2 |
| TAB / I | open loadout panel (drag items to gear slots / hotbar) |
| E | interact (DHD) |
| Enter | start run / continue from menu & death |

Append `?debug` to the URL for an FPS / entity overlay.

## Gear

Open the loadout panel with **TAB**. Drag items from the grid onto the paper-doll
slots — **head / torso / legs / feet** armour (each cuts damage to hits that land
on that region), **Weapon 1 / Weapon 2** (quick-swap with Q), and the **grenade**
slot. Drop consumables onto the four hotbar slots and use them with 1–4:

- **Field Dressing / Medkit** — heal
- **Combat Stim** — +move speed, +fire rate for 6s
- **Shield Cell** — regenerating overshield (absorbs before HP)
- **Frag Grenade** — thrown, blast damage

Enemies and floor caches drop items; most rooms hold a medical pickup. The boss
drops a Staff Weapon, a heavy armour piece and medkits. Inventory persists
between worlds and runs (saved to `localStorage`).

## Design notes

- **The gate network is one fixed infinite graph.** A world's neighbours are a
  pure function of its address (`src/address.js` → `neighbors`), so any address
  always leads to the same worlds regardless of the path taken.
- **Everything is derived from the address + hop distance** (`worldParams`):
  faction, biome, threat level, modifiers, room count. `buildWorld` turns that
  into a room graph and tile map; encounters scale with threat.
- **Difficulty** rises with hop distance from home and the address's own danger
  roll — more enemies, elites, bigger boss, better rewards.
- **Modifiers** (`eclipse`, `naquadah-rich`, `ion-storm`) reroll per world to
  keep infinite worlds from feeling same-y. `eclipse` tightens the sight radius.
- **Line of sight** — you only see inside a 360° visibility polygon cast from the
  player. Walls, pillars and doorways occlude it (`computeVisPoly` in `game.js`);
  enemies, pickups and props outside it aren't drawn. Enemy fire still comes from
  the dark.
- **No spawn pop-in** — every room's occupants and loot are built when the world
  loads (`populateWorld`). Enemies wander idle until they see you, hear a nearby
  fight, or take a hit; then they engage. An enemy that chases far outside its
  own room disengages and returns (leash) so the whole level doesn't pile into
  the DHD room.
- **Jaffa AI** — ~60% use cover: find a spot that breaks line of sight, tuck, and
  lean out to fire, then tuck again; they drop cover and fight in the open once
  you close the distance. The rest (and all DHD-room guards) push aggressively.
  Wraith rush; the boss is a charging brawler.
- **Items / gear** — `items.js` is the catalogue, `inventory.js` holds the grid /
  equipment / hotbar state and the pure move/equip/derive logic. Armour DR is
  regional: an incoming hit rolls a body region and that slot's piece absorbs.

## Architecture

Vanilla ES modules, no build step. `src/`:

| file | role |
|---|---|
| `main.js` | bootstrap |
| `game.js` | state machine, systems, rendering, HUD |
| `worldgen.js` | address → room graph → tile map; offscreen bake |
| `address.js` | glyphs, seed hashing, neighbours, world params |
| `entities.js` | Player / Enemy / Bullet / Pickup / Particle + collision |
| `weapons.js` | weapon table |
| `pathfind.js` | BFS flow field (enemy pathing) |
| `rng.js` | mulberry32 + string hash |
| `input.js` `audio.js` `loop.js` `draw.js` | plumbing |

## Tests

```
node test/harness.mjs           # headless: worldgen, determinism, full play loop,
SEED=42 node test/harness.mjs   # deep descent, stress. ~86k assertions.
```

`test/browser-selftest.html` and `test/play-shot.html` run the real modules in a
browser (used for CI-style checks and screenshots).
