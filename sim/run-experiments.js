// Headless natural-selection runner.
// Mirrors the per-boid simulation logic in index.html (without canvas/UI/obstacles)
// and runs many seeded simulations to aggregate evolutionary outcomes.

const W = 1500;
const H = 900;

const SPECIES = [
  { name: 'Sky' },
  { name: 'Sun' },
  { name: 'Lime' },
  { name: 'Crimson' },
];
const PREDATOR_SPECIES = 3;

const DEFAULT_PARAMS = {
  SPECIES_INITIAL: [15, 15, 15, 3],
  SPECIES_PARAMS: [
    { maxSpeed: 2.8, minSpeed: 1.4, alignFactor: 0.030, cohesionFactor: 0.0005,  separationFactor: 0.50, turnFactor: 0.15 },
    { maxSpeed: 2.8, minSpeed: 1.4, alignFactor: 0.030, cohesionFactor: 0.0005,  separationFactor: 0.50, turnFactor: 0.15 },
    { maxSpeed: 2.8, minSpeed: 1.4, alignFactor: 0.030, cohesionFactor: 0.0005,  separationFactor: 0.50, turnFactor: 0.15 },
    { maxSpeed: 3.6, minSpeed: 1.8, alignFactor: 0.020, cohesionFactor: 0.00010, separationFactor: 0.50, turnFactor: 0.20 },
  ],
  PROTECTED_RANGE: 18,
  VISUAL_RANGE: 150,
  DIFF_SPECIES_RANGE: 38,
  DIFF_SPECIES_FACTOR: 0.5,
  EDGE_MARGIN: 90,
  LOOK_AHEAD: 45,

  PURSUE_FORCE: 0.07,
  FLEE_FORCE: 0.10,
  CATCH_RADIUS: 18,
  SATIETY_DURATION: 600,
  CONTAGION_FORCE: 0.06,
  ALARM_DECAY: 0.985,
  ALARM_INHERIT: 0.85,
  ALARM_THRESHOLD: 0.2,

  TRAIT_VARIATION: 0.10,
  MUTATION_STRENGTH: 0.08,
  REPRODUCE_PROB: 0.00005,
  SPECIES_POP_CAP: [85, 85, 85, 12],

  ARC_PROBE_COUNT: 5,
  ARC_HALF_ANGLE_RAD: 50 * Math.PI / 180,
  ARC_PROBE_WEIGHT: 0.25,
  MAX_AVOID_FORCE: 0.6,
  OBSTACLE_REPEL_RANGE: 45,
  OBSTACLE_REPEL_FORCE: 0.08,
  OBSTACLE_SIZE: 38,
  NUM_OBSTACLES: 0,
  TRAIT_BOUNDS: {
    maxSpeed:         [0.5, 6.0],
    minSpeed:         [0.3, 4.0],
    alignFactor:      [0.001, 0.2],
    cohesionFactor:   [0.00001, 0.005],
    separationFactor: [0.05, 2.0],
    turnFactor:       [0.02, 0.5],
    visualRange:      [30, 300],
    diffSpeciesRange: [10, 200],
    lookAhead:        [0, 200],
  },
};

const TRAIT_KEYS = ['maxSpeed', 'minSpeed', 'alignFactor', 'cohesionFactor', 'separationFactor', 'turnFactor', 'visualRange', 'diffSpeciesRange', 'lookAhead'];

