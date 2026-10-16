/**
 * Resources.tsx — harvestable nodes (timber, slate, nettle fibre, herbs).
 *
 * Design goals: easy to find, satisfying to gather.
 *  - Nodes come in small natural clusters, most of them 25–140 m from the village.
 *  - Each type has a distinct look (fallen logs, blue-grey slate, yellow-green nettle,
 *    flowering herbs) plus a floating icon, a radar dot and a compass marker.
 *  - A node gives several harvests, shrinks as you take from it, then regrows later
 *    (only while you are not looking at it from close by, so nothing pops in your face).
 *  - Specialists boost yields (Carpenter +2 timber, Builder +2 stone, Herbalist +1 herb).
 */
import { useFrame } from '@react-three/fiber';
import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { engine, type Marker, type MarkerIcon, registerMarkers, seeded } from './engine';
import type { AssetLoader, AssetMesh } from './ForestStreamer';
import { buildLog, flatMaterial } from './models';
import { CAMPS } from './Npcs';
import { forestDensity, getTerrainHeight, MAP_HALF, pathDistance, riverMask, SETTLEMENT_RADIUS } from './terrain';

export type ResType = 'wood' | 'stone' | 'fiber' | 'herb';

export const RES_INFO: Record<ResType, { name: string; item: string; amount: number; harvests: number; respawn: number; icon: MarkerIcon }> = {
  wood: { name: 'Fallen Deodar Log', item: 'wood', amount: 4, harvests: 3, respawn: 80, icon: 'wood' },
  stone: { name: 'Slate Outcrop', item: 'stone', amount: 3, harvests: 4, respawn: 80, icon: 'stone' },
  fiber: { name: 'Mountain Nettle', item: 'fiber', amount: 3, harvests: 2, respawn: 55, icon: 'fiber' },
  herb: { name: 'Wild Artemisia', item: 'herb', amount: 2, harvests: 2, respawn: 60, icon: 'herb' },
};

export interface ResNode {
  id: number;
  type: ResType;
  x: number; y: number; z: number;
  rot: number;
  scale: number;
  left: number;
  regrowAt: number;
}

const nodes: ResNode[] = [];
const KEEP_CLEAR: Array<[number, number]> = Object.values(CAMPS).map((c) => c.camp);

function okSpot(t: ResType, x: number, z: number) {
  if (Math.abs(x) > MAP_HALF - 25 || Math.abs(z) > MAP_HALF - 25) return false;
  if (Math.hypot(x, z) < SETTLEMENT_RADIUS + 5) return false;
  for (const c of KEEP_CLEAR) if (Math.hypot(x - c[0], z - c[1]) < 9) return false; // specialist camps
  if (riverMask(x, z) > 0.02 || pathDistance(x, z) < 2.2) return false;
  const h = getTerrainHeight(x, z);
  if (h < -0.4 || h > 26) return false;
  const s = Math.abs(getTerrainHeight(x + 1.5, z) - getTerrainHeight(x - 1.5, z)) + Math.abs(getTerrainHeight(x, z + 1.5) - getTerrainHeight(x, z - 1.5));
  if (s > 1.6) return false;
  const f = forestDensity(x, z);
  if (t === 'wood') return f > 0.2;
  if (t === 'fiber') return f < 0.75;
  return true;
}

/** Deterministic, clustered layout. */
export function spawnResources(seed = 11) {
  nodes.length = 0;
  const rnd = seeded(seed);
  const plan: Array<[ResType, number]> = [['wood', 9], ['stone', 8], ['fiber', 8], ['herb', 7]];
  let id = 1;
  for (const [type, clusters] of plan) {
    for (let c = 0; c < clusters; c++) {
      // rings: 40 % close, 45 % mid, 15 % far
      const ring = c / clusters;
      const rMin = ring < 0.4 ? 26 : ring < 0.85 ? 70 : 140;
      const rMax = ring < 0.4 ? 70 : ring < 0.85 ? 140 : 205;
      let cx = 0, cz = 0, found = false;
      for (let k = 0; k < 80 && !found; k++) {
        const a = rnd() * Math.PI * 2, r = rMin + rnd() * (rMax - rMin);
        cx = Math.cos(a) * r; cz = Math.sin(a) * r;
        found = okSpot(type, cx, cz) && !nodes.some((n) => Math.hypot(n.x - cx, n.z - cz) < 12);
      }
      if (!found) continue;
      const count = 2 + Math.floor(rnd() * 3);
      for (let i = 0; i < count; i++) {
        let x = cx, z = cz;
        for (let k = 0; k < 12; k++) {
          x = cx + (rnd() - 0.5) * 9; z = cz + (rnd() - 0.5) * 9;
          if (okSpot(type, x, z) && !nodes.some((n) => Math.hypot(n.x - x, n.z - z) < 2.6)) break;
        }
        const info = RES_INFO[type];
        nodes.push({
          id: id++, type, x, z, y: getTerrainHeight(x, z), rot: rnd() * Math.PI * 2,
          scale: type === 'stone' ? 0.55 + rnd() * 0.3 : type === 'wood' ? 0.85 + rnd() * 0.3 : 0.7 + rnd() * 0.3,
          left: info.harvests, regrowAt: 0,
        });
      }
    }
  }
  dirty = true;
}

