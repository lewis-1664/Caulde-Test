# Evolving Flocks — Flocking & Natural Selection Simulation

An interactive boids simulation in a single HTML file, deployed via GitHub Pages.
The `natural-selection` branch extends it with per-boid genetic variation, reproduction,
mutation, food/energy/starvation, and predator-prey co-evolution.

**Live site:** https://lewis-1664.github.io/evolving-flocks/ (serves the `gh-pages` branch).

## Repo layout

```
index.html              Entire simulation (HTML + CSS + JS, ~2200 lines)
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
5. **Foraging (Phase 2)** — prey below `FORAGE_ENERGY_THRESHOLD` (0.80) consider food. Only food within a `±60°` forward cone (`FORAGE_CONE_COS = 0.5`) is targeted, so a boid that has overshot food can't lock back onto it and orbit. Pull force = `hunger × forageFactor × closeBoost` where `closeBoost` ramps from 1× to 2× as distance shrinks below 30px. A stuck-circling detector (same food, in 12-25px band, low radial speed for 20+ frames) triggers **hard steering** that rotates velocity 35% toward food per frame and waives the minSpeed clamp so the boid can spiral in.
6. **Obstacle avoidance** — soft repulsion (SDF gradient × strength) with **quadratic distance falloff** (gentle at long range, firm near surface) and **squared heading scale** (force × `cos²(angle to surface)`, so tangent or away-moving boids feel ~zero force). 5-probe forward arc spans `±50°` so lateral obstacles are detected; total capped by `MAX_AVOID_FORCE`.
7. **Mouse repel** — only if user has the mouse-repel tool active.
8. **Edge avoidance** — soft `b.turnFactor` push within `EDGE_MARGIN` (reduced 5× for predators with a target locked).
9. **Speed clamp** — to `[b.minSpeed, b.maxSpeed]`.
10. **Position update + hard viewport clamp** — boids cannot leave the canvas.
11. **Hard obstacle collision** — if SDF < 0 after move, push to surface and zero inward velocity component (slide along wall).
12. **Energy drain** + **food eating** (Phase 2). Drain is multiplied by a **metabolic cost** `1 + max(0, maxSpeed - baseline)² × 1.5` where `baseline` is 2.8 for prey, 3.0 for predator — so unbounded speed evolution is self-limiting via energy cost. Drain is also multiplied by an **age factor** ramping from 1× to 2× across the species' aging window (prey: frames 3000–9000, predator: 4000–12000). For predators only, two additional **torpor** multipliers stack: an energy-based ramp (drain × `0.4 + 0.6 × energy/0.5` when energy < 0.5, so a starving predator drains at ~40% normal rate), and a **wander multiplier** (`× 0.6` when no prey is in visual range AND not satiated — the predator is "resting" rather than hunting).

After the per-boid loop:
13. **Reproduction pass** — boids with `energy ≥ REPRODUCE_THRESHOLD` AND `age ≥ MATURITY_AGE` may spawn a mutated child (gated by per-species reproduce probability and `SPECIES_POP_CAP`); reproducing costs `REPRODUCE_COST` energy. Juveniles cannot reproduce. **Endangered boost**: when a species is down to ≤ `ENDANGERED_THRESHOLD` (2) individuals, their reproduction probability is multiplied by `ENDANGERED_REPRO_BOOST` (5) — prevents bad-luck extinction events where the last solo survivor never gets to breed.
14. **Predator catch pass** — predators within `CATCH_RADIUS` of any prey eat one (closest), gaining `PREDATOR_CATCH_RESTORE` energy and entering a satiety cooldown of `SATIETY_DURATION × energy_after_catch` frames (capped at `SATIETY_MIN` minimum). A predator that ended a hunt with full energy rests for the full 15s; one who barely scraped by at low energy hunts again sooner. Older predators drain faster, so they tend to catch at lower energy, so their satiety is shorter — age effect emerges implicitly without explicit age coefficients.
15. **Starvation pass** — boids with `energy ≤ 0` are removed. Prey corpses become **carrion** that lasts `CARRION_LIFETIME` (600 frames / 10 sec) and can be scavenged by any non-satiated predator within `CATCH_RADIUS` for `CARRION_RESTORE` (0.20) energy. This gives predators an alternative food source during prey crashes — exactly the moment they're most vulnerable.
16. **Food respawn** — one new dot every `FOOD_RESPAWN_INTERVAL` frames if below `FOOD_INITIAL`. **Food clumping**: food spawns near one of `NUM_FOOD_PATCHES` (10) invisible patch centres rather than uniform random, with each patch having `FOOD_PATCH_RADIUS` (60). Patches regenerate when terrain is randomised. Creates emergent foraging hotspots.
17. **Heatmap update** — each live boid increments its species' cell in a `HEAT_CELL`-sized (30px) spatial grid; all cells decay by `HEAT_DECAY` (0.999/frame ≈ 12s half-life). Used by the heatmap overlay.

### Rendering pipeline (boid canvas)

Each frame `draw()` does:
1. Full clear (solid background colour).
2. **Heatmap** (if `heatmapOn`) — draws a coloured rectangle for each non-empty grid cell, tinted by the species with the highest count there, alpha = `density × HEAT_ALPHA_SCALE` capped at `HEAT_MAX_ALPHA`.
3. **Per-boid trails** — each boid keeps a ring buffer of `TRAIL_LENGTH` (28) recent positions sampled every `TRAIL_SAMPLE_INTERVAL` (3) frames, covering ~1.4s of motion. Drawn as a fading polyline in species colour with alpha ramping from 0 (oldest) to `TRAIL_MAX_ALPHA` (newest), plus a final segment from the latest sample to the boid's current position.
4. **Boid bodies** — predator: 4-vertex arrowhead, prey: triangle. Scaled by `ageScale = 0.5 + 0.5 × (age / MATURITY_AGE)` so juveniles render at half size and grow.

The overlay canvas (cleared each frame) draws on top: obstacles, food dots, brush indicator, inspect overlay, selected-boid ring.

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

PREY_REPRODUCE_PROB:     0.00030           per-boid per-frame chance (prey)
PREDATOR_REPRODUCE_PROB: 0.00015           per-boid per-frame chance (predator — slower)
REPRODUCE_THRESHOLD:     0.65              required energy to reproduce
REPRODUCE_COST:          0.30              energy spent on reproduction
INITIAL_ENERGY:          0.70
CHILD_ENERGY:            0.40

MATURITY_AGE:            900 frames        juveniles can't reproduce
AGE_DRAIN_RAMP_START:    3000 frames       prey aging starts here
AGE_DRAIN_RAMP_END:      9000 frames       prey aging maxes (2× drain)
PREDATOR_AGE_DRAIN_RAMP: 4000 → 12000      predators age slower (apex lifespan)
MAX_AGE_DRAIN_MULT:      2.0               peak elderly drain multiplier

PREY_ENERGY_DRAIN:       0.00020           per frame, multiplied by metabolic cost
PREDATOR_ENERGY_DRAIN:   0.00025           higher than prey — predators self-limit
Metabolic cost:          quadratic-excess  drain × (1 + max(0, maxSpeed - baseline)² × 1.5)
                                           baseline: 2.8 for prey, 3.0 for predator
FOOD_INITIAL:            150               at start, also the cap
FOOD_RESPAWN_INTERVAL:   30 frames         (~2 food/sec respawn)
FOOD_CATCH_RADIUS:       12 px             distance for prey to eat food
FOOD_RESTORE:            0.40              per food eaten
PREDATOR_CATCH_RESTORE:  0.60              per prey eaten

PREDATOR_TORPOR_THRESHOLD: 0.50            below this energy, predator drain slows
PREDATOR_TORPOR_MIN_MULT:  0.40            minimum drain multiplier (at energy=0)
PREDATOR_WANDER_DRAIN_MULT: 0.6            drain × this when no prey visible & not satiated
CARRION_LIFETIME:          600 frames      starved prey corpses last 10 sec
CARRION_RESTORE:           0.20            energy gained from scavenging

FORAGE_ENERGY_THRESHOLD: 0.80              boids ≥ this energy ignore food entirely
FORAGE_CONE_COS:         0.5               ±60° forward vision cone for foraging targets
NUM_FOOD_PATCHES:        10                food clusters around N invisible patch centres
FOOD_PATCH_RADIUS:       60 px             food spawns within this of a patch centre

ENDANGERED_THRESHOLD:    4                 ≤ this many individuals → reproduce 5× faster
ENDANGERED_REPRO_BOOST:  5                 multiplier when endangered

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

SATIETY_DURATION:        900 frames        max per-catch cooldown (15 sec, scaled by energy)
SATIETY_MIN:             60 frames         floor cooldown (1 sec) — a starving catch still has some rest
EDGE_MARGIN:             90 px

PROTECTED_RANGE:         18                same-species personal space
DIFF_SPECIES_RANGE:      38                cross-species avoid range
LOOK_AHEAD:              45                obstacle probe distance (used as default, then per-boid)

TRAIL_LENGTH:            28 samples        per-boid trail length (~1.4s of motion)
TRAIL_SAMPLE_INTERVAL:   3 frames          trail samples every N frames
TRAIL_MAX_ALPHA:         0.5               opacity of newest trail segment
TRAIL_LINE_WIDTH:        2.5 px

HEAT_CELL:               30 px             heatmap grid cell size
HEAT_DECAY:              0.999/frame       ≈12s half-life, ~30s to fade fully
HEAT_ALPHA_SCALE:        0.02              density × this = opacity
HEAT_MAX_ALPHA:          0.55              cap on heatmap cell opacity
```

