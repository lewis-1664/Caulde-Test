# Caulde-Test — Flocking & Natural Selection Simulation

An interactive boids simulation in a single HTML file, deployed via GitHub Pages.
The `natural-selection` branch extends it with per-boid genetic variation, reproduction,
mutation, food/energy/starvation, and predator-prey co-evolution.

**Live site:** https://lewis-1664.github.io/Caulde-Test/ (serves the `gh-pages` branch).

## Repo layout

```
index.html              Entire simulation (HTML + CSS + JS, ~1500 lines)
sim/run-experiments.js  Node-runnable headless replica + multi-seed analysis runner
README.md               This file
```

The simulation is intentionally a single file so the GitHub Pages deploy is dead-simple.

## Branches

| Branch | Purpose |
|---|---|
| `main` | Trunk. Phase 1 of natural selection committed here. |
| `gh-pages` | Production. What the live site serves. |
| `natural-selection` | Experimental — Phase 1 + Phase 2 (food/energy ecosystem). |

When ready to ship experimental work, merge `natural-selection` → `main` → `gh-pages`.
The active development branch when working on simulation behavior is `natural-selection`.

## How to run

**Live preview:** open `index.html` directly in a browser, or visit the live site.
The file is self-contained — no build step.

**Headless analysis (multi-seed simulation runs):**
```
node sim/run-experiments.js
```
Prints population stats, trait drift, selection-signal correlations, and lineage
descendants per founder across 25–50 seeded runs of each scenario.
Edit the scenarios at the bottom of `sim/run-experiments.js` to test new parameters.

## Architecture

Two stacked canvases:
- `#c` — the boids canvas; uses `TRAIL_FADE` semi-transparent overdraw so boids leave fading streaks.
- `#overlay-canvas` — cleared each frame, draws obstacles, food, brush indicator, inspect overlay, and the selected-boid ring. `pointer-events: none` so clicks fall through to the boids canvas.

A single `step()` function runs the entire per-frame simulation. A separate `draw()` renders both canvases. `loop()` ties them together via `requestAnimationFrame` and also tracks FPS, runs `updateStats()` and `sampleGraph()` on a 250–500 ms throttle.

Pause is implemented as `if (!paused) step();` — drawing continues so selection rings and stats keep updating.

## Simulation rules

### Species