let dirty = true;

export function getResourceNodes(): readonly ResNode[] {
  return nodes;
}

/** Nearest harvestable node within r metres. */
export function findNode(x: number, z: number, r: number): ResNode | null {
  let best: ResNode | null = null;
  let bd = r * r;
  for (const n of nodes) {
    if (n.left <= 0) continue;
    const d2 = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d2 < bd) { bd = d2; best = n; }
  }
  return best;
}

export function nearestOfType(t: ResType, x: number, z: number) {
  let best: ResNode | null = null;
  let bd = Infinity;
  for (const n of nodes) {
    if (n.type !== t || n.left <= 0) continue;
    const d2 = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d2 < bd) { bd = d2; best = n; }
  }
  return best;
}

export function harvestNode(n: ResNode) {
  const info = RES_INFO[n.type];
  const b = engine.world.bonus;
  const extra = n.type === 'wood' ? b.woodExtra : n.type === 'stone' ? b.stoneExtra : n.type === 'herb' ? b.herbExtra : 0;
  n.left -= 1;
  if (n.left <= 0) n.regrowAt = engine.clock + info.respawn;
  dirty = true;
  return { item: info.item, amount: info.amount + extra, name: info.name, depleted: n.left <= 0 };
}

/** Regrow depleted nodes (call ~1×/s). */
export function updateResources() {
  const p = engine.player.pos;
  for (const n of nodes) {
    if (n.left > 0 || engine.clock < n.regrowAt) continue;
    if (Math.hypot(p.x - n.x, p.z - n.z) < 30) continue; // don't pop in front of the player
    n.left = RES_INFO[n.type].harvests;
    dirty = true;
  }
}

registerMarkers('resources', (out: Marker[]) => {
  for (const n of nodes) {
    if (n.left <= 0) continue;
    out.push({ x: n.x, y: n.y + (n.type === 'stone' ? 2.0 : 1.7), z: n.z, icon: RES_INFO[n.type].icon, label: RES_INFO[n.type].name });
  }
});

// ---------------------------------------------------------------------------
// Rendering — one InstancedMesh per model part, rebuilt only when nodes change.
// ---------------------------------------------------------------------------
const MODEL_FILE: Record<Exclude<ResType, 'wood'>, string> = { stone: 'Rock Medium.glb', fiber: 'Bush.glb', herb: 'Flower Group.glb' };
const TINT: Record<Exclude<ResType, 'wood'>, string> = { stone: '#9fb4cc', fiber: '#d9f07a', herb: '#ffffff' };

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
const _out = new THREE.Matrix4();

interface Layer { type: ResType; parts: Array<{ mesh: THREE.InstancedMesh; local: THREE.Matrix4 }> }

export function ResourceRenderer({ loadAsset }: { loadAsset: AssetLoader }) {
  const { group, layers } = useMemo(() => {
    const group = new THREE.Group();
    const layers: Layer[] = [];
    const log = new THREE.InstancedMesh(buildLog(), flatMaterial, 128);
    log.count = 0;
    log.frustumCulled = false;
    group.add(log);
    layers.push({ type: 'wood', parts: [{ mesh: log, local: new THREE.Matrix4() }] });
    return { group, layers };
  }, []);

  useEffect(() => {
    let alive = true;
    (Object.keys(MODEL_FILE) as Array<keyof typeof MODEL_FILE>).forEach((type) => {
      loadAsset(MODEL_FILE[type]).then((asset: AssetMesh | null) => {
        if (!alive || !asset) return;
        const parts = asset.parts.map((p) => {
          // private, tinted copy so the forest's shared material is untouched
          const mat = (p.material as THREE.MeshStandardMaterial).clone();
          if ('color' in mat) mat.color.set(TINT[type]);
          mat.transparent = false;
          mat.alphaTest = /grass|rock|bark|mushroom/i.test(mat.name) ? 0 : 0.45;
          mat.side = THREE.DoubleSide;
          mat.depthWrite = true;
          const mesh = new THREE.InstancedMesh(p.geometry, mat, 128);
          mesh.count = 0;
          mesh.frustumCulled = false;
          group.add(mesh);
          return { mesh, local: p.localMatrix };
        });
        layers.push({ type, parts });
        dirty = true;
      });
    });
    return () => { alive = false; };
  }, [loadAsset, group, layers]);

  useFrame(() => {
    if (!dirty) return;
    dirty = false;
    for (const L of layers) {
      let n = 0;
      for (const node of nodes) {
        if (node.type !== L.type || node.left <= 0) continue;
        const info = RES_INFO[node.type];
        const grow = 0.6 + 0.4 * (node.left / info.harvests); // shrinks as you harvest
        const s = node.scale * grow;
        _q.setFromAxisAngle(_Y, node.rot);
        _m.compose(_p.set(node.x, node.y - (node.type === 'stone' ? 0.15 : 0), node.z), _q, _s.set(s, s, s));
        for (const part of L.parts) {
          if (n >= part.mesh.instanceMatrix.count) continue;
          part.mesh.setMatrixAt(n, _out.multiplyMatrices(_m, part.local));
        }
        n++;
      }
      for (const part of L.parts) {
        part.mesh.count = Math.min(n, part.mesh.instanceMatrix.count);
        part.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  });

  return <primitive object={group} />;
}
