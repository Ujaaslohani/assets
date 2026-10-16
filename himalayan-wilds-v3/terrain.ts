/**
 * terrain.ts — world shape for Himalayan Wilds.
 *
 * Single source of truth for: map size, height, river, dirt trails,
 * forest density and terrain colours. Everything is a pure function of
 * (x, z) so the scatter system can regenerate any cell on demand
 * (GTA-style streaming) without storing the world in memory.
 */
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// World constants
// ---------------------------------------------------------------------------
export const MAP_HALF = 250; // 500 m x 500 m world (was 95 -> 190 m)
export const SETTLEMENT_RADIUS = 18; // flat village area around (0,0)
export const WATER_Y = -1.0; // y of the river water plane
export const RIVER_X = -30; // river centre line (moved out of the village)
export const RIVER_HALF_WIDTH = 7; // water plane is 14 m wide
export const RIVER_HEAD_Z = -MAP_HALF * 0.78; // waterfall sits here, at the mountain rim

// ---------------------------------------------------------------------------
// Noise helpers (deterministic, allocation-free)
// ---------------------------------------------------------------------------
export function hash2(ix: number, iz: number, seed = 0): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

/** Value noise in [-1, 1]. */
export function valueNoise(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return (top + (bot - top) * fz) * 2 - 1;
}

/** Fractal noise in roughly [-1, 1]. */
export function fbm(x: number, z: number, octaves = 3, seed = 0): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * f, z * f, seed + o * 31) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

