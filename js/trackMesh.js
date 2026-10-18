import * as THREE from 'three';
import { ZONE } from './trackPath.js';
import { mergeBoxes } from './city.js';

const GAUGE = 0.62;      // half distance between running rails
const RAIL_R = 0.075;
const SPINE_DROP = 0.62; // spine centre below rail centreline
const SPINE_R = 0.3;

// Sweep circular profiles along the track. Rings are emitted adaptively:
// dense on curves, sparse on straights.
function sweepTubes(path, tubes) {
  const pos = [], nrm = [], idx = [];
  const P = new THREE.Vector3(), F = new THREE.Vector3(), U = new THREE.Vector3(), Rt = new THREE.Vector3();
  const lastF = new THREE.Vector3(), lastU = new THREE.Vector3();
  const rings = [];
  let lastS = -1e9;
  const L = path.length;
  for (let s = 0; s <= L; s += 0.5) {
    path.sample(Math.min(s, L - 0.001), P, F, U);
    const turn = rings.length ? Math.max(1 - F.dot(lastF), 1 - U.dot(lastU)) : 1;
    if (s - lastS >= 5 || turn > 0.0006 || s >= L - 0.01) {
      if (s >= L - 0.01) path.sample(0, P, F, U); // close the loop seamlessly
      rings.push({ P: P.clone(), F: F.clone(), U: U.clone() });
      lastS = s; lastF.copy(F); lastU.copy(U);
    }
  }
  let base = 0;
  for (const tube of tubes) {
    const sides = tube.sides;
    for (const r of rings) {
      Rt.crossVectors(r.F, r.U);
      const cx = r.P.x + Rt.x * tube.x + r.U.x * tube.y;
      const cy = r.P.y + Rt.y * tube.x + r.U.y * tube.y;
      const cz = r.P.z + Rt.z * tube.x + r.U.z * tube.y;
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nx = Rt.x * ca + r.U.x * sa, ny = Rt.y * ca + r.U.y * sa, nz = Rt.z * ca + r.U.z * sa;
        pos.push(cx + nx * tube.r, cy + ny * tube.r, cz + nz * tube.r);
        nrm.push(nx, ny, nz);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const a = base + i * sides + k, b = base + i * sides + ((k + 1) % sides);
        const c = a + sides, d = b + sides;
        idx.push(a, c, b, b, c, d);
      }
    }
    base += rings.length * sides;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

export function createTrack(path, tower) {
  const group = new THREE.Group();
  const trackMat = new THREE.MeshStandardMaterial({ color: 0xc8361d, metalness: 0.55, roughness: 0.38 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xd9d9d4, metalness: 0.35, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.6, roughness: 0.5 });

  const tubes = sweepTubes(path, [
    { x: -GAUGE, y: 0, r: RAIL_R, sides: 6 },
    { x: GAUGE, y: 0, r: RAIL_R, sides: 6 },
    { x: 0, y: -SPINE_DROP, r: SPINE_R, sides: 8 },
  ]);
  const tubeMesh = new THREE.Mesh(tubes, trackMat);
  tubeMesh.frustumCulled = false;
  group.add(tubeMesh);

  // ---- cross ties every 1.6 m ----
  const tie = mergeBoxes([
    new THREE.BoxGeometry(GAUGE * 2 + 0.1, 0.1, 0.14).translate(0, -0.1, 0),
    new THREE.BoxGeometry(0.1, SPINE_DROP, 0.1).translate(-GAUGE + 0.12, -0.32, 0).rotateZ(-0.62),
    new THREE.BoxGeometry(0.1, SPINE_DROP, 0.1).translate(GAUGE - 0.12, -0.32, 0).rotateZ(0.62),
  ]);
  const TIE = 2.0;
  const tieCount = Math.floor(path.length / TIE);
  const ties = new THREE.InstancedMesh(tie, trackMat, tieCount);
  const P = new THREE.Vector3(), F = new THREE.Vector3(), U = new THREE.Vector3(), Rt = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < tieCount; i++) {
    path.sample(i * TIE, P, F, U);
    Rt.crossVectors(F, U);
    m4.makeBasis(Rt, U, F.clone().negate()).setPosition(P);
    ties.setMatrixAt(i, m4);
  }
  ties.frustumCulled = false;
  group.add(ties);

  // ---- lift: cable + catwalk rail along the climb ----
  const s0 = path.marks.liftStart, s1 = path.marks.liftEnd + 8;
  const liftPts = [];
  for (let s = s0; s <= s1; s += 2) {
    path.sample(s, P, F, U);
    liftPts.push(P.clone().addScaledVector(U, 0.05));
  }
  const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(liftPts), liftPts.length, 0.035, 5), dark);
  group.add(cable);

  // ---- supports ----
  const columns = [], brackets = [];
  const SUP = 13;
  const zoneTower = (s) => s > path.marks.liftVertical - 6 && s < path.marks.dropBottom;
  for (let s = 6; s < path.length; s += SUP) {
    path.sample(s, P, F, U);
    if (zoneTower(s)) continue;
    const zone = path.zoneAt(s);
    if (zone === ZONE.STATION) continue;
    // spine bottom
    const bottom = P.clone().addScaledVector(U, -SPINE_DROP - SPINE_R * 0.8);
    if (U.y < 0.25) continue; // nearly vertical sections are tower-mounted
    if (bottom.y < 1) continue;
    columns.push({ x: bottom.x, z: bottom.z, h: bottom.y, F: F.clone() });
  }
  // tower brackets on the vertical faces, every 8 m
  for (let s = path.marks.liftVertical - 4; s < path.marks.dropBottom + 10; s += 8) {
    path.sample(s, P, F, U);
    if (Math.abs(F.y) < 0.9) continue;
    const back = P.clone().addScaledVector(U, -SPINE_DROP);
    // facade is in the -U direction
    const faceZ = U.z > 0 ? tower.cz + tower.d / 2 : tower.cz - tower.d / 2;
    const len = Math.abs(back.z - faceZ);
    brackets.push({ x: back.x, y: back.y, z: (back.z + faceZ) / 2, len });
  }
  const colGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0);
  const colMesh = new THREE.InstancedMesh(colGeo, steel, columns.length);
  const footGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const footMesh = new THREE.InstancedMesh(footGeo, new THREE.MeshLambertMaterial({ color: 0x9a9890 }), columns.length);
  columns.forEach((c, i) => {
    const r = 0.32 + c.h * 0.006;
    m4.makeScale(r, c.h, r).setPosition(c.x, 0, c.z);
    colMesh.setMatrixAt(i, m4);
    m4.makeScale(r * 4, 0.6, r * 4).setPosition(c.x, 0, c.z);
    footMesh.setMatrixAt(i, m4);
  });
  colMesh.frustumCulled = footMesh.frustumCulled = false;
  group.add(colMesh, footMesh);

  const brGeo = mergeBoxes([
    new THREE.BoxGeometry(0.5, 0.5, 1).translate(0, 0, 0),
    new THREE.BoxGeometry(3.4, 0.25, 0.25).translate(0, 0, 0.5),
  ]);
  const brMesh = new THREE.InstancedMesh(brGeo, steel, brackets.length);
  brackets.forEach((b, i) => {
    m4.makeScale(1, 1, b.len).setPosition(b.x, b.y, b.z);
    brMesh.setMatrixAt(i, m4);
  });
  brMesh.frustumCulled = false;
  group.add(brMesh);

  // ---- roof trestle on top of the tower ----
  const trestle = [];
  for (let s = path.marks.liftEnd - 2; s < path.marks.dropVertical + 4; s += 4) {
    path.sample(s, P, F, U);
    const bottom = P.clone().addScaledVector(U, -SPINE_DROP - SPINE_R);
    const h = bottom.y - tower.h;
    if (h > 0.3) trestle.push({ x: bottom.x, z: bottom.z, h });
  }
  const trMesh = new THREE.InstancedMesh(footGeo, steel, trestle.length);
  trestle.forEach((t, i) => { m4.makeScale(0.6, t.h, 0.6).setPosition(t.x, tower.h, t.z); trMesh.setMatrixAt(i, m4); });
  group.add(trMesh);

  return group;
}

