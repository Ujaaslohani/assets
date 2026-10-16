/**
 * WorldMap.tsx — the [M] map: rendered terrain (trails, river, cliffs) with you, buildings,
 * specialists, landmarks, resources and the current objective.
 */
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { collectMarkers, engine, type Marker } from './engine';
import { getTerrainColor, getTerrainHeight, MAP_HALF } from './terrain';
import { drawIconGlyph, ICON_COLOR } from './WorldIcons';

let mapImage: string | null = null;
function terrainImage() {
  if (mapImage) return mapImage;
  const N = 200;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  const col = new THREE.Color();
  const step = (MAP_HALF * 2) / N;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -MAP_HALF + (i + 0.5) * step, z = -MAP_HALF + (j + 0.5) * step;
      const h = getTerrainHeight(x, z);
      const hx = getTerrainHeight(x + step, z) - getTerrainHeight(x - step, z);
      const hz = getTerrainHeight(x, z + step) - getTerrainHeight(x, z - step);
      const ny = 1 / Math.sqrt(1 + (hx / (2 * step)) ** 2 + (hz / (2 * step)) ** 2);
      getTerrainColor(x, z, h, ny, col);
      if (h < -0.9) col.set('#4f9cc4');
      const shade = 1 + (hz - hx) * 0.06; // light from the north-west
      const k = (j * N + i) * 4;
      img.data[k] = Math.min(255, col.r * 255 * shade);
      img.data[k + 1] = Math.min(255, col.g * 255 * shade);
      img.data[k + 2] = Math.min(255, col.b * 255 * shade);
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  mapImage = c.toDataURL();
  return mapImage;
}

const pct = (v: number) => `${50 + (v / MAP_HALF) * 50}%`;

export function WorldMap() {
  const src = useMemo(terrainImage, []);
  const markers = useMemo(() => collectMarkers([] as Marker[]).slice(), []);
  const p = engine.player.pos;
  const q = engine.questTarget;
  const icons = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of ['recruit', 'clue', 'quest', 'harvest'] as const) {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      drawIconGlyph(c.getContext('2d')!, k, 16, 16, 15);
      m.set(k, c.toDataURL());
    }
    return m;
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-full max-w-[460px] aspect-square rounded-xl overflow-hidden border-2 border-amber-900/60 shadow-inner">
        <img src={src} alt="" className="absolute inset-0 w-full h-full" style={{ imageRendering: 'auto' }} />
        {markers.filter((m) => ['wood', 'stone', 'fiber', 'herb'].includes(m.icon)).map((m, i) => (
          <div key={`r${i}`} className="absolute w-1.5 h-1.5 rounded-full -translate-x-1/2 -translate-y-1/2 ring-1 ring-black/40"
            style={{ left: pct(m.x), top: pct(m.z), background: ICON_COLOR[m.icon] }} />
        ))}
        {engine.world.buildings.filter((b) => b.built).map((b) => (
          <div key={b.id} title={b.name} className="absolute w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 bg-amber-100 border border-stone-900"
            style={{ left: pct(b.position[0]), top: pct(b.position[2]) }} />
        ))}
        {markers.filter((m) => m.icon === 'recruit' || m.icon === 'clue' || m.icon === 'harvest').map((m, i) => (
          <img key={`m${i}`} src={icons.get(m.icon)} title={m.label} alt="" className="absolute w-5 h-5 -translate-x-1/2 -translate-y-1/2"
            style={{ left: pct(m.x), top: pct(m.z) }} />
        ))}
        {q && <img src={icons.get('quest')} title={q.label} alt="" className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 animate-pulse" style={{ left: pct(q.x), top: pct(q.z) }} />}
        <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: pct(p.x), top: pct(p.z), transform: `translate(-50%,-50%) rotate(${-engine.player.yaw}rad)` }}>
          <svg width="18" height="18" viewBox="-9 -9 18 18"><path d="M0,-8 L6,7 L0,3 L-6,7 Z" fill="#fff7d6" stroke="#1c1917" strokeWidth="1.2" /></svg>
        </div>
        <span className="absolute top-1 left-1/2 -translate-x-1/2 text-xs font-black text-red-300 drop-shadow">N</span>
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-stone-300">
        {([['wood', 'Timber'], ['stone', 'Slate'], ['fiber', 'Nettle fibre'], ['herb', 'Herbs']] as const).map(([k, l]) => (
          <span key={k} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: ICON_COLOR[k] }} />{l}</span>
        ))}
        <span className="flex items-center gap-1"><img src={icons.get('recruit')} alt="" className="w-3.5 h-3.5" />Specialist</span>
        <span className="flex items-center gap-1"><img src={icons.get('clue')} alt="" className="w-3.5 h-3.5" />Landmark</span>
        <span className="flex items-center gap-1"><img src={icons.get('quest')} alt="" className="w-3.5 h-3.5" />Objective</span>
      </div>
      {q && <div className="text-xs text-amber-300 font-bold">Objective: {q.label}</div>}
    </div>
  );
}
