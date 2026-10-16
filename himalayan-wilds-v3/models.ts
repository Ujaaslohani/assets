/**
 * models.ts — procedural low-poly models (animals, specialists, buildings, props).
 *
 * Every model is a handful of primitives merged into ONE BufferGeometry with
 * vertex colours, so each one costs a single draw call (or one InstancedMesh
 * for a whole species) and zero texture memory. Faceted shading matches the
 * low-poly GLB vegetation.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V3 = [number, number, number];

/** Shared material for every vertex-coloured model. */
export const flatMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function finish(src: THREE.BufferGeometry, color: string, m: THREE.Matrix4) {
  const g = src.index ? src.toNonIndexed() : src.clone();
  src.dispose();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  g.applyMatrix4(m);
  _c.set(color); // THREE.Color already converts hex (sRGB) into the linear working space
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function xf(pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]) {
  _e.set(rot[0], rot[1], rot[2]);
  _q.setFromEuler(_e);
  return _m.compose(_a.set(pos[0], pos[1], pos[2]), _q, _b.set(scale[0], scale[1], scale[2])).clone();
}

/** Collects coloured primitives and merges them. */
class Builder {
  parts: THREE.BufferGeometry[] = [];

  add(g: THREE.BufferGeometry, color: string, pos?: V3, rot?: V3, scale?: V3) {
    this.parts.push(finish(g, color, xf(pos, rot, scale)));
    return this;
  }
  ellipsoid(color: string, pos: V3, scale: V3, rot?: V3, detail = 1) {
    return this.add(new THREE.IcosahedronGeometry(1, detail), color, pos, rot, scale);
  }
  box(color: string, pos: V3, size: V3, rot?: V3) {
    return this.add(new THREE.BoxGeometry(size[0], size[1], size[2]), color, pos, rot);
  }
  cyl(color: string, pos: V3, rTop: number, rBot: number, h: number, seg = 7, rot?: V3, scale?: V3) {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), color, pos, rot, scale);
  }
  cone(color: string, pos: V3, r: number, h: number, seg = 6, rot?: V3, scale?: V3) {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, pos, rot, scale);
  }
  /** Tapered cylinder from point a to point b. */
  limb(color: string, a: V3, b: V3, rA: number, rB: number, seg = 6) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _a.length();
    _q.setFromUnitVectors(_up, _a.normalize());
    const g = new THREE.CylinderGeometry(rB, rA, len, seg);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2),
      _q.clone(),
      new THREE.Vector3(1, 1, 1),
    );
    this.parts.push(finish(g, color, m));
    return this;
  }
  build() {
    const g = mergeGeometries(this.parts, false)!;
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    g.computeBoundingSphere();
    return g;
  }
}

// ===========================================================================
// WILDLIFE  (forward = +z, feet at y = 0)
// ===========================================================================
export interface SpeciesModel {
  body: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  headPivot: V3;
  legPivots: V3[]; // FL, FR, BL, BR
  hitBody: { y: number; r: number; zOff: number };
  hitHead: { y: number; z: number; r: number }; // relative to head pivot, head level
  shadowRadius: number;
}

