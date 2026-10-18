import * as THREE from 'three';
import { ATMOS } from './sky.js';

export const BLOCK = 80;      // block pitch (60 m block + 20 m street)
const LOT = 26;               // half-size of buildable lot inside the sidewalk

// Deterministic RNG so the city is the same every visit
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Procedural facade material: windows, mullions, glass reflections, lit rooms,
// all computed per pixel from world position (so any box size works).
// aInfo = (seed, style, unused). style 0 = concrete, 1 = glass curtain wall,
// 2 = brick, 3 = the hero tower.
// ---------------------------------------------------------------------------
export function createFacadeMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = { value: ATMOS.sunDir };
    shader.uniforms.uZenith = { value: ATMOS.zenith };
    shader.uniforms.uHorizon = { value: ATMOS.horizon };
    shader.uniforms.uSun = { value: ATMOS.sunColor };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aInfo;
        varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vInfo;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
          wn = mat3(instanceMatrix) * wn;
        #endif
        wp4 = modelMatrix * wp4;
        vWPos = wp4.xyz;
        vWNrm = normalize(mat3(modelMatrix) * wn);
        vInfo = aInfo;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSunDir, uZenith, uHorizon, uSun;
        varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vInfo;
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        vec3 skyReflect(vec3 r) {
          float up = clamp(r.y, 0.0, 1.0);
          vec3 s = mix(uHorizon, uZenith, pow(up, 0.5));
          s += uSun * pow(max(dot(r, uSunDir), 0.0), 10.0) * 0.4;
          // below the horizon: reflections of the street and other buildings
          vec3 g = mix(uHorizon * 0.45, vec3(0.09, 0.09, 0.1), clamp(-r.y * 3.0, 0.0, 1.0));
          return r.y > 0.0 ? s : g;
        }`)
      .replace('#include <emissivemap_fragment>', `
        {
          vec3 n = normalize(vWNrm);
          vec3 wall = diffuseColor.rgb;
          float seed = vInfo.x;
          float style = vInfo.y;
          vec3 V = normalize(vWPos - cameraPosition);
          if (n.y > 0.5) {
            // roof: gravel / membrane
            float g = h21(floor(vWPos.xz * 0.5) + seed);
            diffuseColor.rgb = vec3(0.30, 0.30, 0.31) * (0.85 + 0.25 * g);
          } else if (n.y < -0.5) {
            diffuseColor.rgb = vec3(0.12);
          } else {
            vec2 fc = vec2(dot(vWPos.xz, vec2(-n.z, n.x)), vWPos.y);
            float floorH = 3.6, bay = 3.0, wx = 0.24, wy0 = 0.28, wy1 = 0.9;
            vec3 glassTint = vec3(0.10, 0.12, 0.14);
            float refl = 0.55;
            if (style > 2.5) { floorH = 4.2; bay = 1.6; wx = 0.05; wy0 = 0.08; wy1 = 0.97; glassTint = vec3(0.04, 0.08, 0.10); refl = 0.9; }
            else if (style > 1.5) { floorH = 3.3; bay = 2.6; wx = 0.3; wy0 = 0.3; wy1 = 0.82; refl = 0.35; }
            else if (style > 0.5) { floorH = 3.9; bay = 1.5; wx = 0.06; wy0 = 0.12; wy1 = 0.95; glassTint = mix(vec3(0.05, 0.09, 0.12), vec3(0.12, 0.11, 0.09), fract(seed * 7.3)); refl = 0.8; }
            vec2 cell = fc / vec2(bay, floorH);
            vec2 id = floor(cell);
            vec2 f = fract(cell);
            vec2 fw = fwidth(cell) * 1.2;
            float mx = smoothstep(wx - fw.x, wx + fw.x, f.x) * (1.0 - smoothstep(1.0 - wx - fw.x, 1.0 - wx + fw.x, f.x));
            float my = smoothstep(wy0 - fw.y, wy0 + fw.y, f.y) * (1.0 - smoothstep(wy1 - fw.y, wy1 + fw.y, f.y));
            float cover = (1.0 - 2.0 * wx) * (wy1 - wy0);
            float lod = clamp(max(fw.x, fw.y) * 1.6 - 0.35, 0.0, 1.0);
            float win = mix(mx * my, cover, lod);
            // ground floor: tall storefront glazing
            float ground = 1.0 - step(5.0, vWPos.y);
            if (ground > 0.5) { win = mix(smoothstep(0.6, 1.0, vWPos.y) * (1.0 - smoothstep(3.8, 4.1, vWPos.y)), 0.6, lod); }
            float rnd = h21(id + seed * 13.0);
            float rnd2 = h21(id.yx + seed * 3.1 + 7.0);
            // per-pane slightly different orientation -> realistic patchy reflections
            vec3 np = normalize(n + vec3(rnd - 0.5, (rnd2 - 0.5) * 0.6, rnd2 - 0.5) * 0.035 * (1.0 - lod));
            vec3 R = reflect(V, np);
            float fres = 0.06 + 0.94 * pow(1.0 - max(dot(-V, np), 0.0), 5.0);
            vec3 reflCol = skyReflect(R) * mix(refl * 0.45, 1.0, fres);
            // interior: mostly dark, some lit offices, blinds
            vec3 interior = glassTint * (0.6 + 0.8 * rnd2);
            if (rnd > 0.86) interior += vec3(1.0, 0.82, 0.55) * 0.35 * rnd2;
            if (rnd2 > 0.8) interior = mix(interior, vec3(0.55, 0.52, 0.48), 0.5);
            // facade panels: slight per-floor tint variation + grime toward the ground
            float floorVar = h21(vec2(id.y, seed)) * 0.08;
            vec3 w = wall * (0.92 + floorVar);
            if (style > 0.5 && style < 1.5) w = wall * 0.35; // dark mullions on curtain walls
            if (style > 2.5) w = vec3(0.16, 0.18, 0.2);
            float ao = mix(0.5, 1.0, smoothstep(0.0, 12.0, vWPos.y));
            diffuseColor.rgb = mix(w * ao, interior * 0.6, win);
            totalEmissiveRadiance += win * (reflCol * 0.85 + interior * 0.25);
            // sun glint
            totalEmissiveRadiance += win * uSun * pow(max(dot(R, uSunDir), 0.0), 400.0) * 4.0 * (1.0 - lod * 0.7);
          }
        }
        #include <emissivemap_fragment>`);
  };
  mat.customProgramCacheKey = () => 'facade-v1';
  return mat;
}

