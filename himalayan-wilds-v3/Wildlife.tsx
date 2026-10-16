/**
 * Wildlife.tsx — herd AI + instanced rendering for deer, boar and goral.
 *
 * Behaviour (per animal):  graze ⇄ walk  →  alert  →  flee  →  calm down & re-settle
 *  - Awareness builds up when the player is inside the animal's hearing radius.
 *    Sprinting is loud, walking is normal, crouching [C] is quiet — stealth matters.
 *  - Bow shots and arrow impacts make noise. A hit or a spooked member panics the whole herd.
 *  - Fleeing animals steer around water, steep slopes, trees and the map edge.
 *  - Wounded boars sometimes charge and knock the player back.
 * Rendering: per species one InstancedMesh each for body, head and legs (+ one for blob
 * shadows) → 10 draw calls for every animal on the map. No React state per frame.
 */
import { useFrame } from '@react-three/fiber';
import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { act, clamp, emit, engine, type Marker, registerMarkers, seeded, turnToward, wrapAngle } from './engine';
import { resolveTreeCollision } from './ForestStreamer';
import { flatMaterial, getSpeciesModels, type SpeciesModel } from './models';
import { forestDensity, getTerrainHeight, MAP_HALF, pathDistance, riverMask } from './terrain';

export type Species = 'deer' | 'boar' | 'goral';
type AState = 'graze' | 'walk' | 'alert' | 'flee' | 'charge' | 'downed';

const SPEC: Record<Species, {
  name: string; hp: number; walk: number; run: number;
  hear: { still: number; crouch: number; walk: number; sprint: number };
  herd: [number, number]; groups: number; gait: number; grazePitch: number;
  yields: Record<string, number>;
}> = {
  deer: {
    name: 'Deer', hp: 80, walk: 1.25, run: 9.5,
    hear: { still: 11, crouch: 8, walk: 22, sprint: 36 },
    herd: [3, 5], groups: 7, gait: 3.1, grazePitch: 1.05,
    yields: { deer_pelt: 2, bone: 2, sinew: 1 },
  },
  boar: {
    name: 'Wild Boar', hp: 140, walk: 0.95, run: 7.5,
    hear: { still: 8, crouch: 6, walk: 16, sprint: 28 },
    herd: [2, 3], groups: 5, gait: 4.2, grazePitch: 0.55,
    yields: { boar_hide: 2, bone: 3, sinew: 1 },
  },
  goral: {
    name: 'Goral', hp: 70, walk: 1.1, run: 8.6,
    hear: { still: 13, crouch: 9, walk: 25, sprint: 40 },
    herd: [2, 4], groups: 4, gait: 3.4, grazePitch: 0.85,
    yields: { goral_horn: 2, bone: 2, sinew: 1 },
  },
};

export interface Animal {
  id: number;
  sp: Species;
  herd: Herd;
  x: number; y: number; z: number;
  yaw: number;
  speed: number;
  state: AState;
  t: number;
  hp: number;
  tx: number; tz: number;
  phase: number;
  pitch: number;
  aware: number;
  fall: number;
  downT: number;
  steerYaw: number;
  steerT: number;
  charged: boolean;
  slow: number; // accumulator for far-away low-rate updates
}

interface Herd {
  sp: Species;
  ax: number; az: number;
  size: number;
  members: Animal[];
  respawnT: number;
  calmT: number;
}

const herds: Herd[] = [];
const animals: Animal[] = [];
let nextId = 1;

// ---------------------------------------------------------------------------
// Terrain helpers
// ---------------------------------------------------------------------------
function walkable(x: number, z: number) {
  if (Math.abs(x) > MAP_HALF - 8 || Math.abs(z) > MAP_HALF - 8) return false;
  const h = getTerrainHeight(x, z);
  if (h < -0.55 || h > 36) return false;
  const sx = getTerrainHeight(x + 1.2, z) - getTerrainHeight(x - 1.2, z);
  const sz = getTerrainHeight(x, z + 1.2) - getTerrainHeight(x, z - 1.2);
  return sx * sx + sz * sz < 2.6; // ~34° max slope
}