function deer(): SpeciesModel {
  const coat = '#a8622f', dark = '#7c4420', cream = '#efe2c6', white = '#faf6ee';
  const body = new Builder()
    .ellipsoid(coat, [0, 0.86, 0], [0.3, 0.3, 0.62])
    .ellipsoid(coat, [0, 0.88, 0.36], [0.27, 0.31, 0.3])
    .ellipsoid(coat, [0, 0.9, -0.4], [0.28, 0.29, 0.3])
    .ellipsoid(cream, [0, 0.73, 0.02], [0.23, 0.16, 0.5])
    .ellipsoid(white, [0, 0.93, -0.68], [0.08, 0.11, 0.05])
    .ellipsoid(dark, [0, 1.13, 0], [0.06, 0.03, 0.5]);
  for (let i = 0; i < 6; i++) {
    const z = -0.3 + i * 0.12;
    body.ellipsoid(cream, [i % 2 ? 0.13 : -0.13, 1.09, z], [0.04, 0.018, 0.04], undefined, 0);
  }
  const head = new Builder()
    .limb(coat, [0, -0.02, 0], [0, 0.42, 0.18], 0.13, 0.09)
    .ellipsoid(cream, [0, 0.24, 0.16], [0.075, 0.1, 0.07])
    .ellipsoid(coat, [0, 0.5, 0.3], [0.12, 0.13, 0.19])
    .ellipsoid(dark, [0, 0.45, 0.47], [0.075, 0.075, 0.1])
    .ellipsoid('#1d1410', [0, 0.465, 0.565], [0.035, 0.03, 0.025], undefined, 0)
    .ellipsoid('#0c0a09', [0.095, 0.55, 0.38], [0.026, 0.026, 0.026], undefined, 0)
    .ellipsoid('#0c0a09', [-0.095, 0.55, 0.38], [0.026, 0.026, 0.026], undefined, 0)
    .cone(coat, [0.13, 0.63, 0.24], 0.055, 0.2, 5, [-0.3, 0, -0.95], [1, 1, 0.45])
    .cone(coat, [-0.13, 0.63, 0.24], 0.055, 0.2, 5, [-0.3, 0, 0.95], [1, 1, 0.45])
    .limb('#e6d5b8', [0.05, 0.62, 0.27], [0.12, 0.88, 0.2], 0.022, 0.012, 5)
    .limb('#e6d5b8', [-0.05, 0.62, 0.27], [-0.12, 0.88, 0.2], 0.022, 0.012, 5)
    .limb('#e6d5b8', [0.1, 0.78, 0.23], [0.06, 0.9, 0.31], 0.014, 0.008, 4)
    .limb('#e6d5b8', [-0.1, 0.78, 0.23], [-0.06, 0.9, 0.31], 0.014, 0.008, 4)
    .build();
  const leg = new Builder()
    .limb(coat, [0, 0.06, 0], [0, -0.33, 0.02], 0.075, 0.05)
    .limb(dark, [0, -0.33, 0.02], [0, -0.68, 0], 0.04, 0.03)
    .cyl('#2a1f1a', [0, -0.7, 0.01], 0.04, 0.045, 0.05, 6)
    .build();
  return {
    body: body.build(), head, leg,
    headPivot: [0, 1.0, 0.5],
    legPivots: [[0.13, 0.72, 0.38], [-0.13, 0.72, 0.38], [0.14, 0.74, -0.42], [-0.14, 0.74, -0.42]],
    hitBody: { y: 0.86, r: 0.5, zOff: 0.32 },
    hitHead: { y: 0.5, z: 0.32, r: 0.22 },
    shadowRadius: 0.75,
  };
}

function boar(): SpeciesModel {
  const coat = '#4b3a2c', dark = '#2c221b', mane = '#1f1813', snout = '#c4958a';
  const body = new Builder()
    .ellipsoid(coat, [0, 0.58, -0.05], [0.36, 0.36, 0.64])
    .ellipsoid(dark, [0, 0.68, 0.26], [0.35, 0.38, 0.38])
    .ellipsoid(mane, [0, 0.95, 0.06], [0.07, 0.11, 0.55])
    .ellipsoid('#5d4a39', [0, 0.42, 0], [0.27, 0.15, 0.5])
    .limb(dark, [0, 0.66, -0.66], [0, 0.48, -0.74], 0.025, 0.012, 4)
    .build();
  const head = new Builder()
    .ellipsoid(dark, [0, -0.02, 0.16], [0.23, 0.23, 0.27])
    .limb(coat, [0, -0.06, 0.28], [0, -0.11, 0.5], 0.13, 0.1, 7)
    .cyl(snout, [0, -0.115, 0.52], 0.1, 0.1, 0.04, 8, [Math.PI / 2, 0, 0])
    .ellipsoid('#2a1a16', [0.035, -0.11, 0.545], [0.018, 0.02, 0.01], undefined, 0)
    .ellipsoid('#2a1a16', [-0.035, -0.11, 0.545], [0.018, 0.02, 0.01], undefined, 0)
    .cone('#f4ecd8', [0.1, -0.12, 0.42], 0.024, 0.13, 5, [-0.5, 0, -0.5])
    .cone('#f4ecd8', [-0.1, -0.12, 0.42], 0.024, 0.13, 5, [-0.5, 0, 0.5])
    .ellipsoid('#0c0a09', [0.13, 0.06, 0.29], [0.022, 0.022, 0.022], undefined, 0)
    .ellipsoid('#0c0a09', [-0.13, 0.06, 0.29], [0.022, 0.022, 0.022], undefined, 0)
    .cone(dark, [0.14, 0.2, 0.06], 0.07, 0.16, 4, [0, 0, -0.55], [1, 1, 0.5])
    .cone(dark, [-0.14, 0.2, 0.06], 0.07, 0.16, 4, [0, 0, 0.55], [1, 1, 0.5])
    .build();
  const leg = new Builder()
    .limb(dark, [0, 0.03, 0], [0, -0.36, 0], 0.075, 0.05)
    .cyl('#151110', [0, -0.41, 0], 0.05, 0.055, 0.06, 6)
    .build();
  return {
    body, head, leg,
    headPivot: [0, 0.62, 0.58],
    legPivots: [[0.17, 0.44, 0.34], [-0.17, 0.44, 0.34], [0.17, 0.44, -0.38], [-0.17, 0.44, -0.38]],
    hitBody: { y: 0.58, r: 0.5, zOff: 0.3 },
    hitHead: { y: 0, z: 0.25, r: 0.25 },
    shadowRadius: 0.8,
  };
}

