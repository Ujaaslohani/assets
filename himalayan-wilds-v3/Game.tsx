/**
 * Game.tsx — the 3D scene and the player controller.
 *
 * Frame order: PlayerController (priority -1) updates input, player, bow, arrows, wildlife,
 * NPCs and resources; every renderer afterwards just copies engine state into instanced
 * meshes. React state is only touched through `engine.actions` on discrete events.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ArrowRenderer, BowViewModel, fireArrow, updateArrows } from './Archery';
import { BuildingsRenderer, CampfireFx, checkPlacement, PlacementPreview, resolveBuildingCollision, walkHeight } from './Buildings';
import { getConfig } from './constants';
import { act, emit, engine, ITEM_LABEL } from './engine';
import { type AssetMesh, type Blocker, ForestStreamer, resolveTreeCollision } from './ForestStreamer';
import { buildCairn, flatMaterial } from './models';
import { CAMPS, findNpc, NpcRenderer, npcPosition, resetNpcs, syncNpcs, updateNpcs } from './Npcs';
import { findNode, getResourceNodes, harvestNode, nearestOfType, RES_INFO, ResourceRenderer, type ResType, spawnResources, updateResources } from './Resources';
import { buildTerrainGeometry, getTerrainHeight, MAP_HALF, WATER_Y } from './terrain';
import type { BuildingStructure, Specialist } from './types';
import { gameAudio } from './utils/helper';
import { Water } from './Water';
import { findCarcass, getAnimals, harvestCarcass, nearestHerd, spawnWildlife, updateWildlife, WildlifeRenderer, wildlifeStats } from './Wildlife';
import { WorldIcons } from './WorldIcons';

export { getTerrainHeight, MAP_HALF } from './terrain';

// ---------------------------------------------------------------------------
// Asset loading (shared cache)
// ---------------------------------------------------------------------------
const LOW_POLY_BASE_URL = 'https://raw.githubusercontent.com/Ujaaslohani/assets/main/low%20poly/';
const globalAssetCache = new Map<string, AssetMesh>();
const pendingLoads = new Map<string, Promise<AssetMesh | null>>();
const sharedGLTFLoader = new GLTFLoader();

export function loadAssetCached(filename: string): Promise<AssetMesh | null> {
  const hit = globalAssetCache.get(filename);
  if (hit) return Promise.resolve(hit);
  const pending = pendingLoads.get(filename);
  if (pending) return pending;
  const promise = new Promise<AssetMesh | null>((resolve) => {
    sharedGLTFLoader.load(
      LOW_POLY_BASE_URL + encodeURIComponent(filename),
      (gltf: GLTF) => {
        const parts: AssetMesh['parts'] = [];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry) {
            const raw = Array.isArray(child.material) ? child.material[0] : child.material;
            const mat = raw.clone();
            if (mat instanceof THREE.MeshStandardMaterial) {
              mat.roughness = 0.85;
              mat.metalness = 0.05;
            }
            parts.push({ geometry: child.geometry, material: mat, localMatrix: child.matrixWorld.clone() });
          }
        });
        if (parts.length) {
          const cached = { parts };
          globalAssetCache.set(filename, cached);
          resolve(cached);
        } else resolve(null);
      },
      undefined,
      () => resolve(null),
    );
  });
  pendingLoads.set(filename, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// World lifecycle
// ---------------------------------------------------------------------------
export function resetWorld() {
  spawnWildlife(7);
  spawnResources(11);
  resetNpcs();
  engine.player.pos.set(0, 1.7, 9);
  engine.player.yaw = 0;
  engine.player.pitch = -0.05;
  engine.player.velY = 0;
  engine.player.crouching = false;
  engine.player.knock.set(0, 0, 0);
  engine.bow.draw = 0;
  engine.bow.drawing = false;
  engine.time = 7.5;
}
resetWorld();

// expose a tiny debug hook (used by automated tests; harmless in production)
if (typeof window !== 'undefined') (window as unknown as { __hw: unknown }).__hw = { engine, wildlifeStats, getResourceNodes, getAnimals };

// ---------------------------------------------------------------------------
// Quest guidance — where the compass "objective" marker points
// ---------------------------------------------------------------------------
const NEED_TO_RES: Record<string, ResType> = { wood: 'wood', stone: 'stone', fiber: 'fiber', herb: 'herb' };

function missingFor(cost: Record<string, number>) {
  const inv = engine.world.inventory;
  for (const [k, v] of Object.entries(cost)) if ((inv[k] ?? 0) < v) return k;
  return null;
}

function targetForMaterial(item: string): { x: number; z: number; label: string } | null {
  const p = engine.player.pos;
  if (NEED_TO_RES[item]) {
    const n = nearestOfType(NEED_TO_RES[item], p.x, p.z);
    return n ? { x: n.x, z: n.z, label: `Gather ${ITEM_LABEL[item] ?? item}` } : null;
  }
  const sp = item === 'deer_pelt' ? 'deer' : item === 'boar_hide' ? 'boar' : item === 'goral_horn' ? 'goral' : null;
  if (sp) {
    const h = nearestHerd(sp, p.x, p.z);
    return h ? { x: h.x, z: h.z, label: `Hunt ${sp} for ${ITEM_LABEL[item]}` } : null;
  }
  return null;
}

function buildTarget(id: string) {
  const b = engine.world.buildings.find((x) => x.id === id);
  if (!b || b.built) return null;
  const miss = missingFor(b.cost);
  if (miss) return targetForMaterial(miss);
  const p = engine.player.pos;
  if (Math.hypot(p.x, p.z) > 22) return { x: 0, z: 0, label: `Return to the village to build the ${b.name} [B]` };
  return null;
}

function recruitTarget(id: string) {
  const s = engine.world.specialists.find((x) => x.id === id);
  if (!s || s.recruited) return null;
  const pos = npcPosition(id) ?? { x: CAMPS[id].camp[0], z: CAMPS[id].camp[1] };
  return { x: pos.x, z: pos.z, label: `Find ${s.name} in ${CAMPS[id].area}` };
}

function computeQuestTarget() {
  const p = engine.player.pos;
  const q = engine.world.activeQuest;
  const carcass = findCarcass(p.x, p.z, 80);
  if (carcass && (q === 'ch1' || q === 'ch7')) return { x: carcass.x, z: carcass.z, label: 'Harvest your kill [E]' };
  switch (q) {
    case 'ch1': {
      const h = nearestHerd('deer', p.x, p.z);
      return h ? { x: h.x, z: h.z, label: 'Hunt deer — crouch [C] to sneak closer' } : null;
    }
    case 'ch2': return buildTarget('hunter_hut');
    case 'ch3': return recruitTarget('carpenter') ?? recruitTarget('herbalist');
    case 'ch4': {
      let best: { x: number; z: number; label: string } | null = null;
      let bd = Infinity;
      for (const c of engine.world.clues) {
        if (c.discovered) continue;
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < bd) { bd = d; best = { x: c.x, z: c.z, label: `Discover: ${c.title}` }; }
      }
      return best;
    }
    case 'ch5': return buildTarget('herbalist_lodge');
    case 'ch6': return buildTarget('carpenter_workshop') ?? buildTarget('watchtower');
    case 'ch7': return buildTarget('bridge') ?? null;
    case 'ch8': return recruitTarget('builder') ?? recruitTarget('carpenter') ?? recruitTarget('herbalist')
      ?? buildTarget('hunter_hut') ?? buildTarget('herbalist_lodge') ?? buildTarget('carpenter_workshop') ?? buildTarget('watchtower');
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Player controller
// ---------------------------------------------------------------------------
const _fwd = new THREE.Vector3();
const _side = new THREE.Vector3();
const _move = new THREE.Vector3();
const _vel = new THREE.Vector3();

function popupItems(delta: Record<string, number>) {
  for (const [k, v] of Object.entries(delta)) {
    if (v > 0) emit({ kind: 'popup', text: `+${v} ${ITEM_LABEL[k] ?? k}` });
  }
}

function interact() {
  const a = act();
  if (!a) return;
  const p = engine.player.pos;

  const carcass = findCarcass(p.x, p.z, 3.2);
  if (carcass) {
    const r = harvestCarcass(carcass);
    a.addItems(r.yields);
    a.addScore(120);
    popupItems(r.yields);
    gameAudio.playCoinPickup();
    a.notify(`Harvested the ${r.name.toLowerCase()}.`);
    return;
  }
  const npc = findNpc(p.x, p.z, 3.6);
  let node = findNode(p.x, p.z, 3.0);
  // talking wins when the specialist is the closer of the two
  if (node && npc && Math.hypot(npc.x - p.x, npc.z - p.z) < Math.hypot(node.x - p.x, node.z - p.z) + 0.8) node = null;
  if (node) {
    const r = harvestNode(node);
    a.addItems({ [r.item]: r.amount });
    a.addScore(15);
    popupItems({ [r.item]: r.amount });
    if (node.type === 'wood') gameAudio.playFootstepWood();
    else if (node.type === 'stone') gameAudio.playFootstepStone();
    else gameAudio.playTone({ type: 'sine', freq: 660, freqTo: 990, dur: 0.12, gain: 0.07 });
    if (r.depleted) a.notify(`${r.name} gathered clean. It will regrow in a while.`);
    return;
  }
  if (npc) {
    a.openDialogue(npc.id);
    gameAudio.playConfirmSelect();
    return;
  }
  for (const c of engine.world.clues) {
    if (!c.discovered && Math.hypot(c.x - p.x, c.z - p.z) < 4.5) {
      a.discoverClue(c.id);
      gameAudio.playPowerupChime();
      return;
    }
  }
  a.notify('Nothing to gather here. Follow the compass icons to timber, slate, nettle and herbs.');
  gameAudio.playCrispClick();
}

function promptText(): string | null {
  const p = engine.player.pos;
  const carcass = findCarcass(p.x, p.z, 3.2);
  if (carcass) return '[E] Harvest';
  const npc = findNpc(p.x, p.z, 3.6);
  const node = findNode(p.x, p.z, 3.0);
  if (node && !(npc && Math.hypot(npc.x - p.x, npc.z - p.z) < Math.hypot(node.x - p.x, node.z - p.z) + 0.8)) {
    return `[E] Gather ${RES_INFO[node.type].name} (${node.left} left)`;
  }
  if (npc) return `[E] Talk to ${npc.name}`;
  for (const c of engine.world.clues) if (!c.discovered && Math.hypot(c.x - p.x, c.z - p.z) < 4.5) return `[E] Inspect ${c.title}`;
  if (engine.world.arrows <= 0) return 'Out of arrows — craft more in the Pouch [Tab]';
  return null;
}

function PlayerController() {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const lmb = useRef(false);
  const rmb = useRef(false);
  const feetY = useRef(getTerrainHeight(0, 9));
  const eyeH = useRef(1.65);
  const footT = useRef(0);
  const slowT = useRef(0);

  useEffect(() => {
    const el = gl.domElement;
    const locked = () => document.pointerLockElement === el;

    const release = () => {
      const B = engine.bow;
      if (!B.drawing) return;
      B.drawing = false;
      if (B.draw > 0.05 && engine.world.arrows > 0 && B.cooldown <= 0) {
        fireArrow(camera, Math.max(0.3, B.draw), B.aiming);
        engine.world.arrows -= 1;
        act()?.addItems({ arrow: -1 });
        B.cooldown = 0.4;
        B.lastShotPower = B.draw;
        gameAudio.playTone({ type: 'triangle', freq: 240, freqTo: 70, dur: 0.12, gain: 0.14 });
      }
      B.draw = 0;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!engine.playing) return;
      if (e.repeat && !['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) return;
      keys.current[e.code] = true;
      const a = act();
      const placing = engine.world.placing;
      if (e.code === 'Tab' || e.code === 'KeyI') { e.preventDefault(); a?.openTab('inventory'); return; }
      if (e.code === 'KeyJ') { a?.openTab('quests'); return; }
      if (e.code === 'KeyB') { a?.openTab('buildings'); return; }
      if (e.code === 'KeyM') { a?.openTab('map'); return; }
      if (engine.uiOpen) return;
      if (placing) {
        if (e.code === 'KeyQ') engine.world.previewRot -= Math.PI / 8;
        if (e.code === 'KeyE' || e.code === 'KeyR') engine.world.previewRot += Math.PI / 8;
        if (e.code === 'Escape') a?.cancelPlacement();
        if (e.code === 'Enter') tryPlace();
        return;
      }
      if (e.code === 'KeyE') interact();
      if (e.code === 'KeyC' || e.code === 'ControlLeft') engine.player.crouching = !engine.player.crouching;
      if (e.code === 'Space') { e.preventDefault(); jump(); }
      if (e.code === 'KeyF') { engine.bow.drawing = true; engine.bow.draw = 0.8; release(); }
    };
    const onKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false; };

    const tryPlace = () => {
      const w = engine.world;
      if (!w.placing) return;
      if (!w.previewValid) { act()?.notify(w.previewReason || 'Cannot build here'); gameAudio.playCrispClick(); return; }
      act()?.placeBuilding(w.placing, [w.previewPos[0], w.previewPos[1], w.previewPos[2]], w.previewRot);
    };
    const jump = () => {
      if (engine.player.onGround) { engine.player.velY = 5.4; engine.player.onGround = false; engine.player.crouching = false; }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!engine.playing || engine.uiOpen) return;
      if (!locked() && el.requestPointerLock) {
        try { const r = el.requestPointerLock() as unknown as Promise<void> | undefined; r?.catch?.(() => {}); } catch { /* iframe may block it */ }
      }
      if (e.button === 0) {
        if (engine.world.placing) { tryPlace(); return; }
        lmb.current = true;
        if (engine.world.arrows <= 0) { act()?.notify('Out of arrows! Open the Pouch [Tab]: 1 timber makes 10 arrows.'); return; }
        engine.bow.drawing = true;
      } else if (e.button === 2) {
        if (engine.world.placing) { act()?.cancelPlacement(); return; }
        rmb.current = true;
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) { lmb.current = false; release(); }
      if (e.button === 2) rmb.current = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!engine.playing || engine.uiOpen) return;
      if (!locked() && !el.matches(':hover')) return;
      const sens = getConfig('mouseSensitivity') * (engine.bow.aiming ? 0.55 : 1);
      engine.player.yaw -= e.movementX * sens;
      engine.player.pitch = THREE.MathUtils.clamp(engine.player.pitch - e.movementY * sens, -1.35, 1.35);
    };

    // touch look: drag anywhere on the 3D view
    let touchId = -1, tx = 0, ty = 0;
    const onPointerDown = (e: PointerEvent) => { if (e.pointerType === 'touch' && touchId < 0) { touchId = e.pointerId; tx = e.clientX; ty = e.clientY; } };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== touchId) return;
      const k = engine.bow.aiming ? 0.0028 : 0.005;
      engine.player.yaw -= (e.clientX - tx) * k;
      engine.player.pitch = THREE.MathUtils.clamp(engine.player.pitch - (e.clientY - ty) * k, -1.35, 1.35);
      tx = e.clientX; ty = e.clientY;
    };
    const onPointerUp = (e: PointerEvent) => { if (e.pointerId === touchId) touchId = -1; };
    const onBlur = () => { keys.current = {}; lmb.current = false; rmb.current = false; release(); };
    const onContext = (e: MouseEvent) => e.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('blur', onBlur);
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('contextmenu', onContext);
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    (engine as unknown as { _release: () => void })._release = release;
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('blur', onBlur);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('contextmenu', onContext);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [camera, gl]);

  // drop pointer lock whenever a menu opens
  useFrame(() => {
    if ((engine.uiOpen || !engine.playing) && document.pointerLockElement === gl.domElement) document.exitPointerLock();
  }, -2);

  useFrame((_, delta) => {
    const t0 = performance.now();
    const dt = Math.min(delta, 0.1);
    engine.clock += dt;
    const P = engine.player;
    const B = engine.bow;
    const I = engine.input;
    const active = engine.playing && !engine.uiOpen;

    // --- time of day
    if (engine.playing) {
      const night = engine.time >= 21 || engine.time < 5;
      engine.time = (engine.time + dt * (night ? 0.12 : 0.04)) % 24;
    }

    // --- mobile pulses
    if (I.interactPulse) { I.interactPulse = false; if (active) interact(); }
    if (I.jumpPulse) { I.jumpPulse = false; if (active && P.onGround) { P.velY = 5.4; P.onGround = false; } }
    if (I.shootPulse) {
      I.shootPulse = false;
      if (active && engine.world.placing) {
        const w = engine.world;
        if (w.previewValid) act()?.placeBuilding(w.placing!, [...w.previewPos] as [number, number, number], w.previewRot);
        else act()?.notify(w.previewReason);
      } else if (active && engine.world.arrows > 0 && B.cooldown <= 0) {
        B.drawing = true; B.draw = 0.8;
        (engine as unknown as { _release: () => void })._release?.();
      }
    }

    // --- bow
    B.aiming = active && !engine.world.placing && (rmb.current || I.aimToggle);
    B.cooldown = Math.max(0, B.cooldown - dt);
    if (B.drawing && active && engine.world.arrows > 0 && B.cooldown <= 0) B.draw = Math.min(1, B.draw + dt / 0.7);
    else if (!B.drawing) B.draw = Math.max(0, B.draw - dt * 4);

    // --- movement
    const k = keys.current;
    let mz = 0, mx = 0;
    if (active) {
      mz = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0) + I.moveY;
      mx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0) + I.moveX;
    }
    P.sprinting = active && !!(k.ShiftLeft || k.ShiftRight) && mz > 0 && !P.crouching && !B.drawing;
    _fwd.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    _side.set(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
    _move.set(0, 0, 0).addScaledVector(_fwd, mz).addScaledVector(_side, mx);
    P.moving = _move.lengthSq() > 0.01;
    if (_move.lengthSq() > 1) _move.normalize();

    let speed = getConfig('playerSpeed');
    if (P.sprinting) speed *= getConfig('sprintMultiplier');
    if (P.crouching) speed *= 0.45;
    if (B.drawing || B.aiming) speed *= 0.6;
    const ground0 = walkHeight(P.pos.x, P.pos.z);
    if (ground0 < WATER_Y - 0.2) speed *= 0.6; // wading
    _vel.lerp(_move.multiplyScalar(speed), Math.min(1, dt * (P.onGround ? 12 : 3)));

    P.pos.x += (_vel.x + P.knock.x) * dt;
    P.pos.z += (_vel.z + P.knock.z) * dt;
    P.knock.multiplyScalar(Math.max(0, 1 - dt * 5));
    resolveTreeCollision(P.pos, 0.38);
    resolveBuildingCollision(P.pos, 0.38);
    P.pos.x = THREE.MathUtils.clamp(P.pos.x, -MAP_HALF + 4, MAP_HALF - 4);
    P.pos.z = THREE.MathUtils.clamp(P.pos.z, -MAP_HALF + 4, MAP_HALF - 4);

    // --- vertical: gravity, jumping, sticking to slopes
    const ground = walkHeight(P.pos.x, P.pos.z);
    P.velY += getConfig('gravity') * dt;
    feetY.current += P.velY * dt;
    if (feetY.current <= ground || (P.onGround && feetY.current - ground < 0.5 && P.velY <= 0)) {
      feetY.current = ground;
      P.velY = 0;
      P.onGround = true;
    } else P.onGround = false;
    eyeH.current += ((P.crouching ? 1.05 : 1.65) - eyeH.current) * Math.min(1, dt * 10);
    const headBob = P.moving && P.onGround ? Math.sin(engine.clock * (P.sprinting ? 12 : 8.5)) * (P.sprinting ? 0.05 : 0.025) : 0;
    P.pos.y = feetY.current + eyeH.current + headBob;

    if (P.moving && P.onGround && active) {
      footT.current += dt * (P.sprinting ? 3.3 : P.crouching ? 1.2 : 2.0);
      if (footT.current >= 1) {
        footT.current = 0;
        if (ground < 0) gameAudio.playFootstepStone();
        else if (!P.crouching) gameAudio.playFootstepWood();
      }
    }

    // --- camera
    camera.position.copy(P.pos);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(P.pitch, P.yaw, 0);
    if (camera instanceof THREE.PerspectiveCamera) {
      const target = B.aiming ? 42 : getConfig('fov');
      if (Math.abs(camera.fov - target) > 0.05) {
        camera.fov += (target - camera.fov) * Math.min(1, dt * 12);
        camera.updateProjectionMatrix();
      }
    }

    // --- building placement preview
    const w = engine.world;
    if (w.placing) {
      const b = w.buildings.find((x) => x.id === w.placing);
      if (b) {
        const reach = b.type === 'bridge' ? 9 : 7.5;
        const r = checkPlacement(b, P.pos.x + _fwd.x * reach, P.pos.z + _fwd.z * reach, w.previewRot, w.buildings);
        w.previewPos[0] = r.x; w.previewPos[1] = r.y; w.previewPos[2] = r.z;
        if (b.type === 'bridge') w.previewRot = r.rot;
        w.previewValid = r.ok;
        w.previewReason = r.reason;
      }
    }

    // --- world systems
    updateArrows(dt);
    updateWildlife(dt);
    updateNpcs(dt);

    slowT.current += dt;
    if (slowT.current > 0.25) {
      slowT.current = 0;
      engine.nearbyPrompt = active ? promptText() : null;
      engine.questTarget = computeQuestTarget();
      updateResources();
    }
    engine.simMs = engine.simMs * 0.9 + (performance.now() - t0) * 0.1;
  }, -1);

  return null;
}

