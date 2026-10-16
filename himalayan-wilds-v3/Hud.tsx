/**
 * Hud.tsx — in-game overlay driven straight from the engine store with requestAnimationFrame.
 * Nothing here re-renders React per frame: the compass, radar, crosshair and prompt write to
 * the DOM / a canvas directly. Only the gather popups use React state (event driven).
 *
 *  - Compass bar: objective (gold), nearest timber/slate/fibre/herb, specialists to recruit,
 *    landmarks, the village — each with distance.
 *  - Radar: 70 m around you, rotates with your view, shows trails, river, buildings,
 *    resources, carcasses, NPCs and (with the Hunter / Watchtower) wildlife.
 *  - Crosshair with bow-draw ring, hit marker, stealth status, interaction prompt.
 */
import React, { useEffect, useRef, useState } from 'react';
import { collectMarkers, engine, type Marker, type MarkerIcon, relativeBearing } from './engine';
import { nearestOfType, type ResType } from './Resources';
import { MAP_HALF, RIVER_HEAD_Z, RIVER_X, trailEW, trailNS } from './terrain';
import { drawIconGlyph, ICON_COLOR } from './WorldIcons';

const iconUrls = new Map<MarkerIcon, string>();
function iconUrl(icon: MarkerIcon) {
  let u = iconUrls.get(icon);
  if (!u) {
    const c = document.createElement('canvas');
    c.width = c.height = 40;
    drawIconGlyph(c.getContext('2d')!, icon, 20, 20, 18);
    u = c.toDataURL();
    iconUrls.set(icon, u);
  }
  return u;
}

interface Popup { id: number; text: string; color: string }
let popupId = 1;

export function formatClock(hours: number) {
  const total = Math.floor(hours * 60);
  const h = Math.floor(total / 60) % 24, m = total % 60;
  const phase = hours >= 4.5 && hours < 7 ? 'Dawn' : hours < 11.5 && hours >= 7 ? 'Morning' : hours < 15.5 && hours >= 11.5 ? 'Midday'
    : hours < 18 && hours >= 15.5 ? 'Afternoon' : hours < 21 && hours >= 18 ? 'Dusk' : 'Night';
  return { time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, phase };
}

