/**
 * Archery.tsx — bow, arrows and hit detection.
 *
 *  - Hold left mouse to draw (0.7 s to full power), release to shoot. Hold right mouse to aim.
 *  - Arrows fly on a ballistic arc. Hits are tested along the whole segment travelled each
 *    frame (no tunnelling at 80 m/s). Arrows stick in the ground and in tree trunks.
 *  - Damage scales with draw power; aiming adds accuracy and +15 %; headshots deal double.
 *  - One InstancedMesh for every arrow in the world; the first-person bow clears depth so it
 *    never clips into terrain.
 */
import { useFrame, useThree } from '@react-three/fiber';
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { emit, engine, makeNoise } from './engine';
import { treeTrunkAt } from './ForestStreamer';
import { BOW_TIPS, buildArrow, buildBow, flatMaterial } from './models';
import { getTerrainHeight } from './terrain';
import { gameAudio } from './utils/helper';
import { arrowHitTest, damageAnimal } from './Wildlife';

const MAX = 40;
const GRAVITY = 9.8 * 0.6; // slightly floaty: readable arcs, forgiving for a casual game
const FWD = new THREE.Vector3(0, 0, -1);

interface Arrow {
  state: 0 | 1 | 2; // free, flying, stuck
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  life: number;
  power: number;
  aimed: boolean;
}
export const arrowPool: Arrow[] = Array.from({ length: MAX }, () => ({
  state: 0, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
  quat: new THREE.Quaternion(), life: 0, power: 0, aimed: false,
}));

const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Fire from the camera. `power` 0..1. Returns false if no free slot. */
export function fireArrow(camera: THREE.Camera, power: number, aimed: boolean) {
  let slot = arrowPool.find((a) => a.state === 0);
  if (!slot) {
    // recycle the oldest stuck arrow
    slot = arrowPool.reduce((o, a) => (a.state === 2 && (o.state !== 2 || a.life < o.life) ? a : o), arrowPool[0]);
  }
  camera.updateMatrixWorld();
  camera.getWorldDirection(_dir);
  const spread = (aimed ? 0.002 : 0.012) * (1.2 - power);
  _dir.x += (Math.random() - 0.5) * spread;
  _dir.y += (Math.random() - 0.5) * spread;
  _dir.z += (Math.random() - 0.5) * spread;
  _dir.normalize();
  const speed = 34 + 56 * power;
  slot.state = 1;
  slot.pos.copy(camera.position).addScaledVector(_dir, 0.6);
  slot.pos.y -= 0.05;
  slot.prev.copy(slot.pos);
  slot.vel.copy(_dir).multiplyScalar(speed);
  slot.quat.setFromUnitVectors(FWD, _dir);
  slot.life = 5;
  slot.power = power;
  slot.aimed = aimed;
  makeNoise(camera.position.x, camera.position.z, 14);
  return true;
}

export function updateArrows(dt: number) {
  for (const a of arrowPool) {
    if (a.state === 0) continue;
    a.life -= dt;
    if (a.state === 2) {
      if (a.life <= 0) a.state = 0;
      continue;
    }
    a.prev.copy(a.pos);
    a.vel.y -= GRAVITY * dt;
    a.pos.addScaledVector(a.vel, dt);
    a.quat.setFromUnitVectors(FWD, _n.copy(a.vel).normalize());

    const hit = arrowHitTest(a.prev, a.pos);
    if (hit) {
      const dmg = (28 + 62 * a.power) * (a.aimed ? 1.15 : 1);
      damageAnimal(hit.animal, dmg, hit.headshot);
      gameAudio.playMeleePunch();
      a.state = 0;
      continue;
    }
    const ground = getTerrainHeight(a.pos.x, a.pos.z);
    if (a.pos.y <= ground + 0.05) {
      a.pos.y = ground + 0.12;
      a.state = 2;
      a.life = 14;
      makeNoise(a.pos.x, a.pos.z, 9);
      continue;
    }
    if (treeTrunkAt(a.pos.x, a.pos.y, a.pos.z)) {
      a.state = 2;
      a.life = 14;
      makeNoise(a.pos.x, a.pos.z, 8);
      gameAudio.playFootstepWood();
      continue;
    }
    if (a.life <= 0) a.state = 0;
  }
}

const _m = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);