function habitatScore(sp: Species, x: number, z: number) {
  if (!walkable(x, z) || riverMask(x, z) > 0.02 || pathDistance(x, z) < 4) return -1;
  const h = getTerrainHeight(x, z);
  const f = forestDensity(x, z);
  if (sp === 'deer') return (1 - f) * 1.2 + (h < 14 ? 0.5 : 0);
  if (sp === 'boar') return f * 1.4 + (h < 12 ? 0.3 : 0);
  return h > 8 ? 1 + h / 30 : h / 20;
}

function makeAnimal(sp: Species, herd: Herd, x: number, z: number, rnd: () => number): Animal {
  const a: Animal = {
    id: nextId++, sp, herd, x, z, y: getTerrainHeight(x, z),
    yaw: rnd() * Math.PI * 2, speed: 0, state: 'graze', t: 1 + rnd() * 6,
    hp: SPEC[sp].hp, tx: x, tz: z, phase: rnd() * 6, pitch: SPEC[sp].grazePitch,
    aware: 0, fall: 0, downT: 0, steerYaw: 0, steerT: 0, charged: false, slow: 0,
  };
  a.steerYaw = a.yaw;
  return a;
}

/** Deterministic herd placement. The first deer herd is always near the village (tutorial hunt). */
export function spawnWildlife(seed = 7) {
  herds.length = 0;
  animals.length = 0;
  const rnd = seeded(seed);
  const order: Species[] = [];
  (['deer', 'boar', 'goral'] as Species[]).forEach((sp) => {
    for (let i = 0; i < SPEC[sp].groups; i++) order.push(sp);
  });

  for (let gi = 0; gi < order.length; gi++) {
    const sp = order[gi];
    const tutorial = gi === 0;
    let best = { s: -1, x: 0, z: 0 };
    for (let k = 0; k < 160; k++) {
      const ang = rnd() * Math.PI * 2;
      const r = tutorial ? 42 + rnd() * 30 : 55 + rnd() * 160;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      let s = habitatScore(sp, x, z);
      if (s < 0) continue;
      for (const h of herds) if (Math.hypot(h.ax - x, h.az - z) < 45) s -= 2;
      if (s > best.s) best = { s, x, z };
    }
    if (best.s < 0) continue;
    const [lo, hi] = SPEC[sp].herd;
    const herd: Herd = { sp, ax: best.x, az: best.z, size: lo + Math.floor(rnd() * (hi - lo + 1)), members: [], respawnT: 0, calmT: 0 };
    for (let i = 0; i < herd.size; i++) {
      const a = makeAnimal(sp, herd, herd.ax + (rnd() - 0.5) * 8, herd.az + (rnd() - 0.5) * 8, rnd);
      herd.members.push(a);
      animals.push(a);
    }
    herds.push(herd);
  }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
const PROBES = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0, 2.7, -2.7];

function steer(a: Animal, want: number, dt: number) {
  a.steerT -= dt;
  if (a.steerT <= 0) {
    a.steerT = 0.25;
    const look = 2.5 + a.speed * 0.45;
    a.steerYaw = want + Math.PI; // fallback: turn around
    for (const off of PROBES) {
      const ang = want + off;
      if (walkable(a.x + Math.sin(ang) * look, a.z + Math.cos(ang) * look)) {
        a.steerYaw = ang;
        break;
      }
    }
  }
  return a.steerYaw;
}

function panicHerd(h: Herd, fromX: number, fromZ: number) {
  for (const m of h.members) {
    if (m.state === 'downed') continue;
    if (m.state !== 'charge') {
      m.state = 'flee';
      m.t = 5 + Math.random() * 3;
    }
    m.aware = 1.2;
    m.tx = fromX;
    m.tz = fromZ;
  }
  h.calmT = 0;
}

function hearingRadius(sp: Species) {
  const p = engine.player;
  const H = SPEC[sp].hear;
  let r = p.sprinting ? H.sprint : p.moving ? (p.crouching ? H.crouch : H.walk) : p.crouching ? H.crouch * 0.6 : H.still;
  if (engine.isNight) r *= 0.75;
  return r;
}