The species-stats panel (bottom-left) displays live **mean** values across each species'
population, so when you tune you can watch traits drift.

## UI tour

- **Canvas**: full viewport. Pause (space or toolbar button) to freeze; click any boid to select it (white ring + top-center stats panel showing its individual traits).
- **Toolbar (bottom-center)**: pause | obstacle shapes (circle/square/triangle) | add/remove boid brushes | mouse repel | inspect | randomize map | **heatmap toggle** | clear obstacles.
- **Random Map** (jagged-mountains icon): clears current obstacles, generates 5-10 organic terrain features (polygon rocks), and regenerates the food patch layout.
- **Heatmap** (3×3 grid icon): toggles a coloured spatial-density overlay showing where each species spends time over the last ~30 seconds. Each cell tinted by the dominant species there; alpha scales with recent density.
- **Stats (bottom-right)**: species color picker (selects target for add/remove brush) → population history graph → per-species rows showing **live count / cumulative eaten / cumulative starved** → FPS.
- **Species traits (bottom-left)**: live trait averages per species; 12 columns: Speed, Align, Coh, Sep, Turn, View, Avoid, Look, Flee, Purs, Forg, Alrm.
- **Selected boid (top-center, when one is selected)**: that boid's species, state (juvenile/adult/elderly + calm/alarmed/hunting/fed), all 14 trait values + Age (sec) + Kids count + Energy %.

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
- **Aging is ecologically stabilising.** Counterintuitively, removing aging makes the
  system *less* stable: predators live forever, peak average ~9 (vs ~5 with aging), and
  drive prey extinct in 48% of runs. With aging, predator turnover keeps prey extinction
  near 27% while predators themselves only die out in ~24% of runs. Predators have a
  longer prime than prey (4000–12000 vs 3000–9000) reflecting apex-species lifespans.