function goral(): SpeciesModel {
  const coat = '#8a7a66', mid = '#7a6a58', dark = '#4a3f35', pale = '#e8e0d0';
  const body = new Builder()
    .ellipsoid(coat, [0, 0.72, 0], [0.27, 0.3, 0.48])
    .ellipsoid(mid, [0, 0.74, 0.26], [0.25, 0.3, 0.26])
    .ellipsoid('#3f352c', [0, 0.99, 0], [0.05, 0.035, 0.42])
    .ellipsoid('#b8a990', [0, 0.6, 0], [0.2, 0.14, 0.38])
    .ellipsoid(dark, [0, 0.86, -0.49], [0.05, 0.08, 0.04], undefined, 0)
    .build();
  const head = new Builder()
    .limb(mid, [0, -0.02, 0], [0, 0.22, 0.12], 0.12, 0.09)
    .ellipsoid(pale, [0, 0.14, 0.14], [0.08, 0.08, 0.06])
    .ellipsoid(coat, [0, 0.3, 0.22], [0.11, 0.12, 0.17])
    .ellipsoid(dark, [0, 0.25, 0.36], [0.06, 0.07, 0.08])
    .ellipsoid('#0c0a09', [0.085, 0.34, 0.29], [0.022, 0.022, 0.022], undefined, 0)
    .ellipsoid('#0c0a09', [-0.085, 0.34, 0.29], [0.022, 0.022, 0.022], undefined, 0)
    .limb('#2a2420', [0.04, 0.4, 0.2], [0.07, 0.53, 0.07], 0.024, 0.008, 5)
    .limb('#2a2420', [-0.04, 0.4, 0.2], [-0.07, 0.53, 0.07], 0.024, 0.008, 5)
    .cone(coat, [0.12, 0.37, 0.16], 0.035, 0.13, 4, [0, 0, -1.25], [1, 1, 0.5])
    .cone(coat, [-0.12, 0.37, 0.16], 0.035, 0.13, 4, [0, 0, 1.25], [1, 1, 0.5])
    .build();
  const leg = new Builder()
    .limb(mid, [0, 0.04, 0], [0, -0.28, 0], 0.07, 0.05)
    .limb(dark, [0, -0.28, 0], [0, -0.56, 0], 0.045, 0.035)
    .cyl('#1d1814', [0, -0.58, 0], 0.038, 0.042, 0.04, 6)
    .build();
  return {
    body, head, leg,
    headPivot: [0, 0.86, 0.36],
    legPivots: [[0.12, 0.6, 0.26], [-0.12, 0.6, 0.26], [0.12, 0.62, -0.3], [-0.12, 0.62, -0.3]],
    hitBody: { y: 0.72, r: 0.42, zOff: 0.22 },
    hitHead: { y: 0.3, z: 0.22, r: 0.18 },
    shadowRadius: 0.6,
  };
}

let speciesCache: Record<'deer' | 'boar' | 'goral', SpeciesModel> | null = null;
export function getSpeciesModels() {
  if (!speciesCache) speciesCache = { deer: deer(), boar: boar(), goral: goral() };
  return speciesCache;
}

// ===========================================================================
// SPECIALISTS  (forward = +z, ~1.75 m tall)
// ===========================================================================
export interface HumanModel {
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  headPivot: V3;
  armPivots: [V3, V3];
  legPivots: [V3, V3];
}

const OUTFIT: Record<string, { coat: string; trim: string; sash: string; band: string; skin: string; hair: string }> = {
  hunter: { coat: '#4d5d3a', trim: '#e8dcc0', sash: '#b45309', band: '#166534', skin: '#c99068', hair: '#231812' },
  carpenter: { coat: '#8b5a2b', trim: '#f0e6d2', sash: '#1e3a8a', band: '#7f1d1d', skin: '#d4a07a', hair: '#2b1d14' },
  herbalist: { coat: '#9f1239', trim: '#f5e9d3', sash: '#15803d', band: '#166534', skin: '#dcae88', hair: '#1a120d' },
  builder: { coat: '#57534e', trim: '#e7e0d0', sash: '#ca8a04', band: '#1e3a8a', skin: '#b98060', hair: '#3a2c22' },
};