function updateAnimal(a: Animal, dt: number) {
  const S = SPEC[a.sp];
  const p = engine.player.pos;

  if (a.state === 'downed') {
    a.fall = Math.min(1, a.fall + dt * 2.2);
    a.speed = 0;
    a.downT += dt;
    return;
  }

  const dx = p.x - a.x, dz = p.z - a.z;
  const d = Math.hypot(dx, dz);
  const toPlayer = Math.atan2(dx, dz);

  // Awareness from player noise + loud events (shots / impacts)
  const R = hearingRadius(a.sp);
  let gain = d < R ? (1 - d / R) * 2.4 : -0.3;
  const n = engine.noise;
  if (engine.clock - n.t < 0.15 && Math.hypot(n.x - a.x, n.z - a.z) < n.r) gain += 6;
  a.aware = clamp(a.aware + gain * dt, 0, 1.2);

  switch (a.state) {
    case 'graze': {
      a.speed = Math.max(0, a.speed - dt * 3);
      a.pitch += (S.grazePitch - a.pitch) * Math.min(1, dt * 3);
      a.t -= dt;
      if (a.t <= 0) {
        const ang = Math.random() * Math.PI * 2, r = 3 + Math.random() * 9;
        a.tx = a.herd.ax + Math.cos(ang) * r;
        a.tz = a.herd.az + Math.sin(ang) * r;
        a.state = 'walk';
        a.t = 12;
      }
      break;
    }
    case 'walk': {
      a.speed += (S.walk - a.speed) * Math.min(1, dt * 2);
      a.pitch += (0.15 - a.pitch) * Math.min(1, dt * 3);
      const want = Math.atan2(a.tx - a.x, a.tz - a.z);
      a.yaw = turnToward(a.yaw, steer(a, want, dt), dt * 2.2);
      a.t -= dt;
      if (Math.hypot(a.tx - a.x, a.tz - a.z) < 1.2 || a.t <= 0) {
        a.state = 'graze';
        a.t = 3 + Math.random() * 8;
      }
      break;
    }
    case 'alert': {
      a.speed = Math.max(0, a.speed - dt * 5);
      a.pitch += (-0.25 - a.pitch) * Math.min(1, dt * 6);
      a.yaw = turnToward(a.yaw, toPlayer, dt * 3);
      if (a.aware >= 1) panicHerd(a.herd, p.x, p.z);
      else if (a.aware < 0.15) {
        a.state = 'graze';
        a.t = 2 + Math.random() * 4;
      }
      break;
    }
    case 'flee': {
      a.speed += (S.run - a.speed) * Math.min(1, dt * 3);
      a.pitch += (-0.1 - a.pitch) * Math.min(1, dt * 6);
      const away = Math.atan2(a.x - a.tx, a.z - a.tz) + Math.sin(engine.clock * 1.7 + a.id) * 0.35; // zig-zag
      a.yaw = turnToward(a.yaw, steer(a, away, dt), dt * 4.5);
      a.t -= dt;
      if (a.t <= 0 && d > 55) {
        a.state = 'walk';
        a.aware = 0.3;
        a.t = 12;
        a.herd.calmT = 0.01; // signal: re-settle herd
      }
      break;
    }
    case 'charge': {
      a.speed += (8.5 - a.speed) * Math.min(1, dt * 4);
      a.pitch = 0.25;
      a.yaw = turnToward(a.yaw, toPlayer, dt * 3.5);
      a.t -= dt;
      if (d < 1.5) {
        engine.player.knock.set(-dx / Math.max(d, 0.1), 0, -dz / Math.max(d, 0.1)).multiplyScalar(-11);
        emit({ kind: 'knock' });
        act()?.notify('The boar slammed into you! Back off and line up another shot.');
        a.state = 'flee';
        a.tx = p.x; a.tz = p.z; a.t = 6;
      } else if (a.t <= 0) {
        a.state = 'flee';
        a.tx = p.x; a.tz = p.z; a.t = 5;
      }
      break;
    }
  }

  // Calm animals notice the player
  if ((a.state === 'graze' || a.state === 'walk') && a.aware > 0.4) {
    a.state = 'alert';
    a.t = 0;
  }

  // Herd separation (cheap: herds are tiny)
  for (const m of a.herd.members) {
    if (m === a || m.state === 'downed') continue;
    const sx = a.x - m.x, sz = a.z - m.z;
    const s2 = sx * sx + sz * sz;
    if (s2 < 2.6 && s2 > 1e-4) {
      const s = Math.sqrt(s2);
      a.x += (sx / s) * (1.6 - s) * dt * 2;
      a.z += (sz / s) * (1.6 - s) * dt * 2;
    }
  }

  a.x += Math.sin(a.yaw) * a.speed * dt;
  a.z += Math.cos(a.yaw) * a.speed * dt;
  if (d < 140) resolveTreeCollision(a, 0.35);
  a.x = clamp(a.x, -MAP_HALF + 6, MAP_HALF - 6);
  a.z = clamp(a.z, -MAP_HALF + 6, MAP_HALF - 6);
  a.y = getTerrainHeight(a.x, a.z);
  a.phase += dt * (0.6 + a.speed) * S.gait;
}

