/**
 * Npcs.tsx — the four village specialists.
 *  - Not recruited yet: each waits at a small camp (tent + fire) out in the valley, with a
 *    gold "!" marker visible from far away, a radar dot and a compass marker.
 *  - Recruited: walks back to the village, then wanders near their workplace, pauses,
 *    and turns to face you when you come close.
 *  - Model: torso, head, two arms, two legs (6 meshes each) with walk animation.
 */
import { useFrame } from '@react-three/fiber';
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { engine, type Marker, registerMarkers, turnToward, wrapAngle } from './engine';
import { resolveTreeCollision } from './ForestStreamer';
import { buildHuman, flatMaterial, getBuildingGeometry } from './models';
import { getTerrainHeight } from './terrain';
import { getShadowMaterial, shadowGeometry } from './Wildlife';

/** Where each specialist is first found, and where they live once recruited. */
export const CAMPS: Record<string, { camp: [number, number]; home: [number, number]; area: string }> = {
  hunter: { camp: [5, -4], home: [5, -4], area: 'the village' },
  carpenter: { camp: [62, 58], home: [-7, 7], area: 'the eastern pine woods' },
  herbalist: { camp: [-62, -38], home: [9, 8], area: 'the meadows west of the river' },
  builder: { camp: [22, -118], home: [-6, -9], area: 'the northern ruins' },
};

interface NpcRt {
  id: string;
  name: string;
  x: number; y: number; z: number;
  yaw: number;
  headYaw: number;
  phase: number;
  speed: number;
  mode: 'idle' | 'wander' | 'travel';
  tx: number; tz: number;
  t: number;
  recruited: boolean;
  travelT: number;
}
const npcs = new Map<string, NpcRt>();

function homeOf(id: string, recruited: boolean) {
  const c = CAMPS[id];
  return recruited ? c.home : c.camp;
}

/** Keep runtime NPCs in sync with React's specialist list. */
let lastList: ReadonlyArray<{ id: string; name: string; recruited: boolean }> = [];
export function syncNpcs(list: ReadonlyArray<{ id: string; name: string; recruited: boolean }>) {
  lastList = list;
  for (const s of list) {
    let n = npcs.get(s.id);
    if (!n) {
      const [x, z] = homeOf(s.id, s.recruited);
      n = { id: s.id, name: s.name, x, z, y: getTerrainHeight(x, z), yaw: Math.PI, headYaw: 0, phase: 0, speed: 0, mode: 'idle', tx: x, tz: z, t: 2, recruited: s.recruited, travelT: 0 };
      npcs.set(s.id, n);
    }
    if (!s.recruited && n.recruited) {
      // restarted: back to the camp
      const [x, z] = CAMPS[s.id].camp;
      Object.assign(n, { x, z, y: getTerrainHeight(x, z), recruited: false, mode: 'idle', t: 2 });
    }
    if (s.recruited && !n.recruited) {
      n.recruited = true;
      n.mode = 'travel';
      const [hx, hz] = CAMPS[s.id].home;
      n.tx = hx; n.tz = hz;
      n.travelT = 0;
    }
  }
}

export function resetNpcs() {
  npcs.clear();
  syncNpcs(lastList);
}

export function findNpc(x: number, z: number, r: number) {
  let best: NpcRt | null = null;
  let bd = r * r;
  npcs.forEach((n) => {
    const d2 = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d2 < bd) { bd = d2; best = n; }
  });
  return best as NpcRt | null;
}

export function npcPosition(id: string) {
  const n = npcs.get(id);
  return n ? { x: n.x, z: n.z } : null;
}

export function updateNpcs(dt: number) {
  const p = engine.player.pos;
  npcs.forEach((n) => {
    const dx = p.x - n.x, dz = p.z - n.z;
    const dPlayer = Math.hypot(dx, dz);
    const [hx, hz] = homeOf(n.id, n.recruited);
    let wantSpeed = 0;

    if (n.mode === 'travel') {
      n.travelT += dt;
      const d = Math.hypot(n.tx - n.x, n.tz - n.z);
      // long trips finish off-screen so the player never waits on them
      if (d < 1 || (n.travelT > 45 && dPlayer > 60)) {
        if (d >= 1) { n.x = n.tx; n.z = n.tz; }
        n.mode = 'idle';
        n.t = 3;
      } else {
        wantSpeed = 2.6;
        n.yaw = turnToward(n.yaw, Math.atan2(n.tx - n.x, n.tz - n.z), dt * 4);
      }
    } else if (n.mode === 'wander') {
      const d = Math.hypot(n.tx - n.x, n.tz - n.z);
      if (d < 0.5 || dPlayer < 4) {
        n.mode = 'idle';
        n.t = 3 + Math.random() * 6;
      } else {
        wantSpeed = 1.1;
        n.yaw = turnToward(n.yaw, Math.atan2(n.tx - n.x, n.tz - n.z), dt * 3);
      }
    } else {
      n.t -= dt;
      if (dPlayer < 6) n.yaw = turnToward(n.yaw, Math.atan2(dx, dz), dt * 2.5); // face the player
      if (n.t <= 0 && dPlayer > 5) {
        const a = Math.random() * Math.PI * 2, r = n.recruited ? 1.5 + Math.random() * 3.5 : 1 + Math.random() * 2;
        n.tx = hx + Math.cos(a) * r;
        n.tz = hz + Math.sin(a) * r;
        n.mode = 'wander';
      }
    }

    n.speed += (wantSpeed - n.speed) * Math.min(1, dt * 5);
    n.x += Math.sin(n.yaw) * n.speed * dt;
    n.z += Math.cos(n.yaw) * n.speed * dt;
    if (n.mode === 'travel') resolveTreeCollision(n, 0.3);
    n.y = getTerrainHeight(n.x, n.z);
    n.phase += dt * n.speed * 3.4;
    const look = dPlayer < 7 ? THREE.MathUtils.clamp(wrapAngle(Math.atan2(dx, dz) - n.yaw), -1, 1) : 0;
    n.headYaw += (look - n.headYaw) * Math.min(1, dt * 4);
  });
}