// ---------------------------------------------------------------------------
// Sky, lighting, stars
// ---------------------------------------------------------------------------
const SKY = {
  night: new THREE.Color('#0b1430'), nightH: new THREE.Color('#1c2846'),
  dawn: new THREE.Color('#f08a4b'), dawnH: new THREE.Color('#fbc99a'),
  day: new THREE.Color('#78bdf0'), dayH: new THREE.Color('#d3e8ee'),
  gold: new THREE.Color('#f6a35c'), goldH: new THREE.Color('#fde3a7'),
  zenith: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color('#fff1d6'), sunLow: new THREE.Color('#ffc58a'),
};

function skyColors(h: number) {
  const Z = SKY.zenith, H = SKY.horizon;
  const mix = (a: THREE.Color, b: THREE.Color, c: THREE.Color, d: THREE.Color, t: number) => { Z.copy(a).lerp(b, t); H.copy(c).lerp(d, t); };
  if (h >= 4.5 && h < 6) mix(SKY.night, SKY.dawn, SKY.nightH, SKY.dawnH, (h - 4.5) / 1.5);
  else if (h >= 6 && h < 8) mix(SKY.dawn, SKY.day, SKY.dawnH, SKY.dayH, (h - 6) / 2);
  else if (h >= 8 && h < 17) mix(SKY.day, SKY.day, SKY.dayH, SKY.dayH, 0);
  else if (h >= 17 && h < 19) mix(SKY.day, SKY.gold, SKY.dayH, SKY.goldH, (h - 17) / 2);
  else if (h >= 19 && h < 21) mix(SKY.gold, SKY.night, SKY.goldH, SKY.nightH, (h - 19) / 2);
  else mix(SKY.night, SKY.night, SKY.nightH, SKY.nightH, 0);
}

