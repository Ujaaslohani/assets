/**
 * ForestStreamer.tsx — dense, streamed vegetation around the player.
 *
 * How it works (same idea GTA III / VC used for its world):
 *  - The world is split into 16 m cells. Each cell's grass / plants / rocks /
 *    trees are generated deterministically from the cell coordinates, so
 *    nothing is stored for the whole map — only cells near the player are
 *    generated, cached (LRU), and reused.
 *  - One InstancedMesh per (model file, sub-mesh). ~27 draw calls total.
 *  - Every few metres of movement (or a big camera turn) the instance lists
 *    are rebuilt from the cached cells: dense near the player, thinned and
 *    shrunk toward each layer's radius, cut off behind the camera.
 *  - Fog hides the outer edge, so there is no visible pop-in line.
 *
 * Usage inside <Canvas>:
 *   <ForestStreamer loadAsset={loadAssetCached} blockers={blockers} />
 * and in the player controller, after moving:
 *   resolveTreeCollision(playerPos.current);
 */
import { useFrame, useThree } from '@react-three/fiber';
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  forestDensity,
  getTerrainHeight,
  hash2,
  MAP_HALF,
  pathDistance,
  pathMask,
  riverMask,
  SETTLEMENT_RADIUS,
} from './terrain';

// ---------------------------------------------------------------------------
// Types (structurally match the existing CachedAssetMesh in Game.tsx)
// ---------------------------------------------------------------------------
export interface AssetPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  localMatrix: THREE.Matrix4;
}
export interface AssetMesh {
  parts: AssetPart[];
}
export type AssetLoader = (file: string) => Promise<AssetMesh | null>;
export interface Blocker {
  x: number;
  z: number;
  r: number;
}

// ---------------------------------------------------------------------------
// Quality knobs — tune these first if FPS is low.
// Triangle estimates are from the actual GLB files.
// ---------------------------------------------------------------------------
export const QUALITY = {
  grassRadius: 36, // m. ~600-1000 clumps in view, ~0.15-0.23M tris
  undergrowthRadius: 60,
  rockRadius: 100,
  treeRadius: 85, // keep <= fog far. ~100-200 trees in view, 0.4-0.8M tris
  rebuildDistance: 4, // m moved before instance lists are rebuilt
  rebuildYawDeg: 25, // camera turn before rebuild (back-face culling)
};

/** Tree mix. Twisted Tree is ~10k tris each vs Pine ~1.6k — it dominates the budget. */
export const TREE_MIX = { pine: 0.4, oak: 0.35, twisted: 0.25 };

const CELL = 16;

type LayerId = 'grass' | 'under' | 'rock' | 'tree';

interface LayerDef {
  id: LayerId;
  seed: number;
  files: Array<[string, number]>; // [file, weight]
  slotsPerSide: number; // jittered grid inside a cell
  chance: (x: number, z: number, h: number) => number; // 0..1 per slot
  scale: [number, number];
  radius: () => number;
  fadeStart: () => number;
  farKeep: number; // fraction of items kept at the outer radius
  colorFloor: number | null; // lift dark vertex-colour AO (fixes black ferns); null = leave
}

const T = (n: string) => `${n}.glb`;