- **Boid size scales with juvenile age.** A newborn boid renders at 50% scale and grows
  linearly to full size at `MATURITY_AGE` (frame 900). The selected-boid panel shows a
  lifecycle label (`juvenile`, `adult`, `elderly`) alongside the behavioral state.
- **Foraging is gated and angle-filtered.** Boids ≥ 80% energy ignore food entirely
  (no path-bending when full). Below threshold, only food in the ±60° forward cone is
  targeted — boids that overshoot food can't lock back onto it, so the spiral-orbit
  pattern is structurally impossible. A stuck-circling detector (same food, in the
  12-25px orbital band, low radial speed for 20+ frames) triggers hard velocity-vector
  steering to break any residual orbits.
- **Smoother obstacle avoidance.** Soft repel uses quadratic distance falloff (gentle
  far, firm near) with squared heading scale (force ∝ `cos²(angle)`, so tangent-moving
  or away-moving boids feel near-zero force). Visually this means boids only turn when
  actually heading at terrain — no more "phantom-sized obstacle" feel.
- **Food clumps in invisible patches.** Food spawns near one of 10 patch centres rather
  than uniformly. Headless analysis showed 10 × 60px patches preserve uniform-baseline
  ecosystem health while still creating visible clustering behaviour. The orbit fix
  matters more here: dense clusters used to produce comical food-circling.