function mulberry32(seed) {
  let s = seed >>> 0;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampTrait(val, bounds) {
  return Math.max(bounds[0], Math.min(bounds[1], val));
}

function runSimulation(seed, frames, overrideParams = {}) {
  const P = { ...DEFAULT_PARAMS, ...overrideParams };
  const rand = mulberry32(seed);
  Math.random = rand;

  const boids = [];
  const lifetimeBoids = [];
  const founders = [];
  const obstacles = [];

  // Generate circle obstacles in a jittered grid covering the play area
  if (P.NUM_OBSTACLES > 0) {
    const margin = P.EDGE_MARGIN + 30;
    for (let i = 0; i < P.NUM_OBSTACLES; i++) {
      // accept-reject so obstacles don't overlap too much with each other
      let attempts = 0;
      while (attempts++ < 50) {
        const x = margin + rand() * (W - 2 * margin);
        const y = margin + rand() * (H - 2 * margin);
        let ok = true;
        for (const o of obstacles) {
          const dx = x - o.x, dy = y - o.y;
          if (dx * dx + dy * dy < (P.OBSTACLE_SIZE * 2.5) ** 2) { ok = false; break; }
        }
        if (ok) { obstacles.push({ x, y, size: P.OBSTACLE_SIZE }); break; }
      }
    }
  }
  function obstacleSDF(o, px, py) {
    return Math.hypot(px - o.x, py - o.y) - o.size;
  }
  function obstacleRepelAt(o, px, py) {
    const d = obstacleSDF(o, px, py);
    if (d >= P.OBSTACLE_REPEL_RANGE) return [0, 0];
    const eps = 1.5;
    const gx = obstacleSDF(o, px + eps, py) - d;
    const gy = obstacleSDF(o, px, py + eps) - d;
    const len = Math.hypot(gx, gy) || 1;
    const strength = Math.max(0, P.OBSTACLE_REPEL_RANGE - d) * P.OBSTACLE_REPEL_FORCE;
    return [(gx / len) * strength, (gy / len) * strength];
  }

  function spawnBoid(x, y, spread, species) {
    const sp = P.SPECIES_PARAMS[species];
    const angle = rand() * Math.PI * 2;
    const speed = sp.minSpeed + rand() * (sp.maxSpeed - sp.minSpeed);
    const offR = rand() * spread;
    const offA = rand() * Math.PI * 2;
    const v = (val) => val * (1 + (rand() * 2 - 1) * P.TRAIT_VARIATION);
    const b = {
      x: x + Math.cos(offA) * offR,
      y: y + Math.sin(offA) * offR,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      species,
      satiated: 0,
      alarm: 0,
      alarmDx: 0,
      alarmDy: 0,
      descendants: 0,
      founderId: -1,
      bornFrame: currentFrame,
      diedFrame: -1,
      maxSpeed:         clampTrait(v(sp.maxSpeed),         P.TRAIT_BOUNDS.maxSpeed),
      minSpeed:         clampTrait(v(sp.minSpeed),         P.TRAIT_BOUNDS.minSpeed),
      alignFactor:      clampTrait(v(sp.alignFactor),      P.TRAIT_BOUNDS.alignFactor),
      cohesionFactor:   clampTrait(v(sp.cohesionFactor),   P.TRAIT_BOUNDS.cohesionFactor),
      separationFactor: clampTrait(v(sp.separationFactor), P.TRAIT_BOUNDS.separationFactor),
      turnFactor:       clampTrait(v(sp.turnFactor),       P.TRAIT_BOUNDS.turnFactor),
      visualRange:      clampTrait(v(P.VISUAL_RANGE),      P.TRAIT_BOUNDS.visualRange),
      diffSpeciesRange: clampTrait(v(P.DIFF_SPECIES_RANGE),P.TRAIT_BOUNDS.diffSpeciesRange),
      lookAhead:        clampTrait(v(P.LOOK_AHEAD),        P.TRAIT_BOUNDS.lookAhead),
    };
    // Snapshot initial trait values for selection analysis
    b.initialTraits = {};
    for (const k of TRAIT_KEYS) b.initialTraits[k] = b[k];
    boids.push(b);
    lifetimeBoids.push(b);
    return b;
  }
  function reproduceFrom(parent) {
    const m = (val, bounds) => clampTrait(val * (1 + (rand() * 2 - 1) * P.MUTATION_STRENGTH), bounds);
    const offA = rand() * Math.PI * 2;
    const offR = 18;
    const b = {
      x: parent.x + Math.cos(offA) * offR,
      y: parent.y + Math.sin(offA) * offR,
      vx: parent.vx,
      vy: parent.vy,
      species: parent.species,
      satiated: 0,
      alarm: 0,
      alarmDx: 0,
      alarmDy: 0,
      descendants: 0,
      founderId: parent.founderId,
      bornFrame: currentFrame,
      diedFrame: -1,
      maxSpeed:         m(parent.maxSpeed,         P.TRAIT_BOUNDS.maxSpeed),
      minSpeed:         m(parent.minSpeed,         P.TRAIT_BOUNDS.minSpeed),
      alignFactor:      m(parent.alignFactor,      P.TRAIT_BOUNDS.alignFactor),
      cohesionFactor:   m(parent.cohesionFactor,   P.TRAIT_BOUNDS.cohesionFactor),
      separationFactor: m(parent.separationFactor, P.TRAIT_BOUNDS.separationFactor),
      turnFactor:       m(parent.turnFactor,       P.TRAIT_BOUNDS.turnFactor),
      visualRange:      m(parent.visualRange,      P.TRAIT_BOUNDS.visualRange),
      diffSpeciesRange: m(parent.diffSpeciesRange, P.TRAIT_BOUNDS.diffSpeciesRange),
      lookAhead:        m(parent.lookAhead,        P.TRAIT_BOUNDS.lookAhead),
    };
    b.initialTraits = {};
    for (const k of TRAIT_KEYS) b.initialTraits[k] = b[k];
    return b;
  }

  let currentFrame = 0;

  // Initial spawn — record each as a founder
  for (let s = 0; s < SPECIES.length; s++) {
    for (let i = 0; i < P.SPECIES_INITIAL[s]; i++) {
      const b = spawnBoid(rand() * W, rand() * H, 0, s);
      b.founderId = founders.length;
      const traits = {};
      for (const k of TRAIT_KEYS) traits[k] = b[k];
      founders.push({ species: s, traits, lineageDescendants: 0 });
    }
  }

  function step() {
    const protectedSq = P.PROTECTED_RANGE * P.PROTECTED_RANGE;
    const initialLength = boids.length;
    for (let bi = 0; bi < initialLength; bi++) {
      const b = boids[bi];
      const isPredator = b.species === PREDATOR_SPECIES;
      const visualSq = b.visualRange * b.visualRange;
      const diffSq = b.diffSpeciesRange * b.diffSpeciesRange;
      let closeDx = 0, closeDy = 0;
      let avgVx = 0, avgVy = 0;
      let avgX = 0, avgY = 0;
      let neighbors = 0;
      let nearestPreyDx = 0, nearestPreyDy = 0, nearestPreyDistSq = visualSq;
      let nearestPreyFound = false;
      let fleeX = 0, fleeY = 0, fleeCount = 0;
      let inheritedAlarm = 0, inheritedAlarmDx = 0, inheritedAlarmDy = 0;

      for (const other of boids) {
        if (other === b) continue;
        const dx = b.x - other.x;
        const dy = b.y - other.y;
        const distSq = dx * dx + dy * dy;
        const sameSpecies = other.species === b.species;
        const otherIsPredator = other.species === PREDATOR_SPECIES;

        if (sameSpecies) {
          if (distSq < visualSq && other.alarm > inheritedAlarm) {
            inheritedAlarm = other.alarm;
            inheritedAlarmDx = other.alarmDx;
            inheritedAlarmDy = other.alarmDy;
          }
          if (distSq < protectedSq) {
            const dist = Math.sqrt(distSq) || 0.01;
            const falloff = 1 - dist / P.PROTECTED_RANGE;
            closeDx += (dx / dist) * falloff;
            closeDy += (dy / dist) * falloff;
          } else if (distSq < visualSq) {
            avgVx += other.vx;
            avgVy += other.vy;
            avgX += other.x;
            avgY += other.y;
            neighbors++;
          }
        } else if (isPredator !== otherIsPredator) {
          if (distSq < visualSq) {
            if (isPredator) {
              if (b.satiated <= 0 && distSq < nearestPreyDistSq) {
                nearestPreyDistSq = distSq;
                nearestPreyDx = dx;
                nearestPreyDy = dy;
                nearestPreyFound = true;
              }
            } else {
              const dist = Math.sqrt(distSq) || 0.01;
              const fleeStrength = b.visualRange / Math.max(dist, 25);
              fleeX += (dx / dist) * fleeStrength;
              fleeY += (dy / dist) * fleeStrength;
              fleeCount++;
            }
          }
        } else if (distSq < diffSq) {
          const dist = Math.sqrt(distSq) || 0.01;
          const falloff = 1 - dist / b.diffSpeciesRange;
          closeDx += (dx / dist) * falloff * P.DIFF_SPECIES_FACTOR;
          closeDy += (dy / dist) * falloff * P.DIFF_SPECIES_FACTOR;
        }
      }

      if (neighbors > 0) {
        avgVx /= neighbors; avgVy /= neighbors;
        avgX /= neighbors; avgY /= neighbors;
        const cohScale = fleeCount > 0 ? 0.25 : 1;
        b.vx += (avgVx - b.vx) * b.alignFactor + (avgX - b.x) * b.cohesionFactor * cohScale;
        b.vy += (avgVy - b.vy) * b.alignFactor + (avgY - b.y) * b.cohesionFactor * cohScale;
      }
      b.vx += closeDx * b.separationFactor;
      b.vy += closeDy * b.separationFactor;

      if (nearestPreyFound) {
        const dist = Math.sqrt(nearestPreyDistSq) || 0.01;
        const pursueStrength = b.visualRange / Math.max(dist, 25);
        b.vx += (-nearestPreyDx / dist) * pursueStrength * P.PURSUE_FORCE;
        b.vy += (-nearestPreyDy / dist) * pursueStrength * P.PURSUE_FORCE;
      }
      if (fleeCount > 0) {
        b.vx += fleeX * P.FLEE_FORCE;
        b.vy += fleeY * P.FLEE_FORCE;
      }

      if (fleeCount > 0) {
        b.alarm = 1;
        const fmag = Math.hypot(fleeX, fleeY) || 1;
        b.alarmDx = fleeX / fmag;
        b.alarmDy = fleeY / fmag;
      } else if (inheritedAlarm * P.ALARM_INHERIT > b.alarm) {
        b.alarm = inheritedAlarm * P.ALARM_INHERIT;
        b.alarmDx = inheritedAlarmDx;
        b.alarmDy = inheritedAlarmDy;
      } else {
        b.alarm *= P.ALARM_DECAY;
      }
      if (fleeCount === 0 && b.alarm > P.ALARM_THRESHOLD) {
        b.vx += b.alarmDx * b.alarm * P.CONTAGION_FORCE;
        b.vy += b.alarmDy * b.alarm * P.CONTAGION_FORCE;
      }

      if (obstacles.length > 0) {
        let avoidFx = 0, avoidFy = 0;
        for (const o of obstacles) {
          const [fx, fy] = obstacleRepelAt(o, b.x, b.y);
          avoidFx += fx;
          avoidFy += fy;
        }
        if (b.lookAhead > 0) {
          const heading = Math.atan2(b.vy, b.vx);
          for (let i = 0; i < P.ARC_PROBE_COUNT; i++) {
            const t = (i / (P.ARC_PROBE_COUNT - 1) - 0.5) * 2;
            const angle = heading + t * P.ARC_HALF_ANGLE_RAD;
            const px = b.x + Math.cos(angle) * b.lookAhead;
            const py = b.y + Math.sin(angle) * b.lookAhead;
            for (const o of obstacles) {
              const [fx, fy] = obstacleRepelAt(o, px, py);
              avoidFx += fx * P.ARC_PROBE_WEIGHT;
              avoidFy += fy * P.ARC_PROBE_WEIGHT;
            }
          }
        }
        const avoidMag = Math.hypot(avoidFx, avoidFy);
        if (avoidMag > P.MAX_AVOID_FORCE) {
          const k = P.MAX_AVOID_FORCE / avoidMag;
          avoidFx *= k;
          avoidFy *= k;
        }
        b.vx += avoidFx;
        b.vy += avoidFy;
      }

      const edgeTurn = (isPredator && nearestPreyFound) ? b.turnFactor * 0.2 : b.turnFactor;
      if (b.x < P.EDGE_MARGIN)        b.vx += edgeTurn;
      if (b.x > W - P.EDGE_MARGIN)    b.vx -= edgeTurn;
      if (b.y < P.EDGE_MARGIN)        b.vy += edgeTurn;
      if (b.y > H - P.EDGE_MARGIN)    b.vy -= edgeTurn;

      const speed = Math.hypot(b.vx, b.vy);
      if (speed > b.maxSpeed) {
        b.vx = (b.vx / speed) * b.maxSpeed;
        b.vy = (b.vy / speed) * b.maxSpeed;
      } else if (speed < b.minSpeed && speed > 0) {
        b.vx = (b.vx / speed) * b.minSpeed;
        b.vy = (b.vy / speed) * b.minSpeed;
      }

      b.x += b.vx;
      b.y += b.vy;
      if (b.satiated > 0) b.satiated--;
    }

    // Reproduction pass (prey only)
    const speciesCounts = [0, 0, 0, 0];
    for (const b of boids) speciesCounts[b.species]++;
    const offspring = [];
    for (const b of boids) {
      if (b.species === PREDATOR_SPECIES) continue;
      if (rand() >= P.REPRODUCE_PROB) continue;
      if (speciesCounts[b.species] >= P.SPECIES_POP_CAP[b.species]) continue;
      speciesCounts[b.species]++;
      const child = reproduceFrom(b);
      offspring.push(child);
      lifetimeBoids.push(child);
      b.descendants++;
      if (child.founderId >= 0 && child.founderId < founders.length) {
        founders[child.founderId].lineageDescendants++;
      }
    }
    if (offspring.length > 0) boids.push(...offspring);

    // Catch pass
    const catchSq = P.CATCH_RADIUS * P.CATCH_RADIUS;
    const toRemove = new Set();
    for (let i = 0; i < boids.length; i++) {
      const pred = boids[i];
      if (pred.species !== PREDATOR_SPECIES) continue;
      if (pred.satiated > 0) continue;
      let bestIdx = -1;
      let bestDistSq = catchSq;
      for (let j = 0; j < boids.length; j++) {
        if (i === j) continue;
        if (boids[j].species === PREDATOR_SPECIES) continue;
        if (toRemove.has(j)) continue;
        const dx = pred.x - boids[j].x;
        const dy = pred.y - boids[j].y;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestDistSq) { bestDistSq = dSq; bestIdx = j; }
      }
      if (bestIdx !== -1) {
        toRemove.add(bestIdx);
        pred.satiated = P.SATIETY_DURATION;
      }
    }
    if (toRemove.size > 0) {
      const sorted = [...toRemove].sort((a, b) => b - a);
      for (const idx of sorted) {
        boids[idx].diedFrame = currentFrame;
        boids.splice(idx, 1);
      }
    }
  }

  function snapshotMeans() {
    const sums = [0,1,2,3].map(() => {
      const o = { count: 0 };
      for (const k of TRAIT_KEYS) o[k] = 0;
      return o;
    });
    for (const b of boids) {
      const s = sums[b.species];
      s.count++;
      for (const k of TRAIT_KEYS) s[k] += b[k];
    }
    return sums.map(s => {
      if (s.count === 0) return { count: 0 };
      const out = { count: s.count };
      for (const k of TRAIT_KEYS) out[k] = s[k] / s.count;
      return out;
    });
  }

  const trace = [];
  trace.push({ frame: 0, means: snapshotMeans() });

  for (currentFrame = 1; currentFrame <= frames; currentFrame++) {
    step();
    if (currentFrame % 60 === 0 || currentFrame === frames) {
      trace.push({ frame: currentFrame, means: snapshotMeans() });
    }
  }

  // Final population mins/extinctions
  const popMin = [Infinity, Infinity, Infinity, Infinity];
  const popMax = [0, 0, 0, 0];
  let extinctSpecies = new Set();
  for (const sample of trace) {
    for (let s = 0; s < 4; s++) {
      const c = sample.means[s].count;
      if (c < popMin[s]) popMin[s] = c;
      if (c > popMax[s]) popMax[s] = c;
      if (c === 0) extinctSpecies.add(s);
    }
  }

  return {
    seed,
    finalCounts: snapshotMeans().map(s => s.count),
    finalMeans: snapshotMeans(),
    popMin, popMax,
    extinctSpecies: [...extinctSpecies],
    trace,
    lifetimeBoids,
    founders,
  };
}

