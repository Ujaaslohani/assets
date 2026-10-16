/**
 * Water.tsx — flowing river, waterfall, plunge pool, spray and mist.
 * All animation runs in shaders (no per-frame CPU work besides one time uniform).
 * The river mesh stores water depth per vertex so shallows fade into the banks and foam.
 */
import { useFrame } from '@react-three/fiber';
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { getTerrainHeight, MAP_HALF, RIVER_HALF_WIDTH, RIVER_HEAD_Z, RIVER_X, WATER_Y } from './terrain';

const NOISE = /* glsl */ `
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
`;

function riverMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aDepth; varying float vDepth; varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vDepth = aDepth; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying float vDepth; varying vec3 vW;
      #include <fog_pars_fragment>
      ${NOISE}
      void main(){
        float t = uTime;
        vec2 p = vec2(vW.x * 0.45, vW.z * 0.16 - t * 1.4);              // flows toward +z (south)
        float n1 = vnoise(p * 1.7);
        float n2 = vnoise(p * 4.1 + vec2(4.3, -t * 0.7));
        float n3 = vnoise(vec2(vW.x * 1.3, vW.z * 0.9 - t * 2.6));
        float depth = clamp(vDepth, 0.0, 1.0);
        vec3 shallow = vec3(0.38, 0.72, 0.74), deep = vec3(0.08, 0.36, 0.48);
        vec3 col = mix(shallow, deep, smoothstep(0.05, 0.55, depth));
        col += vec3(0.85, 0.95, 1.0) * smoothstep(0.62, 0.9, n1 * 0.55 + n2 * 0.45) * 0.28;   // streaks
        float foam = (1.0 - smoothstep(0.02, 0.16, depth)) * smoothstep(0.35, 0.75, n3);
        col = mix(col, vec3(0.94, 0.97, 0.98), foam * 0.85);
        col += vec3(1.0) * pow(max(n2, 0.0), 9.0) * 0.9;                                      // sun glints
        float alpha = smoothstep(0.0, 0.05, vDepth) * 0.92;
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
  });
}

function buildRiverGeometry() {
  const width = RIVER_HALF_WIDTH * 2 + 6;
  const z0 = RIVER_HEAD_Z + 0.5, z1 = MAP_HALF + 10;
  const segX = 36, segZ = Math.ceil((z1 - z0) / 1.2);
  const g = new THREE.PlaneGeometry(width, z1 - z0, segX, segZ);
  g.rotateX(-Math.PI / 2);
  g.translate(RIVER_X, WATER_Y, (z0 + z1) / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) depth[i] = WATER_Y - getTerrainHeight(pos.getX(i), pos.getZ(i));
  g.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}

function fallMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv; varying vec3 vW;
      #include <fog_pars_fragment>
      ${NOISE}
      void main(){
        float s = vnoise(vec2(vUv.x * 18.0, vUv.y * 3.0 + uTime * 3.2));
        float s2 = vnoise(vec2(vUv.x * 41.0 + 3.0, vUv.y * 6.0 + uTime * 5.1));
        vec3 col = mix(vec3(0.42, 0.74, 0.82), vec3(0.95, 0.98, 1.0), smoothstep(0.35, 0.8, s * 0.6 + s2 * 0.4));
        col = mix(col, vec3(1.0), smoothstep(0.75, 1.0, 1.0 - vUv.y) * 0.8);                  // white foam at the base
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        gl_FragColor = vec4(col, (0.78 + 0.2 * s2) * edge);
        #include <fog_fragment>
      }`,
  });
}

function poolMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    fog: true, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vP;
      #include <fog_pars_vertex>
      void main(){ vP = position.xy; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vP;
      #include <fog_pars_fragment>
      ${NOISE}
      void main(){
        float r = length(vP);
        float ring = vnoise(vec2(atan(vP.y, vP.x) * 4.0, r * 1.6 - uTime * 1.8));
        float foam = smoothstep(0.35, 0.8, ring) * (1.0 - smoothstep(1.5, 5.5, r));
        gl_FragColor = vec4(vec3(0.97), foam * (1.0 - smoothstep(4.5, 6.0, r)));
        #include <fog_fragment>
      }`,
  });
}

function softTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.75)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function Water() {
  const parts = useMemo(() => {
    const root = new THREE.Group();
    const mats: THREE.ShaderMaterial[] = [];

    const riverMat = riverMaterial();
    mats.push(riverMat);
    const river = new THREE.Mesh(buildRiverGeometry(), riverMat);
    river.renderOrder = 2;
    root.add(river);

    // Waterfall sheet: from the cliff lip down to the pool, bowed outward like falling water.
    const lipZ = RIVER_HEAD_Z - 0.6;
    const top = getTerrainHeight(RIVER_X, RIVER_HEAD_Z - 1.0) + 0.4;
    const height = top - WATER_Y;
    const sheetGeo = new THREE.PlaneGeometry(7.5, height, 8, 24);
    const sp = sheetGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) {
      const v = (sp.getY(i) + height / 2) / height; // 0 bottom .. 1 top
      const fall = 1 - v;
      sp.setZ(i, Math.sqrt(fall) * 2.6 + Math.sin(sp.getX(i) * 1.3) * 0.15);
      sp.setX(i, sp.getX(i) * (1 + fall * 0.25));
    }
    sheetGeo.computeVertexNormals();
    const fallMat = fallMaterial();
    mats.push(fallMat);
    const sheet = new THREE.Mesh(sheetGeo, fallMat);
    sheet.position.set(RIVER_X, WATER_Y + height / 2, lipZ);
    sheet.renderOrder = 3;
    root.add(sheet);

    const poolMat = poolMaterial();
    mats.push(poolMat);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(6, 32), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(RIVER_X, WATER_Y + 0.03, lipZ + 3.4);
    pool.renderOrder = 4;
    root.add(pool);

    // Spray + mist (GPU animated)
    const N = 70;
    const sg = new THREE.BufferGeometry();
    const seed = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) seed[i] = Math.random();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    const sprayMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uTex: { value: softTexture() } },
      vertexShader: `attribute vec3 aSeed; uniform float uTime; varying float vA;
        void main(){ float t = fract(aSeed.x + uTime * (0.18 + aSeed.y * 0.22));
          float big = step(0.7, aSeed.z);
          vec3 p = vec3((aSeed.y - 0.5) * 9.0 * (0.4 + t), t * mix(3.0, 7.0, big), 2.0 + (aSeed.z - 0.5) * 6.0 + t * 2.0);
          vA = (1.0 - t) * mix(0.55, 0.28, big);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = mix(120.0, 900.0, big) * (0.5 + t) / -mv.z; }`,
      fragmentShader: `uniform sampler2D uTex; varying float vA; void main(){ vec4 c = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(1.0, 1.0, 1.0, c.a * vA); }`,
      transparent: true, depthWrite: false,
    });
    mats.push(sprayMat);
    const spray = new THREE.Points(sg, sprayMat);
    spray.position.set(RIVER_X, WATER_Y, lipZ);
    spray.frustumCulled = false;
    spray.renderOrder = 6;
    root.add(spray);

    return { root, mats };
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    for (const m of parts.mats) m.uniforms.uTime.value = t;
  });

  return <primitive object={parts.root} />;
}
