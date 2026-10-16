/**
 * Buildings.tsx — settlement structures.
 *  - Kath-Kuni style meshes (one draw call each) from models.ts.
 *  - Live placement preview: the real building, tinted green (valid) or red (invalid) with
 *    the reason shown in the HUD. Bridges snap across the river.
 *  - Player collision, walkable bridge deck, production table for the economy.
 */
import { useFrame } from '@react-three/fiber';
import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { engine } from './engine';
import { BRIDGE_DECK_Y, BRIDGE_LENGTH, flatMaterial, FOOTPRINT, getBuildingGeometry } from './models';
import { getTerrainHeight, RIVER_HEAD_Z, RIVER_X, riverMask } from './terrain';
import type { BuildingStructure } from './types';

export const SETTLEMENT_LIMIT = 85; // metres from the hearth buildings may be placed

/** Passive production per building level (casual economy loop). */
export const PRODUCTION: Record<string, { every: number; give: Record<string, number>; label: string }> = {
  hunter_hut: { every: 60, give: { arrow: 8 }, label: '+8 arrows / min' },
  carpenter_workshop: { every: 45, give: { wood: 4 }, label: '+4 timber / 45 s' },
  herbalist_lodge: { every: 50, give: { herb: 2, fiber: 2 }, label: '+2 herbs, +2 fibre / 50 s' },
  watchtower: { every: 75, give: { stone: 3 }, label: '+3 slate / 75 s, reveals wildlife on radar' },
};

export interface PlacementCheck { ok: boolean; reason: string; x: number; y: number; z: number; rot: number }

function bridgeY(z: number, rot: number) {
  const hx = Math.cos(rot) * (BRIDGE_LENGTH / 2 - 0.8);
  const hz = -Math.sin(rot) * (BRIDGE_LENGTH / 2 - 0.8);
  const a = getTerrainHeight(RIVER_X + hx, z + hz);
  const b = getTerrainHeight(RIVER_X - hx, z - hz);
  return Math.max(a, b, 0) + 0.15 - BRIDGE_DECK_Y;
}

export function checkPlacement(b: BuildingStructure, x: number, z: number, rot: number, all: readonly BuildingStructure[]): PlacementCheck {
  if (b.type === 'bridge') {
    const ok = z > RIVER_HEAD_Z + 12 && riverMask(RIVER_X, z) > 0.5;
    return { ok, reason: ok ? '' : 'Bridges must span the river', x: RIVER_X, y: bridgeY(z, 0), z, rot: 0 };
  }
  const r = FOOTPRINT[b.type] ?? 3;
  const samples: number[] = [];
  for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) samples.push(getTerrainHeight(x + ox, z + oz));
  const y = Math.min(...samples);
  const res = (reason: string) => ({ ok: reason === '', reason, x, y, z, rot });
  if (Math.hypot(x, z) > SETTLEMENT_LIMIT) return res('Too far from the village hearth');
  if (riverMask(x, z) > 0.02 || y < -0.3) return res('Too close to the water');
  if (Math.max(...samples) - y > 1.5) return res('Ground is too steep');
  for (const o of all) {
    if (!o.built || o.id === b.id || o.type === 'bridge') continue;
    const need = r + (FOOTPRINT[o.type] ?? 3) + 0.6;
    if (Math.hypot(o.position[0] - x, o.position[2] - z) < need) return res(`Too close to ${o.name}`);
  }
  return res('');
}

/** Push a moving point out of building footprints. */
export function resolveBuildingCollision(pos: { x: number; z: number }, radius = 0.35) {
  for (const b of engine.world.buildings) {
    if (!b.built || b.type === 'bridge') continue;
    const r = (FOOTPRINT[b.type] ?? 3) * 0.85 + radius;
    const dx = pos.x - b.position[0], dz = pos.z - b.position[2];
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      pos.x = b.position[0] + (dx / d) * r;
      pos.z = b.position[2] + (dz / d) * r;
    }
  }
}

