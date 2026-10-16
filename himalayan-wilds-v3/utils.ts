import * as THREE from 'three';

export {
  BackgroundMusic,
  createSeamlessLoopBuffer,
  scanAudioBoundaries,
  type AudioBoundaries,
  type BackgroundMusicProps,
  type SeamlessLoopResult,
} from './utils/BackgroundMusic';
export {
  MenuOverlay,
  Overlay,
  clamp,
  createFixedStepper,
  drawAsset,
  drawBackground,
  formatTime,
  gameAudio,
  prepareCanvas,
  shuffle,
  useAssets,
  useAutoFocus,
  useInput,
  useIsMobile,
  type Entity,
  type GamePhase,
  type GameState,
  type InputAction,
  type InputSnapshot,
  type MenuOverlayProps,
  type MusicTrack,
  type PointerState,
  type Position,
  type SpriteConfig,
} from './utils/helper';
export {
  usePlayground,
  usePlaygroundGameLifecycle,
  useRpc,
  type BaseGameState,
  type BooleanConfigEntry,
  type ColorConfigEntry,
  type ConfigEntry,
  type ConfigValues,
  type GameConfig,
  type NumberConfigEntry,
  type SelectConfigEntry,
  type Vector2ConfigEntry,
} from './utils/usePlayground';

/** Converts degrees to radians. */
export function degToRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/** Converts radians to degrees. */
export function radToDeg(rad: number): number {
  return rad * (180 / Math.PI);
}

/** Random float in [min, max). */
export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Random integer in [min, max] (inclusive). */
export function randomInt(min: number, max: number): number {
  return Math.floor(randomRange(min, max + 1));
}

/**
 * Seeded pseudo-random number generator (Mulberry32).
 * Produces deterministic sequences — useful for procedural generation
 * that must be identical across clients / runs.
 *
 * Usage:
 *   const rng = createSeededRandom(12345);
 *   const val = rng(); // 0..1, deterministic
 */
export function createSeededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// Rapier-safe type conversions
// ============================================================================
// Rapier (WASM) expects plain {x,y,z} / {x,y,z,w} objects. Passing Three.js
// class instances (THREE.Vector3, THREE.Quaternion) directly causes:
//   "recursive use of an object detected which would lead to unsafe aliasing in rust"
// Always use these helpers (or inline object literals) when calling Rapier APIs
// such as setTranslation, setRotation, setLinvel, applyImpulse, etc.
// ============================================================================

/**
 * Converts any {x,y,z} object (including THREE.Vector3) to a plain
 * Rapier-safe object literal. Use when calling body.setTranslation(),
 * body.setLinvel(), body.applyImpulse(), etc.
 *
 * Usage:
 *   body.setTranslation(toVec3(mesh.position), true);
 *   body.setLinvel(toVec3(velocity), true);
 */
export function toVec3(v: {x: number; y: number; z: number}): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: v.x,
    y: v.y,
    z: v.z,
  };
}

/**
 * Converts any {x,y,z,w} object (including THREE.Quaternion) to a plain
 * Rapier-safe object literal. Use when calling body.setRotation(),
 * body.setNextKinematicRotation(), etc.
 *
 * Usage:
 *   body.setRotation(toQuat(mesh.quaternion), true);
 *
 *   // From Euler angles:
 *   const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
 *   body.setRotation(toQuat(q), true);
 */
export function toQuat(q: {x: number; y: number; z: number; w: number}): {
  x: number;
  y: number;
  z: number;
  w: number;
} {
  return {
    x: q.x,
    y: q.y,
    z: q.z,
    w: q.w,
  };
}

// ============================================================================
// Memory GC Safe Temporary Variables
// ============================================================================
// Exporting pre-allocated memory structures so you do not instantiate objects
// inside useFrame. Import these to do Math locally.

/** Memory GC safe temporary Vector3 for local calculations in useFrame. */
export const tempVec3 = new THREE.Vector3();

/** Secondary memory GC safe temporary Vector3 for local calculations. */
export const tempVec3B = new THREE.Vector3();

/** Memory GC safe temporary Quaternion for local calculations. */
export const tempQuat = new THREE.Quaternion();

/** Memory GC safe temporary Matrix4 for local calculations. */
export const tempMatrix = new THREE.Matrix4();

/** Memory GC safe temporary Euler angles for local calculations. */
export const tempEuler = new THREE.Euler();
// ============================================================================