const sstep = (x: number, e0: number, e1: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Dirt trails (the brown paths in the reference image)
// ---------------------------------------------------------------------------
/** x of the north-south trail at a given z. Stays east of the river. */
export const trailNS = (z: number) => 14 + Math.sin(z * 0.018) * 8 + Math.sin(z * 0.047 + 2.1) * 2.5;
/** z of the east-west trail at a given x. Crosses the river (bridge spot). */
export const trailEW = (x: number) => 6 + Math.sin(x * 0.015 + 1.3) * 12 + Math.sin(x * 0.041) * 3;
/** Where the east-west trail crosses the river — the natural bridge site. */
export const BRIDGE_SITE: [number, number] = [RIVER_X, trailEW(RIVER_X)];

/** Cliff wall behind the waterfall (0 = none, 1 = full height). */
function cliffMask(x: number, z: number): number {
  const behind = RIVER_HEAD_Z + 4 - z; // > 0 north of the waterfall lip
  if (behind < -6) return 0;
  return sstep(behind, -4, 10) * (1 - sstep(Math.abs(x - RIVER_X), 26, 75));
}
export const CLIFF_HEIGHT = 24;

/** Approximate distance (m) to the nearest trail centre line. */
export function pathDistance(x: number, z: number): number {
  return Math.min(Math.abs(x - trailNS(z)), Math.abs(z - trailEW(x)));
}

/** 1 on the trail, 0 off it, soft edges. */
export function pathMask(x: number, z: number): number {
  return 1 - sstep(pathDistance(x, z), 1.2, 2.8);
}

/** 1 inside the river bed, 0 outside. */
export function riverMask(x: number, z: number): number {
  if (z < RIVER_HEAD_Z) return 0;
  return 1 - sstep(Math.abs(x - RIVER_X), RIVER_HALF_WIDTH - 2, RIVER_HALF_WIDTH + 5);
}

/** 0..1 — how "forest" a spot is. Low values become open meadows / clearings. */
export function forestDensity(x: number, z: number): number {
  const n = fbm(x * 0.008 + 40, z * 0.008 - 12, 2, 7);
  let d = sstep(n, -0.35, 0.3);
  // thin the forest close to the village so it reads as a clearing
  d *= sstep(Math.hypot(x, z), SETTLEMENT_RADIUS + 4, SETTLEMENT_RADIUS + 30);
  return d;
}

// ---------------------------------------------------------------------------
// Height
// ---------------------------------------------------------------------------
export function getTerrainHeight(x: number, z: number): number {
  // Rolling hills, always >= 0 so valleys stay dry.
  let h = (fbm(x * 0.012, z * 0.012, 3, 1) * 0.5 + 0.5) * 8;
  h += fbm(x * 0.045 + 17, z * 0.045 - 9, 2, 3) * 1.1;

  // Mountain rim near the map edge (hides the world border).
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const rim = sstep(edge, MAP_HALF * 0.72, MAP_HALF * 0.97);
  h += rim * rim * 45 * (0.8 + 0.2 * fbm(x * 0.03, z * 0.03, 2, 5));

  // Cliff the waterfall drops over, with a shallow notch the upper stream runs in.
  const cm = cliffMask(x, z);
  if (cm > 0) {
    const notch = z < RIVER_HEAD_Z ? 1 - sstep(Math.abs(x - RIVER_X), 3, 6) : 0;
    h += cm * CLIFF_HEIGHT - notch * cm * 1.6;
  }

  // Flat village.
  const flat = 1 - sstep(Math.hypot(x, z), SETTLEMENT_RADIUS, SETTLEMENT_RADIUS + 22);
  h = lerp(h, 0.1, flat);

  // Trails sit slightly lower than the grass beside them.
  h -= pathMask(x, z) * 0.12;

  // River channel.
  const rm = riverMask(x, z);
  if (rm > 0) h = lerp(h, -1.4, rm);

  return Math.max(-1.4, h);
}

// ---------------------------------------------------------------------------
// Terrain colour (vertex colours — no texture memory)
// ---------------------------------------------------------------------------
const C = {
  grass: new THREE.Color('#6fae3c'),
  grassLight: new THREE.Color('#9ccb4c'),
  grassDark: new THREE.Color('#4c8a2e'),
  dry: new THREE.Color('#b9b25a'),
  dirt: new THREE.Color('#b8945e'),
  dirtDark: new THREE.Color('#8f6d45'),
  mud: new THREE.Color('#6b5a3e'),
  rock: new THREE.Color('#8f8c84'),
  snow: new THREE.Color('#e8eef2'),
};

export function getTerrainColor(x: number, z: number, h: number, normalY: number, out: THREE.Color): THREE.Color {
  const broad = fbm(x * 0.02, z * 0.02, 2, 11); // big light/dark meadow patches
  const fine = valueNoise(x * 0.25, z * 0.25, 13); // small mottling

  out.copy(C.grass);
  out.lerp(C.grassLight, sstep(broad, 0.0, 0.6) * 0.8);
  out.lerp(C.grassDark, sstep(-broad, 0.1, 0.7) * 0.7);
  out.lerp(C.dry, sstep(fbm(x * 0.03 + 5, z * 0.03, 2, 17), 0.35, 0.7) * 0.6); // yellow patches
  out.lerp(C.grassDark, forestDensity(x, z) * 0.35); // darker under canopy
  out.offsetHSL(0, 0, fine * 0.025);

  // village dirt
  const village = 1 - sstep(Math.hypot(x, z), 7, 14);
  out.lerp(C.dirt, village * 0.85);

  // trails
  const pm = pathMask(x, z);
  if (pm > 0) {
    out.lerp(C.dirt, pm);
    out.lerp(C.dirtDark, pm * sstep(fine, 0.2, 0.8) * 0.35);
  }

  // wet river banks
  const rm = riverMask(x, z);
  if (rm > 0) out.lerp(C.mud, rm);

  // steep slopes -> rock, high peaks -> snow
  const slope = 1 - sstep(normalY, 0.6, 0.9);
  out.lerp(C.rock, Math.min(0.9, slope * 0.9 + sstep(h, 18, 30) * 0.6));
  out.lerp(C.snow, sstep(h, 34, 44));
  return out;
}

// ---------------------------------------------------------------------------
// Terrain mesh (already in world XZ — render WITHOUT a rotation prop)
// ---------------------------------------------------------------------------
export function buildTerrainGeometry(segments = 200): THREE.BufferGeometry {
  const size = MAP_HALF * 2 + 20; // small skirt past the playable edge
  const g = new THREE.PlaneGeometry(size, size, segments, segments);
  g.rotateX(-Math.PI / 2); // now x/z are world x/z, y is up
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, getTerrainHeight(pos.getX(i), pos.getZ(i)));
  }
  g.computeVertexNormals();

  const normals = g.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    getTerrainColor(pos.getX(i), pos.getZ(i), pos.getY(i), normals.getY(i), col);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  return g;
}