// ---------------------------------------------------------------------------
// The hero skyscraper: body is drawn by the city facade shader; this adds the
// podium, crown, parapet, mechanical penthouse, spire and aviation lights.
export function createTowerDetails(tower) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa4ab, metalness: 0.8, roughness: 0.3 });
  const concrete = new THREE.MeshLambertMaterial({ color: 0x77797c });
  const { cx, cz, w, d, h } = tower;
  // vertical fins on the two plain faces (east/west) for a sense of scale
  const fins = [];
  for (let x = -w / 2 + 4; x <= w / 2 - 4; x += 8) {
    if (Math.abs(cx + x - tower.trackX) < 6) continue;
    fins.push([cx + x, cz + d / 2 + 0.4], [cx + x, cz - d / 2 - 0.4]);
  }
  for (let z = -d / 2 + 4; z <= d / 2 - 4; z += 8) fins.push([cx + w / 2 + 0.4, cz + z, 1], [cx - w / 2 - 0.4, cz + z, 1]);
  const finGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const finMesh = new THREE.InstancedMesh(finGeo, metal, fins.length);
  const m4 = new THREE.Matrix4();
  fins.forEach((f, i) => {
    if (f[2]) m4.makeScale(0.9, h, 0.5); else m4.makeScale(0.5, h, 0.9);
    m4.setPosition(f[0], 0, f[1]);
    finMesh.setMatrixAt(i, m4);
  });
  g.add(finMesh);

  // mechanical floors bands every ~100 m
  for (let y = 100; y < h - 20; y += 100) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, 4, d + 1.2), concrete);
    band.position.set(cx, y, cz);
    g.add(band);
  }
  // podium
  const podium = new THREE.Mesh(new THREE.BoxGeometry(w + 30, 14, d + 24), new THREE.MeshLambertMaterial({ color: 0x8b8e90 }));
  podium.position.set(cx - 15, 7, cz);
  g.add(podium);
  const podGlass = new THREE.Mesh(new THREE.BoxGeometry(w + 30.4, 9, d + 24.4), new THREE.MeshStandardMaterial({ color: 0x1d2a33, metalness: 0.9, roughness: 0.1 }));
  podGlass.position.set(cx - 15, 6, cz);
  g.add(podGlass);
  // parapet
  const par = new THREE.MeshLambertMaterial({ color: 0x5c6166 });
  for (const [sx, sz, lw, ld] of [[0, d / 2, w, 0.6], [0, -d / 2, w, 0.6], [w / 2, 0, 0.6, d], [-w / 2, 0, 0.6, d]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(lw, 1.4, ld), par);
    p.position.set(cx + sx, h + 0.7, cz + sz);
    g.add(p);
  }
  // penthouse (kept away from the track)
  const ph = new THREE.Mesh(new THREE.BoxGeometry(22, 9, 26), concrete);
  ph.position.set(cx - 14, h + 4.5, cz);
  g.add(ph);
  // spire
  const spireH = 110;
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 2.4, spireH, 10), metal);
  spire.position.set(cx - 14, h + 9 + spireH / 2, cz);
  g.add(spire);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), lightMat);
  beacon.position.set(cx - 14, h + 9 + spireH + 0.5, cz);
  g.add(beacon);
  const cornerLights = [];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), lightMat);
    l.position.set(cx + sx * (w / 2 - 0.5), h + 1.8, cz + sz * (d / 2 - 0.5));
    g.add(l); cornerLights.push(l);
  }
  g.userData.update = (t) => {
    const on = (t % 1.6) < 0.25;
    lightMat.color.setHex(on ? 0xff2a1a : 0x3a0805);
  };
  return g;
}