function updateHerds(dt: number) {
  const p = engine.player.pos;
  for (const h of herds) {
    // re-settle where the herd ended up after fleeing
    if (h.calmT > 0) {
      let cx = 0, cz = 0, n = 0;
      for (const m of h.members) if (m.state !== 'downed') { cx += m.x; cz += m.z; n++; }
      if (n) { h.ax = cx / n; h.az = cz / n; }
      h.calmT = 0;
    }
    // drop carcasses that were never harvested
    for (let i = h.members.length - 1; i >= 0; i--) {
      const m = h.members[i];
      if (m.state === 'downed' && m.downT > 180) removeAnimal(m);
    }
    // slow respawn, out of the player's sight
    const alive = h.members.filter((m) => m.state !== 'downed').length;
    if (alive < h.size) {
      h.respawnT += dt;
      if (h.respawnT > 40 && Math.hypot(p.x - h.ax, p.z - h.az) > 90) {
        h.respawnT = 0;
        const a = makeAnimal(h.sp, h, h.ax + (Math.random() - 0.5) * 8, h.az + (Math.random() - 0.5) * 8, Math.random);
        h.members.push(a);
        animals.push(a);
      }
    }
  }
}

function removeAnimal(a: Animal) {
  const i = animals.indexOf(a);
  if (i >= 0) animals.splice(i, 1);
  const j = a.herd.members.indexOf(a);
  if (j >= 0) a.herd.members.splice(j, 1);
}

export function updateWildlife(dt: number) {
  const p = engine.player.pos;
  for (let i = 0; i < animals.length; i++) {
    const a = animals[i];
    const far = Math.abs(a.x - p.x) + Math.abs(a.z - p.z) > 220;
    if (far) {
      a.slow += dt;
      if (a.slow < 0.3) continue;
      updateAnimal(a, a.slow);
      a.slow = 0;
    } else updateAnimal(a, dt);
  }
  updateHerds(dt);
}

// ---------------------------------------------------------------------------
// Combat + harvesting API (used by the archery and interaction code)
// ---------------------------------------------------------------------------
const _hc = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _rel = new THREE.Vector3();

function segSphere(p0: THREE.Vector3, p1: THREE.Vector3, c: THREE.Vector3, r: number) {
  _seg.subVectors(p1, p0);
  const len2 = _seg.lengthSq() || 1e-6;
  const t = clamp(_rel.subVectors(c, p0).dot(_seg) / len2, 0, 1);
  _rel.copy(p0).addScaledVector(_seg, t);
  return _rel.distanceToSquared(c) <= r * r;
}

export interface ArrowHit { animal: Animal; headshot: boolean }

export function arrowHitTest(p0: THREE.Vector3, p1: THREE.Vector3): ArrowHit | null {
  const models = getSpeciesModels();
  for (const a of animals) {
    if (a.state === 'downed') continue;
    if (Math.abs(a.x - p1.x) > 6 || Math.abs(a.z - p1.z) > 6) continue;
    const M = models[a.sp];
    const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
    // head (checked first so headshots win)
    const hp = M.headPivot;
    const hz = hp[2] + Math.cos(a.pitch) * M.hitHead.z + Math.sin(a.pitch) * M.hitHead.y * 0.2;
    const hy = hp[1] + Math.cos(a.pitch) * M.hitHead.y - Math.sin(a.pitch) * M.hitHead.z;
    _hc.set(a.x + sy * hz, a.y + hy, a.z + cy * hz);
    if (segSphere(p0, p1, _hc, M.hitHead.r)) return { animal: a, headshot: true };
    for (const k of [-1, 0, 1]) {
      const zo = k * M.hitBody.zOff;
      _hc.set(a.x + sy * zo, a.y + M.hitBody.y, a.z + cy * zo);
      if (segSphere(p0, p1, _hc, M.hitBody.r)) return { animal: a, headshot: false };
    }
  }
  return null;
}

