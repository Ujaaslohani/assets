/**
 * WorldIcons.tsx — floating, bobbing icons over resources, carcasses, recruitable
 * specialists, landmarks and the current quest target. One THREE.Points draw call.
 * Icons are drawn into a canvas atlas (no emoji fonts needed) and fade with distance.
 */
import { useFrame } from '@react-three/fiber';
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { collectMarkers, engine, type Marker, type MarkerIcon } from './engine';

export const ICON_ORDER: MarkerIcon[] = ['wood', 'stone', 'fiber', 'herb', 'harvest', 'recruit', 'clue', 'quest'];
export const ICON_COLOR: Record<MarkerIcon, string> = {
  wood: '#c2773a', stone: '#7d9bc1', fiber: '#9bc53d', herb: '#b26ad6', harvest: '#e05d44',
  recruit: '#f2b31d', clue: '#3fb6a8', quest: '#ffd23f', animal: '#e8a15c', building: '#d6c3a1', npc: '#f2d16b',
};
/** Max distance (m) each icon kind is shown in 3D. */
const RANGE: Partial<Record<MarkerIcon, number>> = { wood: 55, stone: 55, fiber: 50, herb: 50, harvest: 70, recruit: 140, clue: 110, quest: 600 };

/** Draws one icon glyph into a 2D context centred at (cx, cy) with radius r. */
export function drawIconGlyph(g: CanvasRenderingContext2D, icon: MarkerIcon, cx: number, cy: number, r: number) {
  g.save();
  g.fillStyle = 'rgba(20,16,12,0.78)';
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.lineWidth = r * 0.14;
  g.strokeStyle = ICON_COLOR[icon];
  g.beginPath(); g.arc(cx, cy, r * 0.9, 0, Math.PI * 2); g.stroke();
  g.fillStyle = ICON_COLOR[icon];
  g.strokeStyle = ICON_COLOR[icon];
  const u = r / 10;
  switch (icon) {
    case 'wood':
      g.fillRect(cx - 5.5 * u, cy - 2.4 * u, 10 * u, 4.8 * u);
      g.fillStyle = '#f0d3a3'; g.beginPath(); g.ellipse(cx + 4.6 * u, cy, 1.8 * u, 2.4 * u, 0, 0, Math.PI * 2); g.fill();
      break;
    case 'stone':
      g.beginPath(); g.moveTo(cx - 5.5 * u, cy + 3.5 * u); g.lineTo(cx - 3.5 * u, cy - 3 * u); g.lineTo(cx + 1 * u, cy - 4.5 * u);
      g.lineTo(cx + 5.5 * u, cy - 1 * u); g.lineTo(cx + 4.5 * u, cy + 3.5 * u); g.closePath(); g.fill();
      break;
    case 'fiber':
      g.lineWidth = 1.6 * u; g.lineCap = 'round';
      for (const k of [-1, 0, 1]) { g.beginPath(); g.moveTo(cx + k * 1.5 * u, cy + 4.5 * u); g.quadraticCurveTo(cx + k * 1.5 * u, cy - 1 * u, cx + k * 4.5 * u, cy - 4.5 * u); g.stroke(); }
      break;
    case 'herb':
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; g.beginPath(); g.arc(cx + Math.cos(a) * 2.6 * u, cy - 0.8 * u + Math.sin(a) * 2.6 * u, 1.9 * u, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#ffe066'; g.beginPath(); g.arc(cx, cy - 0.8 * u, 1.4 * u, 0, Math.PI * 2); g.fill();
      break;
    case 'harvest': // paw print
      g.beginPath(); g.ellipse(cx, cy + 1.8 * u, 3 * u, 2.4 * u, 0, 0, Math.PI * 2); g.fill();
      for (const [dx, dy] of [[-3.4, -1.6], [-1.2, -3.8], [1.2, -3.8], [3.4, -1.6]]) { g.beginPath(); g.arc(cx + dx * u, cy + dy * u, 1.2 * u, 0, Math.PI * 2); g.fill(); }
      break;
    case 'quest':
      g.beginPath(); g.moveTo(cx, cy - 5.5 * u); g.lineTo(cx + 4 * u, cy); g.lineTo(cx, cy + 5.5 * u); g.lineTo(cx - 4 * u, cy); g.closePath(); g.fill();
      break;
    default: {
      const ch = icon === 'recruit' ? '!' : icon === 'clue' ? '?' : '•';
      g.font = `bold ${Math.round(12 * u)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(ch, cx, cy + 0.6 * u);
    }
  }
  g.restore();
}

function makeAtlas() {
  const cell = 64;
  const c = document.createElement('canvas');
  c.width = cell * 4;
  c.height = cell * 2;
  const g = c.getContext('2d')!;
  ICON_ORDER.forEach((icon, i) => drawIconGlyph(g, icon, (i % 4) * cell + cell / 2, Math.floor(i / 4) * cell + cell / 2, cell * 0.44));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 1;
  return t;
}

const MAXP = 256;
const VERT = /* glsl */ `
  attribute float aIcon; attribute float aAlpha; attribute float aSize;
  uniform float uTime; uniform float uPixelRatio;
  varying float vIcon; varying float vAlpha;
  void main() {
    vec3 p = position;
    p.y += sin(uTime * 2.2 + position.x * 0.7 + position.z * 0.3) * 0.12;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio;
    vIcon = aIcon; vAlpha = aAlpha;
  }`;
const FRAG = /* glsl */ `
  uniform sampler2D uAtlas; varying float vIcon; varying float vAlpha;
  void main() {
    vec2 cell = vec2(mod(vIcon, 4.0), floor(vIcon / 4.0));
    vec2 uv = (cell + vec2(gl_PointCoord.x, gl_PointCoord.y)) / vec2(4.0, 2.0);
    uv.y = 1.0 - uv.y;
    vec4 c = texture2D(uAtlas, uv);
    if (c.a < 0.05) discard;
    gl_FragColor = vec4(c.rgb, c.a * vAlpha);
  }`;

export function WorldIcons() {
  const { points, mat, geo } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aIcon', new THREE.BufferAttribute(new Float32Array(MAXP), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(MAXP), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAXP), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: makeAtlas() }, uTime: { value: 0 }, uPixelRatio: { value: 1 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthTest: false, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 900;
    return { points, mat, geo };
  }, []);
  const markers = useMemo<Marker[]>(() => [], []);

  useFrame(({ gl, clock }) => {
    points.visible = engine.playing && !engine.uiOpen;
    if (!points.visible) return;
    mat.uniforms.uTime.value = clock.elapsedTime;
    mat.uniforms.uPixelRatio.value = gl.getPixelRatio();
    collectMarkers(markers);
    const q = engine.questTarget;
    if (q) markers.push({ x: q.x, y: getQuestY(q.x, q.z), z: q.z, icon: 'quest' });

    const pos = geo.attributes.position.array as Float32Array;
    const ic = geo.attributes.aIcon.array as Float32Array;
    const al = geo.attributes.aAlpha.array as Float32Array;
    const sz = geo.attributes.aSize.array as Float32Array;
    const p = engine.player.pos;
    let n = 0;
    for (const m of markers) {
      const idx = ICON_ORDER.indexOf(m.icon);
      if (idx < 0 || n >= MAXP) continue;
      const range = RANGE[m.icon] ?? 60;
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d > range || (m.icon !== 'quest' && d < 2.2)) continue;
      pos[n * 3] = m.x; pos[n * 3 + 1] = m.y; pos[n * 3 + 2] = m.z;
      ic[n] = idx;
      al[n] = Math.min(1, (range - d) / (range * 0.3)) * (m.icon === 'quest' && d < 8 ? d / 8 : 1);
      sz[n] = (m.icon === 'quest' ? 40 : 34) * THREE.MathUtils.clamp(16 / Math.max(d, 1), 0.55, 1.15);
      n++;
    }
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aIcon.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  });

  return <primitive object={points} />;
}

import { getTerrainHeight } from './terrain';
function getQuestY(x: number, z: number) {
  return getTerrainHeight(x, z) + 3.2;
}