Index 0–2 are prey, index 3 is the predator. All three prey species start with **identical**
base parameters (Sky's defaults). Personality differences come purely from mutation/drift,
not from species-specific defaults.

```js
SPECIES_PARAMS[0..2] // Sky/Sun/Lime — same base stats
SPECIES_PARAMS[3]    // Crimson — predator (faster, sparser flocking)
```

### Per-boid traits (14 total)

Every boid has 14 mutable traits, stored as flat properties on the boid object.

**Physical traits (9):** `maxSpeed, minSpeed, alignFactor, cohesionFactor, separationFactor, turnFactor, visualRange, diffSpeciesRange, lookAhead`.

**Behavioral traits (5):** `fleeFactor, pursueFactor, forageFactor, contagionFactor, leadFactor`. These are per-boid versions of the previously-global force constants — each boid has its own "personality" for how strongly it reacts to fleeing, pursuing prey, foraging for food, panicking with the herd, or leading targets when chasing.

At spawn each trait is the species default × `(1 ± TRAIT_VARIATION)`, clamped by `TRAIT_BOUNDS`.
On reproduction, each child trait is the parent value × `(1 ± MUTATION_STRENGTH)`, clamped.

`TRAIT_KEYS` in `sim/run-experiments.js` is the canonical list — keep it synced when adding/removing traits.

### Forces applied each frame

In `step()`'s per-boid loop, in this order:
1. **Same-species flocking** (alignment, cohesion, separation) — only with own species, in `b.visualRange`.
2. **Cross-species avoidance** — only between non-predator/non-predator pairs, within `b.diffSpeciesRange`.
3. **Predator-prey** — predators do **predictive pursuit**: aim at where the prey will be in `dist / maxSpeed` frames, scaled by the predator's evolved `leadFactor` (default 0.7). Pursue force is also multiplied by a **pack hunting bonus** `1 + packMates × PACK_BONUS_PER_MATE`, where `packMates` is the number of fellow predators within `PACK_RANGE`. Prey flee with distance-scaled strength `b.visualRange / max(dist, 25) × b.fleeFactor`.
4. **Fear contagion** — prey absorb alarm from same-species neighbors and flee in the inherited direction even when they don't see the predator themselves.
5. **Foraging (Phase 2)** — prey below full energy steer toward nearest visible food; force scales with hunger `(1 - energy)`.
6. **Obstacle avoidance** — soft repulsion (SDF gradient × strength); 5-probe forward arc spans `±50°` so lateral obstacles are detected; total capped by `MAX_AVOID_FORCE`.
7. **Mouse repel** — only if user has the mouse-repel tool active.
8. **Edge avoidance** — soft `b.turnFactor` push within `EDGE_MARGIN` (reduced 5× for predators with a target locked).
9. **Speed clamp** — to `[b.minSpeed, b.maxSpeed]`.
10. **Position update + hard viewport clamp** — boids cannot leave the canvas.
11. **Hard obstacle collision** — if SDF < 0 after move, push to surface and zero inward velocity component (slide along wall).
12. **Energy drain** + **food eating** (Phase 2). Drain is multiplied by a **metabolic cost** `1 + max(0, maxSpeed - baseline)² × 1.5` where `baseline` is 2.8 for prey, 3.0 for predator — so unbounded speed evolution is self-limiting via energy cost.

After the per-boid loop:
13. **Reproduction pass** — boids with `energy ≥ REPRODUCE_THRESHOLD` may spawn a mutated child (gated by `REPRODUCE_PROB` and `SPECIES_POP_CAP`); reproducing costs `REPRODUCE_COST` energy.
14. **Predator catch pass** — predators within `CATCH_RADIUS` of any prey eat one (closest), gaining `PREDATOR_CATCH_RESTORE` energy and entering a `SATIETY_DURATION` cooldown.
15. **Starvation pass** — boids with `energy ≤ 0` are removed.
16. **Food respawn** — one new dot every `FOOD_RESPAWN_INTERVAL` frames if below `FOOD_INITIAL`.

### Inspect overlay (toolbar eye icon)

Picks **all predators** + 2 of each prey species. Draws:
- Faint species-colored ring at `visualRange`.
- Pink ring at `PROTECTED_RANGE` and dashed pink ring at `DIFF_SPECIES_RANGE`.
- Per-species-colored lines to same-species visible neighbors.
- Pink dashed lines to other prey species in avoid range.
- Bold red line from each predator to its single closest prey target.
- Red dashed lines from each watched prey to nearby predators (flee sources).
- **Green lines from each watched prey to its target food**, with the target food highlighted; opacity scales with hunger.
- Yellow vision cone for the obstacle look-ahead arc + 5 sample dots at the cone edge.
- White ring around the user-selected boid (paused-click to select).

## Key tuning constants (current defaults on `natural-selection` branch)

```
NUM_OBSTACLES (live):    user-placed via toolbar (or randomized via "Random Map" button)
SPECIES_INITIAL:         [15, 15, 15, 2]   prey species + predator initial pop
SPECIES_POP_CAP:         [85, 85, 85, 12]  reproduction stops at cap

REPRODUCE_PROB:          0.0001            per-boid per-frame chance
REPRODUCE_THRESHOLD:     0.65              required energy to reproduce
REPRODUCE_COST:          0.30              energy spent on reproduction
INITIAL_ENERGY:          0.70
CHILD_ENERGY:            0.40

PREY_ENERGY_DRAIN:       0.00020           per frame, multiplied by metabolic cost
PREDATOR_ENERGY_DRAIN:   0.00025           higher than prey — predators self-limit
Metabolic cost:          quadratic-excess  drain × (1 + max(0, maxSpeed - baseline)² × 1.5)
                                           baseline: 2.8 for prey, 3.0 for predator
FOOD_INITIAL:            150               at start, also the cap
FOOD_RESPAWN_INTERVAL:   30 frames         (~2 food/sec respawn)
FOOD_RESTORE:            0.30              per food eaten
PREDATOR_CATCH_RESTORE:  0.60              per prey eaten

TRAIT_VARIATION:         0.10              ±10% on spawn
MUTATION_STRENGTH:       0.08              ±8% per generation
TRAIT_BOUNDS.maxSpeed:   [0.5, 6.0]
TRAIT_BOUNDS.leadFactor: [0.0, 2.0]        predictive aim multiplier (0 = no prediction)
TRAIT_BOUNDS.fleeFactor:    [0.02, 0.30]
TRAIT_BOUNDS.pursueFactor:  [0.02, 0.20]
TRAIT_BOUNDS.forageFactor:  [0.05, 0.60]
TRAIT_BOUNDS.contagionFactor: [0.01, 0.20]

PACK_RANGE:              80                predators within this distance buff each other
PACK_BONUS_PER_MATE:     0.4               +40% pursue strength per nearby ally

SATIETY_DURATION:        600 frames        per-catch cooldown for predators
EDGE_MARGIN:             90 px

PROTECTED_RANGE:         18                same-species personal space
DIFF_SPECIES_RANGE:      38                cross-species avoid range
LOOK_AHEAD:              45                obstacle probe distance (used as default, then per-boid)
```

The species-stats panel (bottom-left) displays live **mean** values across each species'
population, so when you tune you can watch traits drift.

## UI tour

- **Canvas**: full viewport. Pause (space or toolbar button) to freeze; click any boid to select it (white ring + top-center stats panel showing its individual traits).
- **Toolbar (bottom-center)**: pause | obstacle shapes (circle/square/triangle) | add/remove boid brushes | mouse repel | inspect | randomize map | clear obstacles.
- **Random Map** (jagged-mountains icon): clears current obstacles and generates 3-5 clusters of organic terrain (rocks/blobs/capsules) plus 4-9 isolated features. Stone-gray colored to distinguish from manually-placed pink obstacles.
- **Stats (bottom-right)**: species color picker (selects target for add/remove brush) → population history graph → per-species counts + FPS.
- **Species traits (bottom-left)**: live trait averages per species; 12 columns: Speed, Align, Coh, Sep, Turn, View, Avoid, Look, Flee, Purs, Forg, Alrm.
- **Selected boid (top-center, when one is selected)**: that boid's species, state (calm/alarmed/hunting/fed), all 13 trait values + Kids count + Energy %.

## Headless analysis runner

`sim/run-experiments.js` mirrors `index.html`'s simulation logic with a seeded RNG
(`mulberry32`). It runs N simulations per scenario, then prints:
- Mean population per species (start → end ± stdev), extinction rate.
- Per-species mean trait drift (start vs end, averaged across runs).
- Pearson `r(founder trait, total lineage descendants)` — selection signal per trait per species. Values >|0.10| are starred and indicate non-trivial selection.
- Mean lineage descendants per founder.

Scenarios live at the bottom of the file; tweak overrides like `{ NUM_OBSTACLES: 14 }` or
`{ SPECIES_PARAMS: [...] }` and rerun. Each scenario reports total runtime in seconds —
typical 25-run × 6-min sims complete in 3–60 s depending on population dynamics.

When changing simulation logic in `index.html`, mirror the change in `sim/run-experiments.js`'s
`runSimulation()` to keep them in sync — otherwise the analysis stops reflecting the live
behavior.

## Recent design decisions worth knowing

- **All prey start identical** — divergence is purely emergent. If you want pre-set
  per-species personalities (the original "Sun=fast, Lime=tight" feel), restore distinct
  rows in `SPECIES_PARAMS[0..2]`.
- **Predator drain > prey drain.** This is a deliberate balancing knob: predators self-limit
  by starving when prey are scarce, preventing the population blow-up that wiped out prey
  in earlier tunings.
- **Metabolic cost is quadratic in excess speed.** A boid with `maxSpeed = 3.5` (vs the 2.8
  prey baseline) drains energy 1.74× faster, at 4.0 it's nearly 4×. This creates a soft
  evolutionary ceiling around `baseline + 0.3` without a hard cap. The exponent and
  multiplier (1.5) are tunable in `step()`. Per-species baseline (predator 3.0, prey 2.8)
  prevents the cost from punishing predators at their default speed.
- **Pack hunting + predictive pursuit replace raw speed advantage.** Predators don't have
  to be much faster than prey — they coordinate (`PACK_RANGE`/`PACK_BONUS_PER_MATE`) and
  aim ahead of moving targets (`leadFactor` × `dist / maxSpeed`). This lets the system
  stay balanced when prey evolve faster, since predators can compensate via teamwork and
  smarter aim instead of needing to evolve faster top speed.
- **Reproduction is energy-gated** in Phase 2; it ignores per-frame randomness when below
  `REPRODUCE_THRESHOLD`. Reducing the threshold makes the system more fertile but weakens
  selection (everyone reproduces).
- **Obstacles are doubly enforced**: soft SDF repulsion for graceful avoidance + hard
  collision push-out for safety. Don't remove the hard collision — strong flee/pursue can
  overcome the soft force.
- **Behavioral traits are just per-boid copies of formerly-global force constants** —
  `fleeFactor` replaces `FLEE_FORCE`, etc. The constants still exist as defaults for
  spawning, but the actual force application uses `b.fleeFactor`. Same pattern lets us
  add more evolveable knobs trivially.
- **Per-boid traits are just regular fields on the boid object** (`b.maxSpeed` etc.) rather
  than a sub-object. Adding a new trait means: declare bounds, add to `spawnBoid` and
  `reproduceFrom`, use the per-boid value in `step()`, expose it in the stats and selected
  panels.
- **Map randomizer creates clustered terrain** with three organic shape types beyond the
  user-placeable circle/square/triangle: polygons (rocks), blobs (overlapping circles),
  and capsules (rounded rectangles). All share the same SDF-based avoidance system. Add
  more shape types by adding an SDF, a generator, and an `obstacleSDF`/`drawObstacle` case.

## Tips for extending

- **Add a new trait**: trait keys live in `TRAIT_KEYS` in `sim/run-experiments.js` and are
  hardcoded as object properties in `index.html`'s `spawnBoid`/`reproduceFrom`. To add one:
  bound in `TRAIT_BOUNDS`, add to spawn/reproduce, use in `step()`, mirror in headless,
  add a column to the species-stats panel + a cell to the selected-boid panel.
- **Add a new force**: insert it in `step()`'s per-boid loop, after the existing forces and
  before edge/clamp. Mirror in headless.
- **Add a new obstacle/terrain shape**: write an SDF function, add a `make<Shape>` generator,
  add a case to `obstacleSDF` and `drawObstacle`. The hard-collision pass uses the SDF
  generically so no other code changes are needed.
- **Add UI**: panels follow the pattern `position: fixed` with backdrop-blur cards. The
  overlay canvas is the right place to draw any selection-time visualization.
- **Verify changes don't break analysis**: run `node sim/run-experiments.js` and check that
  populations don't immediately go extinct. If they do, the change is too punishing.
- **Test parameter sweeps in headless**: edit the scenarios at the bottom of
  `sim/run-experiments.js`. The runner already supports overriding any constant via
  `runScenario(name, runs, frames, { CONSTANT: value, ... })`. Useful for finding stable
  tunings before applying to the live HTML.

## Phase 3 (not implemented)

Carnivore mutation — letting prey occasionally mutate dietary type and become predators
themselves, with a hue interpolation toward red. Sketched in earlier conversations but not
built yet. Would require a `dietaryType` field per boid and updates to the catch logic to
check actual dietary type rather than species index.
