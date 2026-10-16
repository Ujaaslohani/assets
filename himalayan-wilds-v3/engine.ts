/**
 * engine.ts — the mutable real-time core.
 *
 * Everything that changes every frame lives here (player, bow, time, wildlife,
 * resources, NPC positions). React never re-renders because of it. React state
 * (inventory, buildings, quests) is mirrored in via `engine.world` when it
 * changes, and the engine talks back through the `GameActions` callbacks.
 */
import * as THREE from 'three';
import type { BuildingStructure } from './types';

export type ItemDelta = Record<string, number>;

/** Callbacks the engine uses to change React state (implemented in App.tsx). */
export interface GameActions {
  addItems: (delta: ItemDelta) => void;
  addScore: (n: number) => void;
  notify: (text: string) => void;
  openDialogue: (specialistId: string) => void;
  discoverClue: (clueId: string) => void;
  placeBuilding: (id: string, pos: [number, number, number], rotY: number) => void;
  cancelPlacement: () => void;
  openTab: (tab: 'inventory' | 'quests' | 'buildings' | 'map') => void;
}

export type HudEvent =
  | { kind: 'popup'; text: string; color?: string }
  | { kind: 'hit'; headshot: boolean; kill: boolean }
  | { kind: 'knock' };

export interface ClueRuntime {
  id: string;
  title: string;
  x: number;
  z: number;
  discovered: boolean;
}

export interface SpecialistRuntime {
  id: string;
  name: string;
  recruited: boolean;
}

export const engine = {
  playing: false,
  uiOpen: false,
  time: 7.5, // hours
  isNight: false,

  player: {
    pos: new THREE.Vector3(0, 1.7, 9),
    yaw: 0, // 0 = looking toward -z (north, toward the waterfall)
    pitch: -0.05,
    velY: 0,
    onGround: true,
    crouching: false,
    sprinting: false,
    moving: false,
    knock: new THREE.Vector3(),
  },

  bow: {
    drawing: false,
    draw: 0, // 0..1 draw strength
    aiming: false,
    cooldown: 0,
    lastShotPower: 0,
  },

  /** Touch / on-screen controls write here directly (no React state). */
  input: {
    moveX: 0,
    moveY: 0, // +1 = forward
    aimToggle: false,
    shootPulse: false,
    interactPulse: false,
    jumpPulse: false,
  },

  /** Mirrors of React state, refreshed whenever React state changes. */
  world: {
    inventory: {} as Record<string, number>,
    activeQuest: null as string | null,
    buildings: [] as BuildingStructure[],
    specialists: [] as SpecialistRuntime[],
    clues: [] as ClueRuntime[],
    arrows: 0,
    placing: null as string | null,
    previewPos: [0, 0, 0] as [number, number, number],
    previewRot: 0,
    previewValid: false,
    previewReason: '',
    /** Bonuses granted by recruited specialists / buildings. */
    bonus: {
      peltMult: 1,
      woodExtra: 0,
      stoneExtra: 0,
      herbExtra: 0,
      animalRadar: 45, // metres animals show on the radar
    },
  },

  nearbyPrompt: null as string | null,
  questTarget: null as { x: number; z: number; label: string } | null,

  /** Last loud sound (bow shot, arrow impact) — wildlife reacts to it. */
  noise: { x: 0, z: 0, r: 0, t: -99 },
  clock: 0, // seconds since the scene started
  simMs: 0, // smoothed CPU time of the simulation step (ms)

  events: [] as HudEvent[],
  actions: null as GameActions | null,
};

/** World markers shared by the 3D icon layer, the radar and the compass. */
export type MarkerIcon = 'wood' | 'stone' | 'fiber' | 'herb' | 'harvest' | 'recruit' | 'clue' | 'quest' | 'animal' | 'building' | 'npc';
export interface Marker {
  x: number;
  y: number;
  z: number;
  icon: MarkerIcon;
  label?: string;
}
type MarkerSource = (out: Marker[]) => void;
const markerSources = new Map<string, MarkerSource>();
export function registerMarkers(key: string, src: MarkerSource) {
  markerSources.set(key, src);
}
export function collectMarkers(out: Marker[]) {
  out.length = 0;
  markerSources.forEach((s) => s(out));
  return out;
}

export function makeNoise(x: number, z: number, r: number) {
  engine.noise.x = x;
  engine.noise.z = z;
  engine.noise.r = r;
  engine.noise.t = engine.clock;
}

export function emit(e: HudEvent) {
  engine.events.push(e);
  if (engine.events.length > 24) engine.events.shift();
}

export const ITEM_LABEL: Record<string, string> = {
  wood: 'Timber', stone: 'Slate', fiber: 'Nettle Fibre', herb: 'Herbs', deer_pelt: 'Deer Pelt', boar_hide: 'Boar Hide',
  bone: 'Bone', sinew: 'Sinew', goral_horn: 'Goral Horn', arrow: 'Arrows',
};

export function act(): GameActions | null {
  return engine.actions;
}

// ---------------------------------------------------------------------------
// Small math helpers (allocation-free)
// ---------------------------------------------------------------------------
export const TAU = Math.PI * 2;

export function wrapAngle(a: number) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Turn `from` toward `to` by at most `maxStep` radians, taking the short way round. */
export function turnToward(from: number, to: number, maxStep: number) {
  const d = wrapAngle(to - from);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function seeded(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Compass bearing (radians) from the player to a point, relative to where the player looks. */
export function relativeBearing(x: number, z: number) {
  const p = engine.player.pos;
  const worldAngle = Math.atan2(-(x - p.x), -(z - p.z)); // same convention as yaw
  return wrapAngle(worldAngle - engine.player.yaw);
}