registerMarkers('npcs', (out: Marker[]) => {
  npcs.forEach((n) => {
    out.push({ x: n.x, y: n.y + 2.35, z: n.z, icon: n.recruited ? 'npc' : 'recruit', label: n.name });
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function nameplate(text: string) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.font = 'bold 44px Georgia, serif';
  const w = Math.min(500, g.measureText(text).width + 48);
  g.fillStyle = 'rgba(20,16,12,0.72)';
  g.beginPath();
  g.roundRect((512 - w) / 2, 14, w, 66, 33);
  g.fill();
  g.fillStyle = '#fde68a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 49);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true, fog: false }));
  s.scale.set(2.4, 0.45, 1);
  s.renderOrder = 800;
  return s;
}

interface Rig {
  id: string;
  root: THREE.Group;
  head: THREE.Mesh; arms: THREE.Mesh[]; legs: THREE.Mesh[];
  plate: THREE.Sprite;
  shadow: THREE.Mesh;
  pivots: ReturnType<typeof buildHuman>;
}

export function NpcRenderer({ ids }: { ids: Array<{ id: string; name: string }> }) {
  const { group, rigs, camps } = useMemo(() => {
    const group = new THREE.Group();
    const rigs: Rig[] = ids.map(({ id, name }) => {
      const M = buildHuman(id);
      const root = new THREE.Group();
      const torso = new THREE.Mesh(M.torso, flatMaterial);
      const head = new THREE.Mesh(M.head, flatMaterial);
      head.position.set(...M.headPivot);
      const arms = M.armPivots.map((pv) => { const m = new THREE.Mesh(M.arm, flatMaterial); m.position.set(...pv); return m; });
      const legs = M.legPivots.map((pv) => { const m = new THREE.Mesh(M.leg, flatMaterial); m.position.set(...pv); return m; });
      arms[0].rotation.z = 0.12;
      arms[1].rotation.z = -0.12;
      root.add(torso, head, ...arms, ...legs);
      const plate = nameplate(name);
      plate.position.set(0, 2.05, 0);
      root.add(plate);
      const shadow = new THREE.Mesh(shadowGeometry, getShadowMaterial());
      shadow.scale.set(0.45, 1, 0.45);
      shadow.renderOrder = 1;
      group.add(root, shadow);
      return { id, root, head, arms, legs, plate, shadow, pivots: M };
    });
    // camps for specialists who start out in the wild
    const camps = new THREE.Group();
    const fire = getBuildingGeometry('campfire');
    Object.entries(CAMPS).forEach(([id, c]) => {
      if (id === 'hunter') return;
      const [x, z] = c.camp;
      const y = getTerrainHeight(x + 2.5, z + 1.5);
      const tent = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.2, 4).translate(0, 1.1, 0), new THREE.MeshLambertMaterial({ color: '#cbb994', flatShading: true }));
      tent.position.set(x - 2.2, getTerrainHeight(x - 2.2, z - 1.2), z - 1.2);
      tent.rotation.y = 0.6;
      const f = new THREE.Mesh(fire, flatMaterial);
      f.scale.setScalar(0.6);
      f.position.set(x + 2.5, y, z + 1.5);
      camps.add(tent, f);
    });
    group.add(camps);
    return { group, rigs, camps };
  }, [ids]);

  useFrame(() => {
    const p = engine.player.pos;
    for (const r of rigs) {
      const n = npcs.get(r.id);
      r.root.visible = !!n;
      r.shadow.visible = !!n;
      if (!n) continue;
      const far = Math.abs(n.x - p.x) > 110 || Math.abs(n.z - p.z) > 110;
      r.root.visible = !far;
      r.shadow.visible = !far;
      if (far) continue;
      const bob = Math.abs(Math.sin(n.phase)) * Math.min(0.05, n.speed * 0.02);
      r.root.position.set(n.x, n.y + bob, n.z);
      r.root.rotation.y = n.yaw;
      r.shadow.position.set(n.x, n.y + 0.04, n.z);
      const swing = Math.sin(n.phase) * Math.min(0.7, n.speed * 0.3);
      const idle = n.speed < 0.1 ? Math.sin(engine.clock * 1.6 + n.x) * 0.04 : 0;
      r.arms[0].rotation.x = -swing + idle;
      r.arms[1].rotation.x = swing - idle;
      r.legs[0].rotation.x = swing;
      r.legs[1].rotation.x = -swing;
      r.head.rotation.y = n.headYaw;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      r.plate.visible = d < 22;
    }
    camps.visible = true;
  });

  return <primitive object={group} />;
}