/** Ground height including walkable bridge decks. */
export function walkHeight(x: number, z: number) {
  let h = getTerrainHeight(x, z);
  for (const b of engine.world.buildings) {
    if (!b.built || b.type !== 'bridge') continue;
    const c = Math.cos(b.rotationY), s = Math.sin(b.rotationY);
    const lx = (x - b.position[0]) * c - (z - b.position[2]) * s;
    const lz = (x - b.position[0]) * s + (z - b.position[2]) * c;
    if (Math.abs(lx) < BRIDGE_LENGTH / 2 && Math.abs(lz) < 1.5) h = Math.max(h, b.position[1] + BRIDGE_DECK_Y);
  }
  return h;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,220,140,1)');
  gr.addColorStop(0.3, 'rgba(255,150,50,0.5)');
  gr.addColorStop(1, 'rgba(255,110,20,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
let _glow: THREE.Texture | null = null;
export const getGlowTexture = () => (_glow ??= glowTexture());

export function CampfireFx({ x, y, z, scale = 1 }: { x: number; y: number; z: number; scale?: number }) {
  const parts = useMemo(() => {
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 6).translate(0, 0.55, 0), new THREE.MeshBasicMaterial({ color: '#f97316', transparent: true, opacity: 0.9, depthWrite: false }));
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.75, 5).translate(0, 0.38, 0), new THREE.MeshBasicMaterial({ color: '#fde047', transparent: true, opacity: 0.95, depthWrite: false }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false }));
    glow.scale.set(3.2, 3.2, 1);
    glow.position.y = 0.8;
    // embers rising (animated in the vertex shader, no CPU work)
    const N = 24;
    const g = new THREE.BufferGeometry();
    const seed = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { seed[i * 3] = Math.random(); seed[i * 3 + 1] = Math.random(); seed[i * 3 + 2] = Math.random(); }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    const emberMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `attribute vec3 aSeed; uniform float uTime; varying float vA;
        void main(){ float t = fract(aSeed.y + uTime * (0.25 + aSeed.z * 0.3));
          vec3 p = vec3((aSeed.x - 0.5) * 0.6 + sin(uTime * 2.0 + aSeed.x * 9.0) * 0.15 * t, t * 2.6 + 0.3, (aSeed.z - 0.5) * 0.6);
          vA = 1.0 - t; vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = 90.0 / -mv.z; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(1.0, 0.65, 0.2, vA * (1.0 - d * 2.0)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const embers = new THREE.Points(g, emberMat);
    embers.frustumCulled = false;
    const root = new THREE.Group();
    root.add(outer, inner, glow, embers);
    return { root, outer, inner, glow, emberMat };
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    parts.root.position.set(x, y, z);
    parts.root.scale.setScalar(scale);
    parts.outer.scale.set(1 + Math.sin(t * 9) * 0.06, 1 + Math.sin(t * 7.3) * 0.12, 1 + Math.cos(t * 8) * 0.06);
    parts.inner.scale.set(1, 1 + Math.sin(t * 11 + 1) * 0.15, 1);
    parts.outer.rotation.y = t * 0.8;
    const night = engine.isNight ? 1.5 : 1;
    parts.glow.scale.setScalar((3.0 + Math.sin(t * 6) * 0.25) * night);
    parts.emberMat.uniforms.uTime.value = t;
  });
  return <primitive object={parts.root} />;
}

export function BuildingsRenderer({ buildings }: { buildings: BuildingStructure[] }) {
  return (
    <group>
      {buildings.filter((b) => b.built).map((b) => (
        <group key={b.id}>
          <mesh geometry={getBuildingGeometry(b.type)} material={flatMaterial} position={b.position} rotation={[0, b.rotationY, 0]} />
          {b.type === 'campfire' && <CampfireFx x={b.position[0]} y={b.position[1]} z={b.position[2]} />}
        </group>
      ))}
    </group>
  );
}

const previewOk = new THREE.MeshBasicMaterial({ color: '#34d399', transparent: true, opacity: 0.42, depthWrite: false });
const previewBad = new THREE.MeshBasicMaterial({ color: '#f87171', transparent: true, opacity: 0.42, depthWrite: false });

export function PlacementPreview({ type }: { type: string | null }) {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => (type ? getBuildingGeometry(type) : null), [type]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const w = engine.world;
    m.position.set(w.previewPos[0], w.previewPos[1], w.previewPos[2]);
    m.rotation.y = w.previewRot;
    m.material = w.previewValid ? previewOk : previewBad;
  });
  if (!geo) return null;
  return <mesh ref={ref} geometry={geo} material={previewOk} renderOrder={5} />;
}