export function buildHuman(profession: string): HumanModel {
  const o = OUTFIT[profession] ?? OUTFIT.hunter;
  const female = profession === 'herbalist';
  const torso = new Builder()
    .cyl(o.coat, [0, 0.93, 0], 0.22, 0.29, 0.76, 9) // chola (long woollen coat)
    .cyl(o.coat, [0, 0.52, 0], 0.29, 0.33, 0.12, 9)
    .cyl(o.trim, [0, 0.455, 0], 0.335, 0.335, 0.03, 9) // hem border
    .cyl(o.sash, [0, 0.9, 0], 0.255, 0.265, 0.1, 9) // gachi sash
    .ellipsoid(o.sash, [0.18, 0.84, 0.17], [0.05, 0.09, 0.03], undefined, 0)
    .cyl(o.trim, [0, 1.31, 0], 0.15, 0.23, 0.08, 9) // shawl collar
    .ellipsoid(o.coat, [0.19, 1.27, 0], [0.1, 0.08, 0.11])
    .ellipsoid(o.coat, [-0.19, 1.27, 0], [0.1, 0.08, 0.11])
    .box(o.trim, [0, 1.05, 0.215], [0.04, 0.42, 0.02]) // coat placket
    .cyl(o.skin, [0, 1.4, 0], 0.055, 0.06, 0.1, 6);

  if (profession === 'hunter') {
    torso
      .cyl('#6b4423', [0.12, 1.08, -0.22], 0.065, 0.055, 0.55, 7, [0.25, 0, -0.35]) // quiver
      .cone('#f3f0e6', [0.21, 1.42, -0.27], 0.04, 0.12, 4, [0.25, 0, -0.35])
      .add(new THREE.TorusGeometry(0.48, 0.016, 4, 14, Math.PI * 0.85), '#7a4b2a', [-0.02, 1.0, -0.24], [0, 0, 1.85]);
  } else if (profession === 'carpenter') {
    torso
      .limb('#8b6a45', [0.27, 0.96, 0.06], [0.31, 0.55, 0.1], 0.018, 0.018)
      .box('#9ca3af', [0.31, 0.6, 0.15], [0.03, 0.11, 0.13])
      .box('#5b3a1e', [-0.22, 0.86, 0.12], [0.1, 0.14, 0.06]); // tool pouch
  } else if (profession === 'herbalist') {
    torso
      .cyl('#b08850', [0, 1.06, -0.3], 0.22, 0.12, 0.56, 8) // kilta basket
      .cyl('#8a6a3d', [0, 1.3, -0.3], 0.225, 0.225, 0.04, 8)
      .ellipsoid('#4d7c2f', [0, 1.36, -0.3], [0.17, 0.08, 0.17])
      .ellipsoid('#e11d48', [0.07, 1.42, -0.27], [0.035, 0.035, 0.035], undefined, 0)
      .ellipsoid('#facc15', [-0.06, 1.41, -0.33], [0.035, 0.035, 0.035], undefined, 0);
  } else {
    torso
      .limb('#8b6a45', [-0.27, 0.96, 0.06], [-0.31, 0.6, 0.08], 0.02, 0.02)
      .box('#6b7280', [-0.31, 0.62, 0.08], [0.15, 0.07, 0.07])
      .box('#6b4423', [0.23, 0.84, -0.12], [0.12, 0.16, 0.1]);
  }

  const head = new Builder()
    .ellipsoid(o.skin, [0, 0.14, 0.01], [0.125, 0.15, 0.13])
    .ellipsoid(o.skin, [0, 0.12, 0.13], [0.022, 0.032, 0.03], undefined, 0)
    .ellipsoid('#120c09', [0.045, 0.165, 0.112], [0.019, 0.019, 0.012], undefined, 0)
    .ellipsoid('#120c09', [-0.045, 0.165, 0.112], [0.019, 0.019, 0.012], undefined, 0)
    .box(o.hair, [0.045, 0.2, 0.115], [0.05, 0.012, 0.01])
    .box(o.hair, [-0.045, 0.2, 0.115], [0.05, 0.012, 0.01])
    .ellipsoid(o.hair, [0, 0.15, -0.035], [0.13, 0.135, 0.12])
    .cyl('#6b6f76', [0, 0.275, 0], 0.135, 0.14, 0.085, 10) // Kinnauri topi
    .cyl(o.band, [0, 0.235, 0], 0.145, 0.145, 0.04, 10) // velvet band
    .box(o.band, [0, 0.245, 0.125], [0.17, 0.05, 0.03])
    .ellipsoid('#facc15', [0.07, 0.26, 0.14], [0.018, 0.018, 0.012], undefined, 0);
  if (female) {
    head
      .limb(o.hair, [0, 0.1, -0.12], [0, -0.22, -0.15], 0.035, 0.022, 5)
      .ellipsoid('#eab308', [0.12, 0.09, 0.0], [0.012, 0.018, 0.012], undefined, 0)
      .ellipsoid('#eab308', [-0.12, 0.09, 0.0], [0.012, 0.018, 0.012], undefined, 0);
  } else {
    head.box(o.hair, [0, 0.085, 0.125], [0.09, 0.018, 0.02]); // moustache
  }

  const arm = new Builder()
    .limb(o.coat, [0, 0.02, 0], [0, -0.32, 0.02], 0.065, 0.056)
    .limb(o.coat, [0, -0.32, 0.02], [0, -0.53, 0.06], 0.054, 0.048)
    .cyl(o.trim, [0, -0.52, 0.06], 0.052, 0.052, 0.04, 6)
    .ellipsoid(o.skin, [0, -0.6, 0.07], [0.045, 0.055, 0.045])
    .build();
  const leg = new Builder()
    .limb('#e7dfcf', [0, 0.02, 0], [0, -0.46, 0], 0.075, 0.058)
    .limb('#3b2a20', [0, -0.42, 0], [0, -0.58, 0.01], 0.064, 0.062)
    .ellipsoid('#3b2a20', [0, -0.59, 0.05], [0.062, 0.035, 0.1])
    .build();

  return {
    torso: torso.build(),
    head: head.build(),
    arm,
    leg,
    headPivot: [0, 1.44, 0],
    armPivots: [[0.25, 1.3, 0], [-0.25, 1.3, 0]],
    legPivots: [[0.1, 0.62, 0], [-0.1, 0.62, 0]],
  };
}