export function ArrowRenderer() {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(buildArrow(), flatMaterial, MAX);
    m.count = 0;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return m;
  }, []);
  useFrame(() => {
    let n = 0;
    for (const a of arrowPool) {
      if (a.state === 0) continue;
      mesh.setMatrixAt(n++, _m.compose(a.pos, a.quat, _one));
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={mesh} />;
}

// ---------------------------------------------------------------------------
// First-person bow
// ---------------------------------------------------------------------------
const REST = { pos: new THREE.Vector3(0.26, -0.24, -0.62), rot: new THREE.Euler(0.05, 0.28, -0.45) };
const AIM = { pos: new THREE.Vector3(0.035, -0.05, -0.62), rot: new THREE.Euler(0.0, 0.03, -0.32) };
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _tip = new THREE.Vector3();
const _nock = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export function BowViewModel() {
  const { camera } = useThree();
  const rig = useMemo(() => {
    const root = new THREE.Group();
    const holder = new THREE.Group();
    root.add(holder);
    holder.scale.setScalar(0.5);

    const bow = new THREE.Mesh(buildBow(), flatMaterial);
    const stringMat = new THREE.MeshBasicMaterial({ color: '#efe6d2' });
    const strGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 1, 4);
    const s1 = new THREE.Mesh(strGeo, stringMat);
    const s2 = new THREE.Mesh(strGeo, stringMat);
    const arrow = new THREE.Mesh(buildArrow(), flatMaterial);
    const hand = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1).scale(0.05, 0.065, 0.05),
      new THREE.MeshLambertMaterial({ color: '#c99068', flatShading: true }),
    );
    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.055, 0.5, 7).translate(0, -0.25, 0),
      new THREE.MeshLambertMaterial({ color: '#4d5d3a', flatShading: true }),
    );
    sleeve.position.set(0.02, -0.03, 0.04);
    sleeve.rotation.set(-1.1, 0, 0.35);
    holder.add(bow, s1, s2, arrow, hand, sleeve);

    // The view model clears depth so it never clips into terrain. It must render LAST, after
    // the transparent pass (water, icons), so every material here is flagged transparent.
    const vmMat = flatMaterial.clone();
    bow.material = vmMat;
    arrow.material = vmMat;
    root.traverse((o) => {
      o.renderOrder = 1000;
      o.frustumCulled = false;
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) { m.transparent = true; m.depthWrite = true; }
    });
    // draw on top of the world: clear depth right before the first view-model mesh
    bow.onBeforeRender = (renderer) => renderer.clearDepth();
    return { root, holder, s1, s2, arrow };
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const B = engine.bow;
    rig.root.visible = engine.playing && !engine.uiOpen && !engine.world.placing;
    rig.root.position.copy(camera.position);
    rig.root.quaternion.copy(camera.quaternion);

    // pose: rest at lower right, raised to centre while aiming or drawing
    const k = Math.min(1, (B.aiming ? 1 : 0) + B.draw * 1.4);
    const h = rig.holder;
    const tgt = _mid.lerpVectors(REST.pos, AIM.pos, k);
    const walkBob = engine.player.moving ? Math.sin(engine.clock * (engine.player.sprinting ? 13 : 9)) * 0.012 * (1 - k * 0.7) : 0;
    tgt.y += walkBob;
    tgt.z += B.cooldown > 0.2 ? 0.03 : 0; // recoil
    h.position.lerp(tgt, Math.min(1, dt * 12));
    _qa.setFromEuler(REST.rot);
    _qb.setFromEuler(AIM.rot);
    h.quaternion.slerp(_qa.slerp(_qb, k), Math.min(1, dt * 12));

    // string: tips -> nock point pulled back with draw
    const pull = 0.15 + B.draw * 0.3;
    _nock.set(0, 0, pull);
    const tips = BOW_TIPS;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? rig.s1 : rig.s2;
      _tip.set(tips[i][0], tips[i][1], tips[i][2]);
      _mid.addVectors(_tip, _nock).multiplyScalar(0.5);
      s.position.copy(_mid);
      const len = _tip.distanceTo(_nock);
      s.scale.set(1, len, 1);
      s.quaternion.setFromUnitVectors(_up, _tip.sub(_nock).normalize());
    }
    // nocked arrow sits on the string
    const hasArrow = engine.world.arrows > 0 && B.cooldown <= 0.15;
    rig.arrow.visible = hasArrow;
    rig.arrow.position.set(0.012, 0.0, pull - 0.42);
  });

  return <primitive object={rig.root} />;
}