/** Small self-updating clock for the top bar. */
export function ClockChip() {
  const [t, setT] = useState(() => formatClock(engine.time));
  useEffect(() => {
    const id = setInterval(() => setT(formatClock(engine.time)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="bg-stone-900/70 px-2.5 py-1 rounded-lg border border-amber-800/40 shadow">
      <div className="text-[8px] uppercase tracking-wider text-amber-400/90 font-bold">{t.phase}</div>
      <div className="text-[11px] font-mono font-bold text-stone-200">{t.time}</div>
    </div>
  );
}

const COMPASS_SLOTS = 14;
const RADAR_RANGE = 70;

export function Hud({ isMobile }: { isMobile: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const cardinalRef = useRef<HTMLDivElement>(null);
  const radarRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const reticleRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  const stealthRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const [popups, setPopups] = useState<Popup[]>([]);

  useEffect(() => {
    let raf = 0;
    let lastRadar = 0;
    let hitT = 0, knockT = 0;
    const markers: Marker[] = [];
    const slots: HTMLDivElement[] = [];
    const comp = compassRef.current!;
    for (let i = 0; i < COMPASS_SLOTS; i++) {
      const d = document.createElement('div');
      d.className = 'absolute top-0 flex flex-col items-center -translate-x-1/2 transition-none';
      d.innerHTML = '<img style="width:20px;height:20px" /><span style="font-size:9px;line-height:10px;font-weight:700;color:#fde68a;text-shadow:0 1px 2px #000"></span>';
      d.style.display = 'none';
      comp.appendChild(d);
      slots.push(d);
    }
    const cardinals = ['N', 'E', 'S', 'W'].map((t, i) => {
      const s = document.createElement('span');
      s.textContent = t;
      s.className = 'absolute -translate-x-1/2 text-[11px] font-black';
      s.style.top = '22px';
      s.style.color = i === 0 ? '#f87171' : '#e7e5e4';
      cardinalRef.current!.appendChild(s);
      return { el: s, yaw: [0, -Math.PI / 2, Math.PI, Math.PI / 2][i] }; // yaw that looks N/E/S/W
    });

    const showCompass = (slot: number, bearing: number, icon: MarkerIcon, dist: number) => {
      const el = slots[slot];
      const half = Math.PI / 2;
      if (Math.abs(bearing) > half) { el.style.display = 'none'; return; }
      el.style.display = 'flex';
      el.style.left = `${50 - (bearing / half) * 50}%`;
      const img = el.firstChild as HTMLImageElement;
      const url = iconUrl(icon);
      if (img.src !== url) img.src = url;
      (el.lastChild as HTMLSpanElement).textContent = dist < 1000 ? `${Math.round(dist)}m` : '';
      el.style.opacity = icon === 'quest' ? '1' : '0.9';
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const root = rootRef.current;
      if (!root) return;
      const visible = engine.playing && !engine.uiOpen;
      root.style.display = visible ? 'block' : 'none';
      if (!visible) return;
      const p = engine.player.pos;
      const B = engine.bow;

      // --- events -> popups / hit marker / knock vignette
      if (engine.events.length) {
        const add: Popup[] = [];
        for (const e of engine.events) {
          if (e.kind === 'popup') add.push({ id: popupId++, text: e.text, color: e.color ?? '#fde68a' });
          else if (e.kind === 'hit') {
            hitT = now;
            hitRef.current!.style.color = e.kill ? '#f87171' : '#fde68a';
            if (e.headshot) add.push({ id: popupId++, text: 'Headshot!', color: '#fca5a5' });
          } else if (e.kind === 'knock') knockT = now;
        }
        engine.events.length = 0;
        if (add.length) {
          setPopups((prev) => [...prev, ...add].slice(-5));
          setTimeout(() => setPopups((prev) => prev.filter((x) => !add.includes(x))), 2200);
        }
      }
      hitRef.current!.style.opacity = String(Math.max(0, 1 - (now - hitT) / 350));
      vignetteRef.current!.style.opacity = String(Math.max(0, 0.75 - (now - knockT) / 900));

      // --- crosshair + draw ring
      const ring = ringRef.current!;
      const C = 2 * Math.PI * 15;
      ring.style.strokeDasharray = `${C * B.draw} ${C}`;
      ring.style.stroke = B.draw >= 1 ? '#34d399' : '#fbbf24';
      reticleRef.current!.style.transform = `translate(-50%,-50%) scale(${B.aiming ? 0.8 : 1})`;
      const prompt = engine.world.placing ? (engine.world.previewValid ? 'Click to place · Q/E rotate · Esc cancel' : engine.world.previewReason) : engine.nearbyPrompt;
      const pr = promptRef.current!;
      if (pr.textContent !== (prompt ?? '')) pr.textContent = prompt ?? '';
      pr.style.color = engine.world.placing && !engine.world.previewValid ? '#fca5a5' : '#fcd34d';
      const st = stealthRef.current!;
      const stealth = engine.player.crouching ? 'Crouching · quiet' : engine.player.sprinting ? 'Sprinting · loud' : '';
      if (st.textContent !== stealth) st.textContent = stealth;

      // --- compass
      const yaw = engine.player.yaw;
      for (const c of cardinals) {
        let b = c.yaw - yaw;
        b = Math.atan2(Math.sin(b), Math.cos(b));
        c.el.style.display = Math.abs(b) > Math.PI / 2 ? 'none' : 'block';
        c.el.style.left = `${50 - (b / (Math.PI / 2)) * 50}%`;
      }
      let slot = 0;
      const q = engine.questTarget;
      if (q) showCompass(slot++, relativeBearing(q.x, q.z), 'quest', Math.hypot(q.x - p.x, q.z - p.z));
      for (const t of ['wood', 'stone', 'fiber', 'herb'] as ResType[]) {
        const n = nearestOfType(t, p.x, p.z);
        if (n && slot < COMPASS_SLOTS) showCompass(slot++, relativeBearing(n.x, n.z), t, Math.hypot(n.x - p.x, n.z - p.z));
      }
      collectMarkers(markers);
      for (const m of markers) {
        if (slot >= COMPASS_SLOTS) break;
        if (m.icon !== 'recruit' && m.icon !== 'clue' && m.icon !== 'harvest') continue;
        const d = Math.hypot(m.x - p.x, m.z - p.z);
        if (m.icon === 'harvest' && d > 90) continue;
        showCompass(slot++, relativeBearing(m.x, m.z), m.icon, d);
      }
      for (let i = slot; i < COMPASS_SLOTS; i++) slots[i].style.display = 'none';

      // --- radar (20 Hz)
      if (now - lastRadar > 50) {
        lastRadar = now;
        drawRadar(radarRef.current!, markers, isMobile);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      slots.forEach((s) => s.remove());
      cardinals.forEach((c) => c.el.remove());
    };
  }, [isMobile]);

  const radarSize = isMobile ? 112 : 160;
  return (
    <div ref={rootRef} className="absolute inset-0 pointer-events-none z-10" style={{ display: 'none' }}>
      {/* compass */}
      <div className="absolute left-1/2 -translate-x-1/2 overflow-hidden rounded-lg border border-amber-900/40 bg-stone-950/45"
        style={{ top: isMobile ? 58 : 70, width: isMobile ? '62vw' : 'min(520px, 60vw)', height: 38 }}>
        <div ref={cardinalRef} className="absolute inset-0" />
        <div ref={compassRef} className="absolute inset-0" style={{ top: 2 }} />
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-amber-300/60" />
      </div>

      {/* radar */}
      <div className="absolute rounded-full border-2 border-amber-800/60 shadow-xl overflow-hidden bg-stone-950/40"
        style={isMobile ? { top: 104, left: 10, width: radarSize, height: radarSize } : { bottom: 18, left: 18, width: radarSize, height: radarSize }}>
        <canvas ref={radarRef} width={radarSize * 2} height={radarSize * 2} style={{ width: radarSize, height: radarSize }} />
      </div>

      {/* crosshair */}
      <div ref={reticleRef} className="absolute left-1/2 top-1/2" style={{ transform: 'translate(-50%,-50%)' }}>
        <svg width="40" height="40" viewBox="0 0 40 40" className="block">
          <circle cx="20" cy="20" r="15" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2.5" />
          <circle ref={ringRef} cx="20" cy="20" r="15" fill="none" strokeWidth="2.5" strokeLinecap="round" transform="rotate(-90 20 20)" />
          <circle cx="20" cy="20" r="1.8" fill="white" opacity="0.9" />
        </svg>
        <div ref={hitRef} className="absolute inset-0 flex items-center justify-center text-2xl font-black" style={{ opacity: 0 }}>✕</div>
      </div>
      <div ref={promptRef} className="absolute left-1/2 -translate-x-1/2 text-center text-xs sm:text-sm font-bold tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]" style={{ top: 'calc(50% - 46px)' }} />
      <div ref={stealthRef} className="absolute left-1/2 -translate-x-1/2 text-[10px] font-bold text-stone-200/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]" style={{ top: 'calc(50% + 26px)' }} />

      {/* gather popups */}
      <div className="absolute flex flex-col items-start gap-1" style={{ left: 'calc(50% + 34px)', top: 'calc(50% - 10px)' }}>
        {popups.map((p) => (
          <div key={p.id} className="hud-pop text-sm font-black drop-shadow-[0_2px_3px_rgba(0,0,0,0.95)]" style={{ color: p.color }}>{p.text}</div>
        ))}
      </div>
      <div ref={vignetteRef} className="absolute inset-0" style={{ opacity: 0, background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(185,28,28,0.65) 100%)' }} />
      <style>{`.hud-pop{animation:hudpop 2.2s ease-out forwards}@keyframes hudpop{0%{opacity:0;transform:translateY(6px) scale(.9)}12%{opacity:1;transform:translateY(0) scale(1.05)}70%{opacity:1}100%{opacity:0;transform:translateY(-26px)}}`}</style>
    </div>
  );
}

function drawRadar(cv: HTMLCanvasElement, markers: Marker[], small: boolean) {
  const g = cv.getContext('2d')!;
  const W = cv.width, R = W / 2;
  const p = engine.player.pos;
  const yaw = engine.player.yaw;
  const s = R / RADAR_RANGE;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const tx = (x: number, z: number): [number, number] => {
    const dx = x - p.x, dz = z - p.z;
    return [R + (dx * rx + dz * rz) * s, R - (dx * fx + dz * fz) * s];
  };
  g.clearRect(0, 0, W, W);
  g.save();
  g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();
  g.fillStyle = 'rgba(38,52,30,0.72)'; g.fillRect(0, 0, W, W);
  for (const rr of [0.33, 0.66]) { g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1.5; g.beginPath(); g.arc(R, R, R * rr, 0, Math.PI * 2); g.stroke(); }

  // trails
  g.strokeStyle = 'rgba(196,160,104,0.85)'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath();
  for (let z = p.z - RADAR_RANGE * 1.5; z <= p.z + RADAR_RANGE * 1.5; z += 4) { const [a, b] = tx(trailNS(z), z); z === p.z - RADAR_RANGE * 1.5 ? g.moveTo(a, b) : g.lineTo(a, b); }
  g.stroke();
  g.beginPath();
  for (let x = p.x - RADAR_RANGE * 1.5; x <= p.x + RADAR_RANGE * 1.5; x += 4) { const [a, b] = tx(x, trailEW(x)); x === p.x - RADAR_RANGE * 1.5 ? g.moveTo(a, b) : g.lineTo(a, b); }
  g.stroke();
  // river
  g.strokeStyle = 'rgba(70,160,210,0.9)'; g.lineWidth = 14 * s * 1.1;
  const [r0x, r0y] = tx(RIVER_X, Math.max(RIVER_HEAD_Z, p.z - 200));
  const [r1x, r1y] = tx(RIVER_X, Math.min(MAP_HALF, p.z + 200));
  g.beginPath(); g.moveTo(r0x, r0y); g.lineTo(r1x, r1y); g.stroke();

  // buildings
  for (const b of engine.world.buildings) {
    if (!b.built) continue;
    const [x, y] = tx(b.position[0], b.position[2]);
    g.fillStyle = '#e7d3ac'; g.fillRect(x - 6, y - 6, 12, 12);
  }
  // markers
  const q = engine.questTarget;
  for (const m of markers) {
    const d = Math.hypot(m.x - p.x, m.z - p.z);
    if (d > RADAR_RANGE * 1.05) continue;
    const [x, y] = tx(m.x, m.z);
    const big = m.icon === 'recruit' || m.icon === 'harvest' || m.icon === 'clue';
    if (big) drawIconGlyph(g, m.icon, x, y, 11);
    else { g.fillStyle = ICON_COLOR[m.icon]; g.beginPath(); g.arc(x, y, m.icon === 'animal' ? 4.5 : 5.5, 0, Math.PI * 2); g.fill(); }
  }
  if (q) {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    let [x, y] = tx(q.x, q.z);
    if (d > RADAR_RANGE) { const k = (RADAR_RANGE * 0.9) / d; x = R + (x - R) * k; y = R + (y - R) * k; }
    drawIconGlyph(g, 'quest', x, y, 12);
  }
  g.restore();
  // player arrow
  g.fillStyle = '#fef3c7';
  g.beginPath(); g.moveTo(R, R - 11); g.lineTo(R + 8, R + 9); g.lineTo(R, R + 4); g.lineTo(R - 8, R + 9); g.closePath(); g.fill();
  // north tick on the rim
  const nb = Math.atan2(Math.sin(-yaw), Math.cos(-yaw));
  const nx = R - Math.sin(nb) * (R - 12), ny = R - Math.cos(nb) * (R - 12);
  g.fillStyle = '#f87171'; g.font = `bold ${small ? 18 : 20}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('N', nx, ny);
}