// ===========================================================================
// BUILDINGS — Kath-Kuni style (alternating timber & stone courses, slate roof)
// ===========================================================================
const C = {
  stone: '#8b8478', stoneDark: '#6b665d', timber: '#7a4b2a', timberDark: '#5a3820',
  slate: '#4b5563', slateDark: '#374151', plaster: '#e8dcc4', door: '#3b2416', glass: '#1f160f',
};

function kathKuni(b: Builder, w: number, d: number, courses: number, ox = 0, oz = 0) {
  b.box(C.stone, [ox, 0.25, oz], [w + 0.4, 0.5, d + 0.4]);
  let y = 0.5;
  for (let i = 0; i < courses; i++) {
    b.box(C.timber, [ox, y + 0.09, oz], [w + 0.08, 0.18, d + 0.08]);
    b.box(i % 2 ? C.stoneDark : C.stone, [ox, y + 0.34, oz], [w - 0.06, 0.32, d - 0.06]);
    y += 0.5;
  }
  // timber corner posts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(C.timberDark, [ox + sx * (w / 2), 0.5 + (courses * 0.5) / 2, oz + sz * (d / 2)], [0.14, courses * 0.5, 0.14]);
  }
  // door and windows on the front (+z)
  b.box(C.door, [ox, 1.15, oz + d / 2 + 0.03], [0.85, 1.3, 0.06]);
  b.box(C.timberDark, [ox, 1.86, oz + d / 2 + 0.05], [1.05, 0.12, 0.08]);
  for (const sx of [-1, 1]) {
    b.box(C.glass, [ox + sx * w * 0.3, 1.65, oz + d / 2 + 0.03], [0.45, 0.42, 0.05]);
    b.box(C.timber, [ox + sx * w * 0.3, 1.65, oz + d / 2 + 0.06], [0.55, 0.06, 0.04]);
  }
  // projecting wooden upper storey with balcony
  const top = 0.5 + courses * 0.5;
  b.box(C.timber, [ox, top + 0.12, oz], [w + 0.9, 0.24, d + 0.9]);
  b.box(C.plaster, [ox, top + 0.52, oz], [w + 0.5, 0.56, d + 0.5]);
  b.box(C.timberDark, [ox, top + 0.82, oz], [w + 0.6, 0.06, d + 0.6]);
  for (let i = -3; i <= 3; i++) {
    b.box(C.timberDark, [ox + (i * (w + 0.8)) / 7, top + 0.52, oz + (d + 0.9) / 2], [0.06, 0.56, 0.06]);
  }
  // slate pyramid roof + ridge finial
  const roofY = top + 0.85;
  const r = Math.max(w, d) * 0.92 + 0.6;
  b.cone(C.slate, [ox, roofY + 0.75, oz], r, 1.5, 4, [0, Math.PI / 4, 0], [1, 1, d / w]);
  b.cone(C.slateDark, [ox, roofY + 0.06, oz], r + 0.08, 0.12, 4, [0, Math.PI / 4, 0], [1, 1, d / w]);
  b.limb(C.timberDark, [ox, roofY + 1.35, oz], [ox, roofY + 1.9, oz], 0.05, 0.02, 5);
  return roofY + 1.5;
}