- **Endangered-species reproduction boost.** When a species drops to ≤ 4 individuals,
  reproduction probability is multiplied by 5× until population recovers. Stops the
  bad-luck extinction events where a solo Crimson would average ~111 seconds before
  reproducing — long enough to age out and starve. Threshold is 4 (not 2) because
  the boom-bust amplitude meant Crimson would crash through 4 → 0 too fast for a
  threshold-2 boost to catch them; threshold-4 catches the decline mid-fall.
- **Predator satiety = 900 frames (15 sec) between catches.** Originally 600 (10 sec).
  Headless analysis showed the longer cooldown is a strict ecosystem improvement: prey
  extinction over 6 min drops from 22/75 → 6/75 because predators eat less but more
  reliably; predators still hit their food needs because catches are higher value
  (more time for prey populations to recover between predation events).
- **Predator long-run stability stack.** To get 12-minute Crimson extinction below 50%,
  several biologically-motivated mechanisms compound rather than just bumping reproduction
  rates: (1) **energy-ramp torpor** — predator drain ramps from full to 40% as energy
  drops to zero, like apex predators slowing metabolism in lean times; (2) **wander
  drain** — predator drain × 0.6 when no prey is in visual range AND not satiated, since
  active hunting costs more energy than resting; (3) **carrion scavenging** — starved
  prey leave 10-second corpses worth 0.20 energy when scavenged, giving predators an
  alternative food source during prey crashes; (4) **age stagger** — initial cohort gets
  random ages in [0, 3 × MATURITY_AGE] so the founding generation doesn't age and die
  in lockstep; (5) **prey rebound boost** — `PREY_REPRODUCE_PROB` 0.00020 → 0.00030
  and `FOOD_RESTORE` 0.30 → 0.40, so prey populations recover from crashes faster,
  giving predators sustainable food across cycles. The five together drop Crimson
  12-min extinction from 87% to 47% with prey extinction also lower (9/45 vs 20/45).
- **Trails are explicit, not afterimage.** The earlier `TRAIL_FADE` semi-transparent
  overdraw saturated into a smudgy mixed-species blur. Now each boid keeps a 28-position
  ring buffer and `draw()` strokes a fading polyline through it — clean per-species
  trails with controlled length and no canvas saturation.
- **Heatmap is per-species spatial density with exponential decay.** A 30px-cell grid
  per species accumulates one increment per live boid per frame; all cells decay 0.999/frame
  (~12s half-life). Drawn with the dominant species' colour in each cell, alpha scaled
  by density. Toggleable via toolbar button. Reveals predator hunting circuits, prey
  foraging hotspots, and dead zones at a glance.

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

## Current ecosystem performance

Headless characterisation of the shipping defaults (25 runs × 21600 frames = 6 minutes each;
12-minute rows use 15 runs × 43200 frames):

| Scenario | Prey ext | Crimson ext | Crimson final mean |
|---|---|---|---|
| 6-min, no terrain | 26 / 75 | 4 / 25 (16%) | 3.0 |
| 6-min + terrain 10 | 30 / 75 | 7 / 25 (28%) | 3.2 |
| **12-min, no terrain** | 11 / 45 | 5 / 15 (33%) | 2.6 |

**Selection signal at 6 minutes:** `maxSpeed` is the dominantly selected trait — Pearson
`r(founder maxSpeed, lineage descendants) ≈ +0.16 to +0.28` for all three prey species,
and mean trait drifts upward by ~7-10% over a run. Other traits (fleeFactor, leadFactor,
contagionFactor) show no statistically meaningful selection at this run length.

**Long-run dynamics:** A stack of structural mechanisms (predator torpor + wander-aware
drain + carrion scavenging + active carrion pursuit + age stagger + faster prey rebound +
energy-scaled satiety) keeps the predator-prey system stable across multiple boom-bust
cycles. Crimson 12-minute extinction rate is now 33% (down from 87% with the original
defaults), with final mean 2.6 and peak averages around 9-10 individuals. Predators
handle first-cycle prey crashes (via torpor + carrion), second-cycle aging (via age
stagger), and metabolic mismatch (via energy-scaled satiety so hungry predators
hunt sooner), so the species sustains across longer runs.

## Phase 3 (not implemented)

Carnivore mutation — letting prey occasionally mutate dietary type and become predators
themselves, with a hue interpolation toward red. Sketched in earlier conversations but not
built yet. Would require a `dietaryType` field per boid and updates to the catch logic to
check actual dietary type rather than species index.