function Atmosphere() {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const dome = useRef<THREE.Mesh>(null);
  const { scene, camera } = useThree();
  const uniforms = useMemo(() => ({ topColor: { value: SKY.zenith }, bottomColor: { value: SKY.horizon } }), []);
  const stars = useMemo(() => {
    const N = 260;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.85 + 0.15);
      pos[i * 3] = 110 * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = 110 * Math.cos(ph);
      pos[i * 3 + 2] = 110 * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, color: '#f8fafc', transparent: true, opacity: 0, fog: false, depthWrite: false });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = -1;
    return pts;
  }, []);

  useFrame(() => {
    const h = engine.time;
    const ang = ((h - 6) / 24) * Math.PI * 2;
    const elev = Math.sin(ang);
    const daylight = THREE.MathUtils.smoothstep(elev, -0.08, 0.3);
    engine.isNight = daylight < 0.15;
    skyColors(h);
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(SKY.horizon);
    scene.background = SKY.horizon;
    if (sun.current) {
      sun.current.position.set(Math.cos(ang) * 110, Math.max(8, elev * 120), -35);
      sun.current.intensity = THREE.MathUtils.lerp(0.12, 2.1, daylight);
      sun.current.color.copy(daylight > 0.55 ? SKY.sun : SKY.sunLow);
    }
    if (hemi.current) hemi.current.intensity = THREE.MathUtils.lerp(0.32, 1.05, daylight);
    if (dome.current) dome.current.position.copy(camera.position);
    stars.position.copy(camera.position);
    (stars.material as THREE.PointsMaterial).opacity = 1 - daylight;
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={['#d6ecff', '#7a9a45', 1.0]} />
      <directionalLight ref={sun} position={[100, 100, -20]} intensity={2.0} color="#fff1d6" />
      <mesh ref={dome} renderOrder={-2} frustumCulled={false}>
        <sphereGeometry args={[120, 24, 12]} />
        <shaderMaterial
          uniforms={uniforms}
          side={THREE.BackSide}
          depthWrite={false}
          depthTest={false}
          fog={false}
          vertexShader={`varying vec3 vDir; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vDir = wp.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * wp; }`}
          fragmentShader={`uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 vDir; void main(){ float h = max(normalize(vDir).y, 0.0); gl_FragColor = vec4(mix(bottomColor, topColor, pow(h, 0.55)), 1.0); }`}
        />
      </mesh>
      <primitive object={stars} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Landmarks (clue cairns)
// ---------------------------------------------------------------------------
function Landmarks({ clues }: { clues: Array<{ id: string; position: [number, number, number] }> }) {
  const geo = useMemo(buildCairn, []);
  return (
    <group>
      {clues.map((c) => (
        <mesh key={c.id} geometry={geo} material={flatMaterial} position={[c.position[0], getTerrainHeight(c.position[0], c.position[2]), c.position[2]]} rotation={[0, c.position[0] * 0.37, 0]} />
      ))}
    </group>
  );
}

/** Publishes renderer stats for testing / tuning. */
function PerfProbe() {
  const { gl } = useThree();
  useFrame(() => {
    const hw = (window as unknown as { __hw: Record<string, unknown> }).__hw;
    if (hw) hw.render = { calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures };
  }); // NOTE: a positive priority would switch off R3F's automatic rendering
  return null;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
export interface GameProps {
  buildings: BuildingStructure[];
  specialists: Specialist[];
  clues: Array<{ id: string; position: [number, number, number] }>;
  placing: string | null;
}

export function Game({ buildings, specialists, clues, placing }: GameProps) {
  const terrainGeom = useMemo(() => buildTerrainGeometry(200), []);
  const npcIds = useMemo(() => specialists.map((s) => ({ id: s.id, name: s.name })), [specialists.map((s) => s.id).join()]);

  useEffect(() => { syncNpcs(specialists); }, [specialists]);

  const blockers = useMemo<Blocker[]>(() => {
    const list: Blocker[] = [];
    for (const b of buildings) {
      if (!b.built) continue;
      if (b.type === 'bridge') list.push({ x: b.position[0], z: b.position[2], r: 11 });
      else list.push({ x: b.position[0], z: b.position[2], r: 6 });
    }
    for (const n of getResourceNodes()) list.push({ x: n.x, z: n.z, r: n.type === 'wood' ? 2.6 : 1.8 });
    for (const c of Object.values(CAMPS)) list.push({ x: c.camp[0], z: c.camp[1], r: 6 });
    for (const c of clues) list.push({ x: c.position[0], z: c.position[2], r: 4 });
    list.push({ x: 0, z: 9, r: 3 }); // spawn point
    return list;
  }, [buildings, clues]);

  return (
    <div className="w-full h-full relative select-none">
      <Canvas
        shadows={false}
        dpr={[1, 1.25]}
        camera={{ fov: getConfig('fov'), near: 0.1, far: 130, position: [0, 1.8, 9] }}
        gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
        scene={{ fog: new THREE.Fog('#d3e8ee', 30, 98) }}
      >
        <Suspense fallback={null}>
          <PlayerController />
          <Atmosphere />
          <mesh geometry={terrainGeom}>
            <meshLambertMaterial vertexColors />
          </mesh>
          <Water />
          <ForestStreamer loadAsset={loadAssetCached} blockers={blockers} />
          <BuildingsRenderer buildings={buildings} />
          <PlacementPreview type={placing ? buildings.find((b) => b.id === placing)?.type ?? null : null} />
          <ResourceRenderer loadAsset={loadAssetCached} />
          <Landmarks clues={clues} />
          <WildlifeRenderer />
          <NpcRenderer ids={npcIds} />
          {Object.entries(CAMPS).filter(([id]) => id !== 'hunter').map(([id, c]) => (
            <CampfireFx key={id} x={c.camp[0] + 2.5} y={getTerrainHeight(c.camp[0] + 2.5, c.camp[1] + 1.5)} z={c.camp[1] + 1.5} scale={0.6} />
          ))}
          <ArrowRenderer />
          <WorldIcons />
          <BowViewModel />
          <PerfProbe />
        </Suspense>
      </Canvas>
    </div>
  );
}