function woodPile(b: Builder, x: number, z: number) {
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3 - row; i++) {
      const px = x + (i - (2 - row) / 2) * 0.34;
      b.limb('#6b4a32', [px, 0.17 + row * 0.29, z - 0.8], [px, 0.17 + row * 0.29, z + 0.8], 0.16, 0.16, 7);
      b.cyl('#d9b98c', [px, 0.17 + row * 0.29, z + 0.81], 0.14, 0.14, 0.02, 7, [Math.PI / 2, 0, 0]);
    }
  }
}

export type BuildingType = 'campfire' | 'hunter_hut' | 'carpenter_workshop' | 'herbalist_lodge' | 'watchtower' | 'bridge' | 'shelter' | 'stone_storehouse';

/** Footprint radius used for placement checks and player collision. */
export const FOOTPRINT: Record<string, number> = {
  campfire: 1.8, hunter_hut: 3.0, carpenter_workshop: 3.8, herbalist_lodge: 3.0, watchtower: 2.6, bridge: 0,
  shelter: 2.5, stone_storehouse: 3.0,
};
export const BRIDGE_LENGTH = 22;
export const BRIDGE_DECK_Y = 1.1; // deck surface above the building origin

const buildingCache = new Map<string, THREE.BufferGeometry>();

export function getBuildingGeometry(type: string): THREE.BufferGeometry {
  const hit = buildingCache.get(type);
  if (hit) return hit;
  const b = new Builder();

  if (type === 'campfire') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      b.add(new THREE.DodecahedronGeometry(0.2, 0), i % 2 ? C.stone : C.stoneDark, [Math.cos(a) * 0.85, 0.12, Math.sin(a) * 0.85], [a, a * 2, 0], [1, 0.7, 1.1]);
    }
    b.cyl('#2b2522', [0, 0.02, 0], 0.75, 0.75, 0.04, 10);
    b.limb('#5a3820', [-0.5, 0.1, -0.2], [0.45, 0.32, 0.2], 0.07, 0.06);
    b.limb('#6b4a32', [0.5, 0.1, -0.25], [-0.4, 0.34, 0.25], 0.07, 0.06);
    b.limb('#5a3820', [0, 0.1, 0.55], [0, 0.36, -0.45], 0.07, 0.06);
    for (const a of [0.6, 2.2, 3.9]) {
      // log benches around the fire
      const cx = Math.cos(a) * 2.6, cz = Math.sin(a) * 2.6;
      const tx = -Math.sin(a) * 0.8, tz = Math.cos(a) * 0.8;
      b.limb('#6b4a32', [cx - tx, 0.22, cz - tz], [cx + tx, 0.22, cz + tz], 0.2, 0.2, 7);
    }
  } else if (type === 'hunter_hut') {
    kathKuni(b, 3.6, 3.2, 3);
    // pelt drying rack + archery target
    b.limb(C.timberDark, [2.7, 0, 0.6], [2.7, 1.8, 0.6], 0.05, 0.05).limb(C.timberDark, [2.7, 0, -0.9], [2.7, 1.8, -0.9], 0.05, 0.05);
    b.limb(C.timber, [2.7, 1.75, 0.7], [2.7, 1.75, -1.0], 0.04, 0.04);
    b.box('#a8622f', [2.72, 1.3, -0.15], [0.04, 0.8, 0.9]);
    b.cyl('#f5f0e6', [-2.9, 1.0, 1.4], 0.45, 0.45, 0.1, 12, [Math.PI / 2, 0, 0]);
    b.cyl('#dc2626', [-2.9, 1.0, 1.46], 0.3, 0.3, 0.02, 12, [Math.PI / 2, 0, 0]);
    b.cyl('#f5f0e6', [-2.9, 1.0, 1.475], 0.16, 0.16, 0.02, 12, [Math.PI / 2, 0, 0]);
    b.limb(C.timberDark, [-2.9, 0, 1.3], [-2.9, 0.65, 1.38], 0.04, 0.04);
  } else if (type === 'carpenter_workshop') {
    kathKuni(b, 3.4, 3.0, 3, -0.8, 0);
    // open timber shed
    for (const [x, z] of [[1.4, 1.6], [3.4, 1.6], [1.4, -1.4], [3.4, -1.4]]) b.limb(C.timberDark, [x, 0, z], [x, 2.3, z], 0.08, 0.08);
    b.box(C.slate, [2.4, 2.45, 0.1], [2.6, 0.12, 3.6], [0.18, 0, 0]);
    woodPile(b, 2.4, 0.1);
    b.box(C.timber, [2.4, 0.7, 2.6], [1.4, 0.1, 0.4]); // sawhorse
    b.limb(C.timberDark, [1.9, 0, 2.6], [1.9, 0.65, 2.6], 0.04, 0.04).limb(C.timberDark, [2.9, 0, 2.6], [2.9, 0.65, 2.6], 0.04, 0.04);
  } else if (type === 'herbalist_lodge') {
    kathKuni(b, 3.2, 3.0, 3);
    for (const x of [-2.6, 2.6]) {
      b.limb(C.timberDark, [x, 0, 1.2], [x, 1.9, 1.2], 0.05, 0.05).limb(C.timberDark, [x, 0, -1.2], [x, 1.9, -1.2], 0.05, 0.05);
      b.limb(C.timber, [x, 1.85, 1.3], [x, 1.85, -1.3], 0.035, 0.035);
      for (let i = -2; i <= 2; i++) b.cone(i % 2 ? '#4d7c2f' : '#65a30d', [x, 1.55, i * 0.45], 0.12, 0.5, 5, [Math.PI, 0, 0]);
    }
    for (const x of [-0.9, 0.9]) {
      b.cyl('#9a3412', [x, 0.2, 2.2], 0.18, 0.13, 0.4, 7);
      b.ellipsoid(x < 0 ? '#e11d48' : '#a855f7', [x, 0.48, 2.2], [0.2, 0.15, 0.2]);
    }
  } else if (type === 'watchtower') {
    b.box(C.stone, [0, 0.5, 0], [3.4, 1.0, 3.4]);
    let y = 1.0;
    for (let i = 0; i < 9; i++) {
      b.box(C.timber, [0, y + 0.09, 0], [2.9, 0.18, 2.9]);
      b.box(i % 2 ? C.stoneDark : C.stone, [0, y + 0.34, 0], [2.75, 0.32, 2.75]);
      y += 0.5;
    }
    b.box(C.timber, [0, y + 0.12, 0], [4.0, 0.24, 4.0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.limb(C.timberDark, [sx * 1.85, y, sz * 1.85], [sx * 1.85, y + 1.6, sz * 1.85], 0.07, 0.07);
    for (const s of [-1, 1]) {
      b.box(C.timberDark, [0, y + 0.85, s * 1.9], [3.9, 0.08, 0.08]);
      b.box(C.timberDark, [s * 1.9, y + 0.85, 0], [0.08, 0.08, 3.9]);
    }
    b.cone(C.slate, [0, y + 2.2, 0], 3.2, 1.3, 4, [0, Math.PI / 4, 0]);
    b.limb(C.timberDark, [0, y + 2.8, 0], [0, y + 4.2, 0], 0.04, 0.03);
    b.box('#ea580c', [0.32, y + 3.95, 0], [0.6, 0.35, 0.02]);
  } else if (type === 'bridge') {
    const L = BRIDGE_LENGTH, W = 3.0, deck = BRIDGE_DECK_Y;
    for (let i = 0; i < 22; i++) {
      const x = -L / 2 + (i + 0.5) * (L / 22);
      b.box(i % 2 ? C.timber : '#8a5a34', [x, deck - 0.08, 0], [L / 22 - 0.04, 0.16, W]);
    }
    b.box(C.timberDark, [0, deck - 0.3, W / 2 - 0.2], [L, 0.25, 0.25]);
    b.box(C.timberDark, [0, deck - 0.3, -W / 2 + 0.2], [L, 0.25, 0.25]);
    for (const x of [-5.5, 5.5]) b.box(C.stone, [x, deck - 2.4, 0], [1.4, 4.4, 3.4]); // piers into the riverbed
    for (const x of [-L / 2 + 0.6, L / 2 - 0.6]) b.box(C.stoneDark, [x, deck - 1.2, 0], [1.6, 2.2, 3.8]); // abutments
    for (let i = 0; i <= 11; i++) {
      const x = -L / 2 + i * (L / 11);
      for (const s of [-1, 1]) b.limb(C.timberDark, [x, deck, s * (W / 2 - 0.1)], [x, deck + 1.0, s * (W / 2 - 0.1)], 0.06, 0.05);
    }
    for (const s of [-1, 1]) b.box(C.timber, [0, deck + 0.95, s * (W / 2 - 0.1)], [L, 0.1, 0.1]);
  } else {
    kathKuni(b, 3.4, 3.0, 3);
  }

  const g = b.build();
  buildingCache.set(type, g);
  return g;
}

// ===========================================================================
// PROPS
// ===========================================================================
export function buildLog(): THREE.BufferGeometry {
  return new Builder()
    .limb('#6b4a32', [-1.1, 0.27, 0], [1.1, 0.3, 0.05], 0.29, 0.25, 8)
    .cyl('#d9b98c', [1.11, 0.3, 0.05], 0.235, 0.235, 0.03, 8, [0, 0, Math.PI / 2])
    .cyl('#b9925f', [1.12, 0.3, 0.05], 0.13, 0.13, 0.03, 8, [0, 0, Math.PI / 2])
    .cyl('#d9b98c', [-1.11, 0.27, 0], 0.275, 0.275, 0.03, 8, [0, 0, Math.PI / 2])
    .limb('#5a3820', [0.2, 0.42, 0.1], [0.45, 0.85, 0.35], 0.07, 0.04, 5)
    .ellipsoid('#4d7c2f', [-0.3, 0.52, 0], [0.32, 0.07, 0.2])
    .build();
}

/** Landmark cairn with a pole of Himalayan prayer flags. */
export function buildCairn(): THREE.BufferGeometry {
  const b = new Builder();
  const stones: Array<[number, number, number]> = [[0, 0.25, 0.55], [0.1, 0.62, 0.42], [-0.05, 0.92, 0.32], [0.04, 1.14, 0.22]];
  stones.forEach(([x, y, r], i) => b.add(new THREE.DodecahedronGeometry(r, 0), i % 2 ? C.stoneDark : C.stone, [x, y, 0], [i, i * 0.7, 0], [1, 0.6, 1]));
  b.limb(C.timberDark, [0.6, 0, 0.2], [0.6, 3.2, 0.2], 0.045, 0.035);
  const flags = ['#1d4ed8', '#f8fafc', '#dc2626', '#16a34a', '#facc15'];
  for (let i = 0; i < 10; i++) {
    const t = i / 10;
    b.box(flags[i % 5], [0.6 + t * 3.2, 3.05 - t * 2.1 - Math.sin(t * Math.PI) * 0.25, 0.2], [0.22, 0.3, 0.02], [0, 0, -0.55]);
  }
  b.limb('#e7e0d0', [0.6, 3.15, 0.2], [3.9, 0.95, 0.2], 0.008, 0.008, 3);
  b.limb(C.timberDark, [3.95, 0, 0.2], [3.95, 1.05, 0.2], 0.04, 0.03);
  return b.build();
}

/** Arrow pointing along -z (shaft, flint head, fletching). */
export function buildArrow(): THREE.BufferGeometry {
  return new Builder()
    .limb('#c8a26b', [0, 0, 0.42], [0, 0, -0.38], 0.011, 0.011, 4)
    .cone('#4b5563', [0, 0, -0.43], 0.025, 0.1, 4, [-Math.PI / 2, 0, 0])
    .box('#dc2626', [0, 0.018, 0.36], [0.004, 0.035, 0.12])
    .box('#f5f5f4', [0.016, -0.009, 0.36], [0.035, 0.004, 0.12], [0, 0, 0.5])
    .box('#f5f5f4', [-0.016, -0.009, 0.36], [0.035, 0.004, 0.12], [0, 0, -0.5])
    .build();
}

/** First-person bow: riser + two curved limbs, string handled separately. Held vertically, string toward +z. */
export function buildBow(): THREE.BufferGeometry {
  const b = new Builder().cyl('#3b2416', [0, 0, 0], 0.022, 0.022, 0.16, 6).cyl('#b45309', [0, 0, 0], 0.024, 0.024, 0.05, 6);
  for (const s of [1, -1]) {
    let prev: V3 = [0, s * 0.08, 0];
    for (let i = 1; i <= 5; i++) {
      const t = i / 5;
      // limbs sweep back toward the archer (+z); string sits behind the grip
      const p: V3 = [0, s * (0.08 + t * 0.48), 0.15 * t * t - 0.025 * Math.sin(t * Math.PI)];
      b.limb('#7a4b2a', prev, p, 0.02 - t * 0.007, 0.02 - t * 0.009, 5);
      prev = p;
    }
  }
  return b.build();
}
/** Where the bowstring attaches, in bow space. */
export const BOW_TIPS: [V3, V3] = [[0, 0.56, 0.15], [0, -0.56, 0.15]];