export function damageAnimal(a: Animal, dmg: number, headshot: boolean) {
  const S = SPEC[a.sp];
  a.hp -= headshot ? dmg * 2 : dmg;
  const p = engine.player.pos;
  if (a.hp <= 0) {
    a.state = 'downed';
    a.speed = 0;
    a.downT = 0;
    emit({ kind: 'hit', headshot, kill: true });
    act()?.notify(`${headshot ? 'Clean headshot! ' : ''}${S.name} down — walk over and press [E] to harvest.`);
    act()?.addScore(headshot ? 150 : 100);
    panicHerd(a.herd, p.x, p.z);
    return;
  }
  emit({ kind: 'hit', headshot, kill: false });
  const d = Math.hypot(p.x - a.x, p.z - a.z);
  if (a.sp === 'boar' && !a.charged && d < 26 && Math.random() < 0.6) {
    a.charged = true;
    a.state = 'charge';
    a.t = 3;
    act()?.notify('The wounded boar is charging you!');
    for (const m of a.herd.members) if (m !== a && m.state !== 'downed') { m.state = 'flee'; m.t = 6; m.tx = p.x; m.tz = p.z; }
  } else {
    panicHerd(a.herd, p.x, p.z);
    act()?.notify(`Hit! The ${S.name.toLowerCase()} is wounded and fleeing — follow it.`);
  }
}

export function findCarcass(x: number, z: number, r: number): Animal | null {
  let best: Animal | null = null;
  let bd = r * r;
  for (const a of animals) {
    if (a.state !== 'downed') continue;
    const d2 = (a.x - x) ** 2 + (a.z - z) ** 2;
    if (d2 < bd) { bd = d2; best = a; }
  }
  return best;
}

export function harvestCarcass(a: Animal) {
  const y: Record<string, number> = { ...SPEC[a.sp].yields };
  if (y.deer_pelt) y.deer_pelt = Math.round(y.deer_pelt * engine.world.bonus.peltMult);
  if (y.boar_hide) y.boar_hide = Math.round(y.boar_hide * engine.world.bonus.peltMult);
  removeAnimal(a);
  return { name: SPEC[a.sp].name, yields: y };
}

export function speciesName(sp: Species) {
  return SPEC[sp].name;
}

/** Nearest live herd of a species (quest guidance). */
export function nearestHerd(sp: Species, x: number, z: number) {
  let best: Herd | null = null;
  let bd = Infinity;
  for (const h of herds) {
    if (h.sp !== sp || !h.members.some((m) => m.state !== 'downed')) continue;
    const d = Math.hypot(h.ax - x, h.az - z);
    if (d < bd) { bd = d; best = h; }
  }
  if (!best) return null;
  let cx = 0, cz = 0, n = 0;
  for (const m of best.members) if (m.state !== 'downed') { cx += m.x; cz += m.z; n++; }
  return { x: cx / n, z: cz / n };
}

export function getAnimals(): readonly Animal[] {
  return animals;
}

registerMarkers('wildlife', (out: Marker[]) => {
  const p = engine.player.pos;
  const r2 = engine.world.bonus.animalRadar ** 2;
  for (const a of animals) {
    const d2 = (a.x - p.x) ** 2 + (a.z - p.z) ** 2;
    if (a.state === 'downed') out.push({ x: a.x, y: a.y + 1.4, z: a.z, icon: 'harvest', label: `${SPEC[a.sp].name} — harvest` });
    else if (d2 < r2) out.push({ x: a.x, y: a.y + 1.6, z: a.z, icon: 'animal' });
  }
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function makeShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)');
  gr.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
let _shadowMat: THREE.MeshBasicMaterial | null = null;
export function getShadowMaterial() {
  if (!_shadowMat) {
    _shadowMat = new THREE.MeshBasicMaterial({
      map: makeShadowTexture(), transparent: true, depthWrite: false, color: 0x000000,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false,
    });
  }
  return _shadowMat;
}
export const shadowGeometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);

const CAP = 64;
const _base = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _out = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qz = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _X = new THREE.Vector3(1, 0, 0);
const LEG_OFFSETS = [0, Math.PI, Math.PI, 0]; // diagonal pairs move together

function partMatrix(pivot: [number, number, number], pitch: number) {
  _q.setFromAxisAngle(_X, pitch);
  return _local.compose(_v.set(pivot[0], pivot[1], pivot[2]), _q, _s);
}