// ===== Aggregation helpers =====

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function rpad(s, n) {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}
function fmt(n, dp = 2) {
  if (!isFinite(n)) return '—';
  return n.toFixed(dp);
}

function meanStdev(arr) {
  if (arr.length === 0) return { mean: NaN, stdev: NaN };
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  return { mean, stdev: Math.sqrt(v) };
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = xs.reduce((a,b)=>a+b,0)/n;
  const my = ys.reduce((a,b)=>a+b,0)/n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const ax = xs[i]-mx, ay = ys[i]-my;
    num += ax*ay; dx += ax*ax; dy += ay*ay;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

// ===== Run scenarios =====

function runScenario(label, runs, frames, overrides = {}) {
  console.log(`\n=== ${label} (${runs} runs × ${frames} frames) ===`);
  const t0 = Date.now();
  const results = [];
  for (let i = 0; i < runs; i++) {
    results.push(runSimulation(i + 1, frames, overrides));
  }
  const elapsed = (Date.now() - t0) / 1000;
  console.log(`completed in ${elapsed.toFixed(1)}s\n`);

  // Population summary
  console.log('Population (start → end mean ± stdev), extinctions:');
  for (let s = 0; s < 4; s++) {
    const startCount = (DEFAULT_PARAMS.SPECIES_INITIAL)[s];
    const finals = results.map(r => r.finalCounts[s]);
    const { mean, stdev } = meanStdev(finals);
    const minPops = results.map(r => r.popMin[s]);
    const extinctions = results.filter(r => r.extinctSpecies.includes(s)).length;
    console.log(`  ${pad(SPECIES[s].name, 9)} ${rpad(startCount, 3)} → ${rpad(fmt(mean, 1), 6)} ± ${fmt(stdev, 1)}  (extinct in ${extinctions}/${runs}, min seen: ${Math.min(...minPops)})`);
  }

  // Trait drift (initial vs final mean), prey species only
  console.log('\nTrait drift (mean of start → end across runs, prey species only):');
  console.log('             ' + ['Sky', 'Sun', 'Lime'].map(n => pad(n, 22)).join(''));
  for (const k of TRAIT_KEYS) {
    let row = `  ${pad(k, 11)}`;
    for (let s = 0; s < 3; s++) {
      const starts = [];
      const ends = [];
      for (const r of results) {
        const startMean = r.trace[0].means[s];
        const endMean = r.finalMeans[s];
        if (startMean.count > 0 && endMean.count > 0) {
          starts.push(startMean[k]);
          ends.push(endMean[k]);
        }
      }
      if (starts.length === 0) {
        row += pad('—', 22);
      } else {
        const sm = meanStdev(starts);
        const em = meanStdev(ends);
        const dp = (k === 'cohesionFactor') ? 5 : (k === 'alignFactor' || k === 'turnFactor') ? 3 : (k === 'separationFactor' || k === 'maxSpeed' || k === 'minSpeed') ? 2 : 1;
        const cell = `${fmt(sm.mean, dp)} → ${fmt(em.mean, dp)}`;
        row += pad(cell, 22);
      }
    }
    console.log(row);
  }

  // Selection signal — correlation of founder trait with lineage descendants
  console.log('\nSelection signal — Pearson r(founder trait, total lineage descendants):');
  console.log('             ' + ['Sky', 'Sun', 'Lime'].map(n => pad(n, 12)).join(''));
  for (const k of TRAIT_KEYS) {
    let row = `  ${pad(k, 11)}`;
    for (let s = 0; s < 3; s++) {
      const xs = [];
      const ys = [];
      for (const r of results) {
        for (const f of r.founders) {
          if (f.species !== s) continue;
          xs.push(f.traits[k]);
          ys.push(f.lineageDescendants);
        }
      }
      const rv = pearson(xs, ys);
      const star = Math.abs(rv) > 0.10 ? '*' : ' ';
      row += pad(`${rv >= 0 ? '+' : ''}${fmt(rv, 3)}${star}`, 12);
    }
    console.log(row);
  }

  // Lineage success summary
  let totalFounders = 0;
  let founderDescAvg = [0, 0, 0];
  let founderCount = [0, 0, 0];
  for (const r of results) {
    for (const f of r.founders) {
      if (f.species >= 3) continue;
      founderDescAvg[f.species] += f.lineageDescendants;
      founderCount[f.species]++;
      totalFounders++;
    }
  }
  console.log('\nMean lineage descendants per founder:');
  for (let s = 0; s < 3; s++) {
    const avg = founderCount[s] === 0 ? 0 : founderDescAvg[s] / founderCount[s];
    console.log(`  ${pad(SPECIES[s].name, 9)} ${fmt(avg, 2)}`);
  }
  console.log('  (* = |r| > 0.10, suggesting non-trivial selection on that trait)');

  return results;
}

// ===== Main =====

const RUNS = 50;
const FRAMES = 1800; // 30s at 60fps

console.log('Phase 1 — natural-selection headless analysis');
console.log(`Defaults: ${RUNS} runs × ${FRAMES} frames each (${(FRAMES/60).toFixed(0)}s sim time)\n`);

const slowerPredatorParams = [
  { maxSpeed: 2.8, minSpeed: 1.4, alignFactor: 0.030, cohesionFactor: 0.0005,  separationFactor: 0.50, turnFactor: 0.15 },
  { maxSpeed: 2.8, minSpeed: 1.4, alignFactor: 0.030, cohesionFactor: 0.0005,  separationFactor: 0.50, turnFactor: 0.15 },
  { maxSpeed: 2.8, minSpeed: 1.4, alignFactor: 0.030, cohesionFactor: 0.0005,  separationFactor: 0.50, turnFactor: 0.15 },
  { maxSpeed: 2.4, minSpeed: 1.2, alignFactor: 0.020, cohesionFactor: 0.00010, separationFactor: 0.50, turnFactor: 0.20 },
];

const LONG_FRAMES = 21600; // 6 minutes
const LONG_RUNS = 25;

// 1. Open environment, faster predator (baseline reference)
runScenario('OPEN + FASTER PREDATOR (baseline)', LONG_RUNS, LONG_FRAMES);

// 2. With obstacles, faster predator — does vision matter more?
runScenario('OBSTACLES + FASTER PREDATOR', LONG_RUNS, LONG_FRAMES, { NUM_OBSTACLES: 14 });

// 3. Open, slower predator (max 2.4 < prey 2.8) — speed less useful, vision should rise?
runScenario('OPEN + SLOWER PREDATOR', LONG_RUNS, LONG_FRAMES, { SPECIES_PARAMS: slowerPredatorParams });

// 4. Both — slower predator + obstacles
runScenario('OBSTACLES + SLOWER PREDATOR', LONG_RUNS, LONG_FRAMES, { NUM_OBSTACLES: 14, SPECIES_PARAMS: slowerPredatorParams });