// ---------------------------------------------------------------------------
function makeGroundTexture(renderer) {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const m = (v) => (v / BLOCK) * S; // metres -> px, cell spans [-40, 40] => [0, S]
  const C = (v) => m(v + 40);
  g.fillStyle = '#3b3d40';
  g.fillRect(0, 0, S, S);
  // asphalt noise
  const r = rng(7);
  for (let i = 0; i < 9000; i++) {
    const v = 40 + r() * 30 | 0;
    g.fillStyle = `rgba(${v},${v},${v + 3},0.25)`;
    g.fillRect(r() * S, r() * S, 2 + r() * 4, 2 + r() * 4);
  }
  // sidewalk + curb
  g.fillStyle = '#5a5955';
  g.fillRect(C(-30.4), C(-30.4), m(60.8), m(60.8));
  g.fillStyle = '#9b9890';
  g.fillRect(C(-30), C(-30), m(60), m(60));
  // sidewalk joints
  g.strokeStyle = 'rgba(60,60,60,0.35)';
  g.lineWidth = 1;
  for (let v = -30; v <= 30; v += 2) {
    g.beginPath(); g.moveTo(C(v), C(-30)); g.lineTo(C(v), C(-26)); g.moveTo(C(v), C(26)); g.lineTo(C(v), C(30));
    g.moveTo(C(-30), C(v)); g.lineTo(C(-26), C(v)); g.moveTo(C(26), C(v)); g.lineTo(C(30), C(v)); g.stroke();
  }
  // lot (mostly under buildings)
  g.fillStyle = '#6f6d68';
  g.fillRect(C(-LOT), C(-LOT), m(LOT * 2), m(LOT * 2));
  // lane markings (street centres lie on the cell edges)
  const dashed = (horizontal, pos, color, w, dash) => {
    g.fillStyle = color;
    for (let t = -40; t < 40; t += dash * 2) {
      if (Math.abs(t) < 31 || true) {
        if (horizontal) g.fillRect(C(t), C(pos) - m(w) / 2, m(dash), m(w));
        else g.fillRect(C(pos) - m(w) / 2, C(t), m(w), m(dash));
      }
    }
  };
  for (const edge of [-40, 40]) {
    for (const off of [-0.2, 0.2]) {
      // double yellow centre line, broken at intersections
      g.fillStyle = '#c9a43a';
      g.fillRect(C(-30), C(edge + off) - 1.5, m(60), 3);
      g.fillRect(C(edge + off) - 1.5, C(-30), 3, m(60));
    }
    for (const off of [-5, 5]) {
      const p = edge + off;
      g.save(); g.beginPath(); g.rect(C(-30), 0, m(60), S); g.clip();
      dashed(true, p, '#d8d8d2', 0.15, 3); g.restore();
      g.save(); g.beginPath(); g.rect(0, C(-30), S, m(60)); g.clip();
      dashed(false, p, '#d8d8d2', 0.15, 3); g.restore();
    }
  }
  // crosswalks and stop lines at every corner
  g.fillStyle = '#e4e4de';
  for (const sx of [-1, 1]) {
    for (let k = -9; k <= 9; k += 1.2) {
      g.fillRect(C(sx * 32), C(40 + k) - m(0.3), m(3), m(0.6));
      g.fillRect(C(sx * 32), C(-40 + k) - m(0.3), m(3), m(0.6));
      g.fillRect(C(40 + k) - m(0.3), C(sx * 32), m(0.6), m(3));
      g.fillRect(C(-40 + k) - m(0.3), C(sx * 32), m(0.6), m(3));
    }
  }
  // stains
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(20,20,20,${0.05 + r() * 0.08})`;
    g.beginPath(); g.ellipse(r() * S, r() * S, 4 + r() * 20, 3 + r() * 10, r() * 3, 0, 7); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function createGround(renderer, ox, oz) {
  const SIZE = 12000;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - ox) / BLOCK + 0.5, (pos.getZ(i) - oz) / BLOCK + 0.5);
  }
  const mat = new THREE.MeshLambertMaterial({ map: makeGroundTexture(renderer) });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// Track clearance lookup: min track height per 10 m cell
class TrackClearance {
  constructor(path) {
    this.cell = 10;
    this.map = new Map();
    for (let i = 0; i < path.count; i += 2) {
      const x = path.pos[i * 3], y = path.pos[i * 3 + 1], z = path.pos[i * 3 + 2];
      const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
      const cur = this.map.get(k);
      if (cur === undefined || y < cur) this.map.set(k, y);
    }
  }
  key(i, j) { return i * 100003 + j; }
  minY(x0, z0, x1, z1) {
    let min = Infinity;
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++)
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const v = this.map.get(this.key(i, j));
        if (v !== undefined && v < min) min = v;
      }
    return min;
  }
}

const PALETTE = {
  concrete: [0xb9b2a6, 0xcfc8bb, 0x9c968d, 0xd8d3c8, 0x8c8a86, 0xc4b59c, 0xa8a49c],
  glass: [0x8a99a6, 0x6f7f8c, 0x9aa3a8, 0x7b8a84],
  brick: [0x8d4a35, 0x9b5a3f, 0x7a4334, 0xa86b4f, 0x6e4a3c],
};

// ---------------------------------------------------------------------------
export function createCity(renderer, path, tower, station) {
  const group = new THREE.Group();
  const ox = tower.cx, oz = tower.cz;
  group.add(createGround(renderer, ox, oz));

  const clearance = new TrackClearance(path);
  const R = rng(1234);
  const builds = [];    // {x,z,w,d,y0,h,style,color,seed}
  const parks = [];
  const RANGE = 30;     // blocks each way
  const plazaHalf = 115;

  const blocked = (x0, z0, x1, z1) => {
    // tower plaza
    if (x1 > ox - plazaHalf && x0 < ox + plazaHalf && z1 > oz - plazaHalf && z0 < oz + plazaHalf) return true;
    // station
    if (x1 > station.x0 && x0 < station.x1 && z1 > station.z0 && z0 < station.z1) return true;
    return false;
  };

  const addBuilding = (x, z, w, d, h, distN) => {
    const pad = 9;
    if (blocked(x - w / 2, z - d / 2, x + w / 2, z + d / 2)) return;
    const tY = clearance.minY(x - w / 2 - pad, z - d / 2 - pad, x + w / 2 + pad, z + d / 2 + pad);
    if (tY < h + 10) {
      h = tY - 14;
      if (h < 7) return;
    }
    let style, color;
    const t = R();
    if (h > 70 && t < 0.65) { style = 1; color = PALETTE.glass[(R() * 4) | 0]; }
    else if (h < 40 && t < 0.4) { style = 2; color = PALETTE.brick[(R() * 5) | 0]; }
    else { style = 0; color = PALETTE.concrete[(R() * 7) | 0]; }
    const seed = R() * 100;
    builds.push({ x, z, w, d, y0: 0, h, style, color, seed });
    // setback crown on tall towers
    if (h > 90 && R() < 0.55) {
      const s = 0.62 + R() * 0.2;
      const h2 = h * (0.12 + R() * 0.2);
      const tY2 = clearance.minY(x - w * s / 2 - pad, z - d * s / 2 - pad, x + w * s / 2 + pad, z + d * s / 2 + pad);
      if (tY2 > h + h2 + 10) builds.push({ x, z, w: w * s, d: d * s, y0: h, h: h2, style, color, seed: seed + 1 });
    }
    return h;
  };

  for (let bi = -RANGE; bi <= RANGE; bi++) {
    for (let bj = -RANGE; bj <= RANGE; bj++) {
      const cx = ox + bi * BLOCK, cz = oz + bj * BLOCK;
      const dist = Math.hypot(cx - ox, cz - oz);
      if (dist > RANGE * BLOCK) continue;
      const distN = dist / (RANGE * BLOCK);
      if (blocked(cx - 30, cz - 30, cx + 30, cz + 30)) continue;
      if (R() < 0.05 + distN * 0.05) { parks.push({ x: cx, z: cz }); continue; }
      // height profile: dense downtown core, falling off to low-rise suburbs
      const core = Math.exp(-Math.pow(dist / 650, 2));
      const mid = Math.exp(-Math.pow(dist / 1500, 2));
      const hBase = 9 + 28 * mid + 105 * core;
      const H = () => Math.max(8, hBase * (0.35 + R() * R() * 1.6 + R() * 0.3));
      const layout = R();
      if (layout < 0.35) {
        const w = 34 + R() * 18, d = 34 + R() * 18;
        addBuilding(cx + (R() - 0.5) * (52 - w), cz + (R() - 0.5) * (52 - d), w, d, H() * 1.15, distN);
      } else if (layout < 0.65) {
        const split = -6 + R() * 12;
        const gap = 1.5 + R() * 3;
        const wa = LOT + split - gap / 2, wb = LOT - split - gap / 2;
        if (R() < 0.5) {
          addBuilding(cx - LOT + wa / 2, cz, wa, 40 + R() * 12, H(), distN);
          addBuilding(cx + LOT - wb / 2, cz, wb, 40 + R() * 12, H(), distN);
        } else {
          addBuilding(cx, cz - LOT + wa / 2, 40 + R() * 12, wa, H(), distN);
          addBuilding(cx, cz + LOT - wb / 2, 40 + R() * 12, wb, H(), distN);
        }
      } else {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          if (R() < 0.08) continue;
          const w = 18 + R() * 6, d = 18 + R() * 6;
          addBuilding(cx + sx * (LOT - w / 2), cz + sz * (LOT - d / 2), w, d, H() * 0.8, distN);
        }
      }
    }
  }

  // ---- buildings as one instanced mesh ----
  const facade = createFacadeMaterial();
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const count = builds.length + 1; // +1 for the tower body
  const info = new Float32Array(count * 3);
  const im = new THREE.InstancedMesh(boxGeo, facade, count);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  builds.forEach((b, i) => {
    m4.makeScale(b.w, b.h, b.d).setPosition(b.x, b.y0, b.z);
    im.setMatrixAt(i, m4);
    im.setColorAt(i, col.setHex(b.color));
    info[i * 3] = b.seed; info[i * 3 + 1] = b.style;
  });
  // hero tower body uses the same shader (style 3)
  const ti = builds.length;
  m4.makeScale(tower.w, tower.h, tower.d).setPosition(tower.cx, 0, tower.cz);
  im.setMatrixAt(ti, m4);
  im.setColorAt(ti, col.setHex(0x7a8890));
  info[ti * 3] = 42; info[ti * 3 + 1] = 3;
  boxGeo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 3));
  im.frustumCulled = false;
  group.add(im);

  // ---- rooftop clutter: HVAC boxes, water tanks, stair bulkheads ----
  const roofItems = [];
  for (const b of builds) {
    const n = b.h > 15 ? 1 + ((R() * 3) | 0) : 0;
    for (let k = 0; k < n; k++) {
      const s = 2 + R() * (Math.min(b.w, b.d) * 0.25);
      roofItems.push({ x: b.x + (R() - 0.5) * (b.w - s - 2), z: b.z + (R() - 0.5) * (b.d - s - 2), y: b.y0 + b.h, w: s, d: s * (0.6 + R() * 0.8), h: 1.5 + R() * 3.5 });
    }
  }
  const roofMesh = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x8d8f91 }), roofItems.length);
  roofItems.forEach((r, i) => {
    m4.makeScale(r.w, r.h, r.d).setPosition(r.x, r.y, r.z);
    roofMesh.setMatrixAt(i, m4);
  });
  roofMesh.frustumCulled = false;
  group.add(roofMesh);

  // ---- parks + trees ----
  const grassGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const grass = new THREE.InstancedMesh(grassGeo, new THREE.MeshLambertMaterial({ color: 0x4d6b36 }), parks.length + 1);
  parks.forEach((p, i) => { m4.makeScale(52, 1, 52).setPosition(p.x, 0.06, p.z); grass.setMatrixAt(i, m4); });
  // plaza paving around the tower
  m4.makeScale(plazaHalf * 2 - 10, 1, plazaHalf * 2 - 10).setPosition(ox, 0.05, oz);
  grass.setMatrixAt(parks.length, m4);
  grass.setColorAt(parks.length, col.setHex(0xa29c90));
  for (let i = 0; i < parks.length; i++) grass.setColorAt(i, col.setHex(0xffffff));
  grass.frustumCulled = false;
  group.add(grass);

  const trees = [];
  for (const p of parks) {
    for (let k = 0; k < 14; k++) trees.push({ x: p.x + (R() - 0.5) * 48, z: p.z + (R() - 0.5) * 48, s: 0.7 + R() * 0.7 });
  }
  for (let k = 0; k < 70; k++) { // plaza trees
    const a = R() * Math.PI * 2, rr = 50 + R() * 50;
    const x = ox + Math.cos(a) * rr, z = oz + Math.sin(a) * rr;
    if (Math.abs(x - tower.trackX) < 12) continue;
    trees.push({ x, z, s: 0.6 + R() * 0.5 });
  }
  const crownGeo = new THREE.IcosahedronGeometry(3.4, 0);
  crownGeo.translate(0, 7, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 5, 5, 1, true);
  trunkGeo.translate(0, 2.5, 0);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0x3f5e2a, flatShading: true }), trees.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x4a3a2c }), trees.length);
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), pp = new THREE.Vector3();
  trees.forEach((t, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.28);
    sc.set(t.s, t.s * (0.85 + R() * 0.4), t.s);
    m4.compose(pp.set(t.x, 0, t.z), q, sc);
    crowns.setMatrixAt(i, m4); trunks.setMatrixAt(i, m4);
    crowns.setColorAt(i, col.setHSL(0.22 + R() * 0.08, 0.35 + R() * 0.2, 0.55 + R() * 0.25));
  });
  crowns.frustumCulled = trunks.frustumCulled = false;
  group.add(crowns, trunks);

  const traffic = createTraffic(ox, oz, plazaHalf, R);
  group.add(traffic.mesh);

  return { group, traffic, buildings: builds };
}

// ---------------------------------------------------------------------------
function createTraffic(ox, oz, plazaHalf, R) {
  const body = new THREE.BoxGeometry(1.8, 0.75, 4.4);
  body.translate(0, 0.55, 0);
  const cabin = new THREE.BoxGeometry(1.6, 0.6, 2.3);
  cabin.translate(0, 1.2, -0.2);
  const geo = mergeBoxes([body, cabin]);
  const COUNT = 900;
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), COUNT);
  mesh.frustumCulled = false;
  const cars = [];
  const colors = [0xf2f2f2, 0x1a1a1a, 0x8a8f94, 0x2b3f63, 0x7d1d1d, 0xc0c4c8, 0x334, 0xd8c9a0, 0xf0c419];
  const col = new THREE.Color();
  const span = 22 * BLOCK;
  for (let i = 0; i < COUNT; i++) {
    const alongX = R() < 0.5;
    const street = Math.round((R() - 0.5) * 40) * BLOCK + BLOCK / 2;
    const lane = [-7.5, -2.5, 2.5, 7.5][(R() * 4) | 0];
    const dir = lane > 0 ? 1 : -1;
    cars.push({ alongX, line: (alongX ? oz : ox) + street + lane, t: (R() - 0.5) * 2 * span, dir, v: 9 + R() * 6, span });
    mesh.setColorAt(i, col.setHex(colors[(R() * colors.length) | 0]));
  }
  const m4 = new THREE.Matrix4();
  const update = (dt, center) => {
    for (let i = 0; i < COUNT; i++) {
      const c = cars[i];
      c.t += c.dir * c.v * dt;
      if (c.t > span) c.t -= 2 * span; else if (c.t < -span) c.t += 2 * span;
      let x, z;
      if (c.alongX) { x = ox + c.t; z = c.line; } else { x = c.line; z = oz + c.t; }
      const inPlaza = Math.abs(x - ox) < plazaHalf && Math.abs(z - oz) < plazaHalf;
      if (inPlaza) { m4.makeScale(0, 0, 0); }
      else if (c.alongX) m4.makeRotationY(c.dir > 0 ? -Math.PI / 2 : Math.PI / 2).setPosition(x, 0.1, z);
      else m4.makeRotationY(c.dir > 0 ? Math.PI : 0).setPosition(x, 0.1, z);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { mesh, update };
}

export function mergeBoxes(geos) {
  // tiny merge helper for non-indexed-compatible geometries
  let vCount = 0, iCount = 0;
  for (const g of geos) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const pos = new Float32Array(vCount * 3), nrm = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nrm.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
    vo += g.attributes.position.count; io += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