const LAYERS: LayerDef[] = [
  {
    id: 'grass',
    seed: 101,
    files: [
      [T('Grass'), 0.7],
      [T('Tall Grass'), 0.12],
      [T('Grass Wispy'), 0.06],
      [T('Clover'), 0.12],
    ],
    slotsPerSide: 13, // ~0.66 clumps / m² before thinning
    chance: (x, z, h) => {
      if (h < -0.7) return 0; // under water
      const village = Math.min(1, Math.max(0, (Math.hypot(x, z) - 6) / 6));
      return (1 - pathMask(x, z)) * village;
    },
    scale: [0.38, 0.7],
    radius: () => QUALITY.grassRadius,
    fadeStart: () => 12,
    farKeep: 0.2,
    colorFloor: 0.45,
  },
  {
    id: 'under',
    seed: 202,
    files: [
      [T('Fern'), 0.22],
      [T('Plant'), 0.14],
      [T('Plant Big'), 0.1],
      [T('Plant-xH5gNlQxAZ'), 0.06],
      [T('Bush'), 0.1],
      [T('Bush with Flowers'), 0.08],
      [T('Flower Group'), 0.1],
      [T('Flower Group-LqTljN6Wg2'), 0.05],
      [T('Flower Single'), 0.07],
      [T('Mushroom'), 0.05],
      [T('Mushroom Laetiporus'), 0.03],
    ],
    slotsPerSide: 5,
    chance: (x, z, h) => {
      if (h < -0.5 || pathDistance(x, z) < 2 || Math.hypot(x, z) < SETTLEMENT_RADIUS) return 0;
      return 0.35 + 0.5 * forestDensity(x, z);
    },
    scale: [0.45, 0.9],
    radius: () => QUALITY.undergrowthRadius,
    fadeStart: () => 32,
    farKeep: 0.3,
    colorFloor: 0.6,
  },
  {
    id: 'rock',
    seed: 303,
    files: [[T('Rock Medium'), 1]],
    slotsPerSide: 2,
    chance: (x, z, h) => {
      if (h < -0.8 || pathDistance(x, z) < 1.6 || Math.hypot(x, z) < 14) return 0;
      return pathDistance(x, z) < 6 ? 0.45 : 0.22; // rocks like trail edges
    },
    scale: [0.3, 1.0],
    radius: () => QUALITY.rockRadius,
    fadeStart: () => 70,
    farKeep: 0.6,
    colorFloor: null,
  },
  {
    id: 'tree',
    seed: 404,
    files: [
      [T('Pine'), TREE_MIX.pine / 3],
      [T('Pine-699sFuLCN2'), TREE_MIX.pine / 3],
      [T('Pine-79gmlLnweB'), TREE_MIX.pine / 3],
      [T('Tree'), TREE_MIX.oak / 3],
      [T('Tree-QVOop92WmG'), TREE_MIX.oak / 3],
      [T('Tree-aVOxaHRPWe'), TREE_MIX.oak / 3],
      [T('Twisted Tree'), TREE_MIX.twisted / 2],
      [T('Twisted Tree-7PDBpElkQr'), TREE_MIX.twisted / 2],
    ],
    slotsPerSide: 4, // one candidate every 4 m -> trees never overlap
    chance: (x, z, h) => {
      if (h < -0.3 || h > 30) return 0;
      if (pathDistance(x, z) < 3.5) return 0;
      if (riverMask(x, z) > 0.05) return 0;
      if (Math.hypot(x, z) < SETTLEMENT_RADIUS + 6) return 0;
      return 0.05 + forestDensity(x, z) * 0.3;
    },
    scale: [0.42, 0.68],
    radius: () => QUALITY.treeRadius,
    fadeStart: () => 55,
    farKeep: 0.55,
    colorFloor: null,
  },
];

// ---------------------------------------------------------------------------
// Cell generation + LRU cache (module level, shared with collision)
// Packed item layout: x, y, z, rotY, scale, keep, fileIndex
// ---------------------------------------------------------------------------
const STRIDE = 7;
const cellCache = new Map<string, Float32Array>();
const CACHE_LIMIT = 2500;

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getCell(layer: LayerDef, cx: number, cz: number): Float32Array {
  const key = `${layer.id}:${cx},${cz}`;
  const hit = cellCache.get(key);
  if (hit) {
    cellCache.delete(key); // refresh LRU position
    cellCache.set(key, hit);
    return hit;
  }

  const rng = mulberry32(Math.floor(hash2(cx, cz, layer.seed) * 4294967296));
  const n = layer.slotsPerSide;
  const slot = CELL / n;
  const totalW = layer.files.reduce((s, f) => s + f[1], 0);
  const tmp: number[] = [];

  for (let sx = 0; sx < n; sx++) {
    for (let sz = 0; sz < n; sz++) {
      // fixed number of rng draws per slot keeps generation stable
      const jx = rng(), jz = rng(), roll = rng(), pick = rng(), rot = rng(), sc = rng(), keep = rng();
      const x = cx * CELL + (sx + jx) * slot;
      const z = cz * CELL + (sz + jz) * slot;
      if (Math.abs(x) > MAP_HALF - 3 || Math.abs(z) > MAP_HALF - 3) continue;
      const y = getTerrainHeight(x, z);
      if (roll > layer.chance(x, z, y)) continue;

      let acc = 0;
      let fi = 0;
      const target = pick * totalW;
      for (; fi < layer.files.length - 1; fi++) {
        acc += layer.files[fi][1];
        if (target < acc) break;
      }
      tmp.push(x, y, z, rot * Math.PI * 2, layer.scale[0] + sc * (layer.scale[1] - layer.scale[0]), keep, fi);
    }
  }

  const arr = new Float32Array(tmp);
  cellCache.set(key, arr);
  if (cellCache.size > CACHE_LIMIT) {
    const oldest = cellCache.keys().next().value;
    if (oldest !== undefined) cellCache.delete(oldest);
  }
  return arr;
}