interface SpeciesMeshes { body: THREE.InstancedMesh; head: THREE.InstancedMesh; leg: THREE.InstancedMesh; model: SpeciesModel }

export function WildlifeRenderer() {
  const { group, meshes, shadows } = useMemo(() => {
    const models = getSpeciesModels();
    const group = new THREE.Group();
    const mk = (g: THREE.BufferGeometry, cap: number) => {
      const m = new THREE.InstancedMesh(g, flatMaterial, cap);
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(m);
      return m;
    };
    const meshes = {} as Record<Species, SpeciesMeshes>;
    (['deer', 'boar', 'goral'] as Species[]).forEach((sp) => {
      const M = models[sp];
      meshes[sp] = { body: mk(M.body, CAP), head: mk(M.head, CAP), leg: mk(M.leg, CAP * 4), model: M };
    });
    const shadows = new THREE.InstancedMesh(shadowGeometry, getShadowMaterial(), CAP * 3);
    shadows.count = 0;
    shadows.frustumCulled = false;
    shadows.renderOrder = 1;
    group.add(shadows);
    return { group, meshes, shadows };
  }, []);

  useEffect(() => () => {
    group.children.forEach((c) => (c as THREE.InstancedMesh).dispose());
  }, [group]);

  useFrame(() => {
    const p = engine.player.pos;
    const counts: Record<Species, number> = { deer: 0, boar: 0, goral: 0 };
    let sc = 0;
    for (const a of animals) {
      if (Math.abs(a.x - p.x) > 115 || Math.abs(a.z - p.z) > 115) continue;
      const sm = meshes[a.sp];
      const M = sm.model;
      const i = counts[a.sp];
      if (i >= CAP) continue;
      counts[a.sp]++;

      // base transform: position, heading, falling onto its side when downed, run bob
      const bob = a.state === 'downed' ? 0 : Math.abs(Math.sin(a.phase)) * Math.min(0.07, a.speed * 0.008);
      _q.setFromAxisAngle(_Y, a.yaw);
      if (a.fall > 0) _q.multiply(_qz.setFromAxisAngle(_Z, (a.fall * Math.PI) / 2));
      _base.compose(_v.set(a.x, a.y + bob + a.fall * M.shadowRadius * 0.35, a.z), _q, _s);

      sm.body.setMatrixAt(i, _base);
      const headPitch = a.state === 'downed' ? 0.3 : a.pitch;
      sm.head.setMatrixAt(i, _out.multiplyMatrices(_base, partMatrix(M.headPivot, headPitch)));

      const amp = a.state === 'downed' ? 0.15 : Math.min(0.85, a.speed * 0.16);
      for (let L = 0; L < 4; L++) {
        const swing = a.state === 'downed' ? (L < 2 ? -0.4 : 0.4) : Math.sin(a.phase + LEG_OFFSETS[L]) * amp;
        sm.leg.setMatrixAt(i * 4 + L, _out.multiplyMatrices(_base, partMatrix(M.legPivots[L], swing)));
      }

      if (sc < shadows.instanceMatrix.count) {
        const r = M.shadowRadius;
        _q.setFromAxisAngle(_Y, a.yaw);
        _out.compose(_v.set(a.x, a.y + 0.04, a.z), _q, _v2.set(r * (a.fall > 0.5 ? 1.3 : 0.75), 1, r * 1.25));
        shadows.setMatrixAt(sc++, _out);
      }
    }
    (Object.keys(meshes) as Species[]).forEach((sp) => {
      const sm = meshes[sp];
      const n = counts[sp];
      sm.body.count = n;
      sm.head.count = n;
      sm.leg.count = n * 4;
      sm.body.instanceMatrix.needsUpdate = true;
      sm.head.instanceMatrix.needsUpdate = true;
      sm.leg.instanceMatrix.needsUpdate = true;
    });
    shadows.count = sc;
    shadows.instanceMatrix.needsUpdate = true;
  });

  return <primitive object={group} />;
}
const _v2 = new THREE.Vector3();

/** Exposed for debugging / tests. */
export function wildlifeStats() {
  const s: Record<string, number> = {};
  for (const a of animals) s[`${a.sp}_${a.state}`] = (s[`${a.sp}_${a.state}`] ?? 0) + 1;
  return { herds: herds.length, animals: animals.length, ...s };
}
export { wrapAngle };