// ---------------------------------------------------------------------------
export function createStation(path) {
  const g = new THREE.Group();
  const s0 = path.marks.stationStart, s1 = path.marks.stationEnd;
  const P0 = new THREE.Vector3(), P1 = new THREE.Vector3();
  path.sample(s0, P0); path.sample(s1, P1);
  const len = P0.distanceTo(P1) + 4;
  const cx = (P0.x + P1.x) / 2, cz = (P0.z + P1.z) / 2, y = P0.y;
  const concrete = new THREE.MeshLambertMaterial({ color: 0xa9a59c });
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x6d6a64 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.3, roughness: 0.6 });
  const yellow = new THREE.MeshLambertMaterial({ color: 0xe8c22a });
  // platforms on both sides
  for (const sx of [-1, 1]) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, len), deckMat);
    deck.position.set(cx + sx * 3.4, y - 0.15, cz);
    g.add(deck);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, len), yellow);
    edge.position.set(cx + sx * 1.55, y + 0.11, cz);
    g.add(edge);
    // railing
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len), roofMat);
    rail.position.set(cx + sx * 5.3, y + 1.0, cz);
    g.add(rail);
  }
  // structure under the station
  const base = new THREE.Mesh(new THREE.BoxGeometry(11, y - 0.4, len), concrete);
  base.position.set(cx, (y - 0.4) / 2, cz);
  g.add(base);
  // canopy
  const roof = new THREE.Mesh(new THREE.BoxGeometry(13, 0.4, len + 4), roofMat);
  roof.position.set(cx, y + 5.2, cz);
  g.add(roof);
  for (let z = -len / 2 + 2; z <= len / 2 - 2; z += 9) {
    for (const sx of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.2, 0.35), roofMat);
      c.position.set(cx + sx * 5.6, y + 2.6, cz + z);
      g.add(c);
    }
    // canopy lights
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 2.4), new THREE.MeshBasicMaterial({ color: 0xfff4dd }));
    lamp.position.set(cx, y + 4.95, cz + z);
    g.add(lamp);
  }
  // operator booth
  const booth = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 4), new THREE.MeshLambertMaterial({ color: 0xd8d4cc }));
  booth.position.set(cx + 4, y + 1.4, cz + len / 2 - 6);
  g.add(booth);
  const win = new THREE.Mesh(new THREE.BoxGeometry(3.05, 1.0, 3.2), new THREE.MeshStandardMaterial({ color: 0x18242c, metalness: 0.9, roughness: 0.05 }));
  win.position.set(cx + 4, y + 1.9, cz + len / 2 - 6);
  g.add(win);
  // sign
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 160;
  const c2 = cv.getContext('2d');
  c2.fillStyle = '#c8361d'; c2.fillRect(0, 0, 1024, 160);
  c2.fillStyle = '#fff'; c2.font = 'bold 96px Helvetica, Arial, sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
  c2.fillText('SKYFALL  TOWER  DROP', 512, 84);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.9), new THREE.MeshBasicMaterial({ map: tex }));
  sign.position.set(cx, y + 6.4, cz - len / 2 - 2);
  sign.rotation.y = Math.PI;
  g.add(sign);
  const sign2 = sign.clone(); sign2.rotation.y = 0; sign2.position.z = cz + len / 2 + 2; g.add(sign2);
  return { group: g, bounds: { x0: cx - 22, x1: cx + 22, z0: cz - len / 2 - 25, z1: cz + len / 2 + 25 } };
}