let activeBlockers: Blocker[] = [];
const blocked = (x: number, z: number) => {
  for (let i = 0; i < activeBlockers.length; i++) {
    const b = activeBlockers[i];
    const dx = x - b.x;
    const dz = z - b.z;
    if (dx * dx + dz * dz < b.r * b.r) return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Tree trunk collision — call after moving the player each frame.
// ---------------------------------------------------------------------------
const TREE_LAYER = LAYERS.find((l) => l.id === 'tree')!;
export function resolveTreeCollision(pos: { x: number; z: number }, playerRadius = 0.35) {
  const ccx = Math.floor(pos.x / CELL);
  const ccz = Math.floor(pos.z / CELL);
  for (let cx = ccx - 1; cx <= ccx + 1; cx++) {
    for (let cz = ccz - 1; cz <= ccz + 1; cz++) {
      const c = getCell(TREE_LAYER, cx, cz);
      for (let i = 0; i < c.length; i += STRIDE) {
        const tx = c[i], tz = c[i + 2];
        if (blocked(tx, tz)) continue;
        const r = c[i + 4] * 1.1 + playerRadius; // trunk ~0.5-0.75 m at these scales
        const dx = pos.x - tx;
        const dz = pos.z - tz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          pos.x = tx + (dx / d) * r;
          pos.z = tz + (dz / d) * r;
        }
      }
    }
  }
}

/** True if point (x, y, z) is inside a tree trunk (arrows stick into trees). */
export function treeTrunkAt(x: number, y: number, z: number): boolean {
  const c = getCell(TREE_LAYER, Math.floor(x / CELL), Math.floor(z / CELL));
  for (let i = 0; i < c.length; i += STRIDE) {
    const dx = x - c[i], dz = z - c[i + 2];
    const r = c[i + 4] * 0.75;
    if (dx * dx + dz * dz < r * r && y > c[i + 1] - 0.5 && y < c[i + 1] + 9 * c[i + 4]) {
      return !blocked(c[i], c[i + 2]);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Material / geometry fixes (applied once per shared asset)
// Material names come from the GLB files themselves.
// ---------------------------------------------------------------------------
const OPAQUE_NAMES = /grass|rock|mushroom|bark/i;

function fixMaterial(mat: THREE.Material) {
  if (mat.userData.forestFixed) return;
  mat.userData.forestFixed = true;
  mat.side = THREE.DoubleSide;
  if (OPAQUE_NAMES.test(mat.name)) {
    mat.transparent = false;
    mat.alphaTest = 0;
  } else {
    // leaves / petals: cut-out, not blended -> no sorting, early-z works
    mat.transparent = false;
    mat.alphaTest = 0.45;
    mat.alphaToCoverage = true; // smooth edges when the Canvas has antialias: true
  }
  mat.depthWrite = true;
  mat.needsUpdate = true;
}

/** Lift baked vertex-colour AO so foliage never goes black (Fern AO goes down to 0.02). */
function liftVertexColors(geo: THREE.BufferGeometry, floor: number) {
  if (geo.userData.colorLifted) return;
  geo.userData.colorLifted = true;
  const col = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!col) return;
  const k = 1 - floor;
  for (let i = 0; i < col.count; i++) {
    col.setXYZ(i, floor + col.getX(i) * k, floor + col.getY(i) * k, floor + col.getZ(i) * k);
  }
  col.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Runtime instancing
// ---------------------------------------------------------------------------
interface PartSlot {
  mesh: THREE.InstancedMesh;
  local: THREE.Matrix4;
}
interface FileSlot {
  parts: PartSlot[];
  items: number[]; // reused scratch: x, y, z, rot, scale per visible item
}

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _base = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

function makeMesh(part: AssetPart, capacity: number) {
  const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false; // the set surrounds the camera; culling is done on rebuild
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

export function ForestStreamer({ loadAsset, blockers }: { loadAsset: AssetLoader; blockers: Blocker[] }) {
  const { camera } = useThree();
  const group = useMemo(() => new THREE.Group(), []);
  const slots = useRef(new Map<string, FileSlot>());
  const dirty = useRef(true);
  const lastPos = useRef(new THREE.Vector3(1e9, 0, 1e9));
  const lastYaw = useRef(0);

  // Load every model once and create its instanced meshes.
  useEffect(() => {
    let alive = true;
    for (const layer of LAYERS) {
      for (const [file] of layer.files) {
        if (slots.current.has(file)) continue;
        loadAsset(file).then((asset) => {
          if (!alive || !asset || slots.current.has(file)) return;
          const parts = asset.parts.map((p) => {
            fixMaterial(p.material);
            if (layer.colorFloor !== null) liftVertexColors(p.geometry, layer.colorFloor);
            const mesh = makeMesh(p, 256);
            group.add(mesh);
            return { mesh, local: p.localMatrix };
          });
          slots.current.set(file, { parts, items: [] });
          dirty.current = true;
        });
      }
    }
    return () => {
      alive = false;
      slots.current.forEach((s) => s.parts.forEach((p) => { group.remove(p.mesh); p.mesh.dispose(); }));
      slots.current.clear();
    };
  }, [loadAsset, group]);

  // Buildings / resource nodes clear the vegetation under them.
  useEffect(() => {
    activeBlockers = blockers;
    dirty.current = true;
  }, [blockers]);

  const rebuild = (px: number, pz: number, fx: number, fz: number) => {
    slots.current.forEach((s) => (s.items.length = 0));

    for (const layer of LAYERS) {
      const R = layer.radius();
      const F = layer.fadeStart();
      const R2 = R * R;
      const c0x = Math.floor((px - R) / CELL), c1x = Math.floor((px + R) / CELL);
      const c0z = Math.floor((pz - R) / CELL), c1z = Math.floor((pz + R) / CELL);

      for (let cx = c0x; cx <= c1x; cx++) {
        for (let cz = c0z; cz <= c1z; cz++) {
          const c = getCell(layer, cx, cz);
          for (let i = 0; i < c.length; i += STRIDE) {
            const x = c[i], z = c[i + 2];
            const dx = x - px, dz = z - pz;
            const d2 = dx * dx + dz * dz;
            if (d2 > R2) continue;
            const d = Math.sqrt(d2);
            // behind the camera (keep a 10 m bubble so fast turns never show holes)
            if (d > 10 && dx * fx + dz * fz < -0.2 * d) continue;
            // distance thinning — deterministic per item, so no flicker
            const keepT = d <= F ? 1 : 1 - (1 - layer.farKeep) * ((d - F) / (R - F));
            if (c[i + 5] > keepT) continue;
            if (blocked(x, z)) continue;

            const slot = slots.current.get(layer.files[c[i + 6]][0]);
            if (!slot) continue; // still loading
            // grow in at the edge instead of popping
            const edge = Math.min(1, (R - d) / 6);
            slot.items.push(x, c[i + 1], z, c[i + 3], c[i + 4] * (0.35 + 0.65 * edge));
          }
        }
      }
    }

    slots.current.forEach((s) => {
      const n = s.items.length / 5;
      for (const p of s.parts) {
        if (n > p.mesh.instanceMatrix.count) {
          const cap = Math.ceil(n * 1.5);
          group.remove(p.mesh);
          p.mesh.dispose();
          p.mesh = makeMesh({ geometry: p.mesh.geometry, material: p.mesh.material as THREE.Material, localMatrix: p.local }, cap);
          group.add(p.mesh);
        }
      }
      for (let k = 0; k < n; k++) {
        const o = k * 5;
        _pos.set(s.items[o], s.items[o + 1], s.items[o + 2]);
        _quat.setFromAxisAngle(_up, s.items[o + 3]);
        _scale.setScalar(s.items[o + 4]);
        _base.compose(_pos, _quat, _scale);
        for (const p of s.parts) {
          _m.multiplyMatrices(_base, p.local);
          p.mesh.setMatrixAt(k, _m);
        }
      }
      for (const p of s.parts) {
        p.mesh.count = n;
        p.mesh.instanceMatrix.needsUpdate = true;
      }
    });
  };

  useFrame(() => {
    camera.getWorldDirection(_dir);
    _dir.y = 0;
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1);
    _dir.normalize();
    const yaw = Math.atan2(_dir.x, _dir.z);
    let dYaw = Math.abs(yaw - lastYaw.current);
    if (dYaw > Math.PI) dYaw = Math.PI * 2 - dYaw;

    const moved = Math.hypot(camera.position.x - lastPos.current.x, camera.position.z - lastPos.current.z);
    if (dirty.current || moved > QUALITY.rebuildDistance || dYaw > (QUALITY.rebuildYawDeg * Math.PI) / 180) {
      dirty.current = false;
      lastPos.current.copy(camera.position);
      lastYaw.current = yaw;
      rebuild(camera.position.x, camera.position.z, _dir.x, _dir.z);
    }
  });

  return <primitive object={group} />;
}
