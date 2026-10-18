// Pure-math track builder (no three.js dependency so it can be tested headless).
//
// The track is described as a "turtle" program: straights, horizontal turns and
// vertical pitch changes. The program is expanded into curvature samples, the
// curvature is smoothed (so every transition eases in like a real clothoid),
// integrated into positions, and finally closed back onto the station with a
// Hermite curve. Output is a dense, uniformly spaced array of positions and
// orientation frames (forward + banked up).

const DEG = Math.PI / 180;

export const ZONE = { FREE: 0, STATION: 1, LIFT: 2, ROOF: 3, BRAKE: 4, DRIVE: 5, BOOST: 6 };

function boxFilter(src, radius) {
  const n = src.length;
  const out = new Float64Array(n);
  if (radius < 1) { out.set(src); return out; }
  let acc = 0;
  const w = radius * 2 + 1;
  // clamp-at-edges running mean
  const at = (i) => src[Math.min(n - 1, Math.max(0, i))];
  for (let i = -radius; i <= radius; i++) acc += at(i);
  for (let i = 0; i < n; i++) {
    out[i] = acc / w;
    acc += at(i + radius + 1) - at(i - radius);
  }
  return out;
}

function fwd(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

function upv(yaw, pitch) {
  const sp = Math.sin(pitch);
  return [Math.sin(yaw) * sp, Math.cos(pitch), Math.cos(yaw) * sp];
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function buildTrackPath(program, opts = {}) {
  const ds = opts.ds ?? 0.5;
  const curveSmooth = Math.round((opts.curveSmooth ?? 9) / ds);
  const bankSmooth = Math.round((opts.bankSmooth ?? 16) / ds);
  const start = opts.start ?? [0, 0, 0];
  const startYaw = (opts.startYaw ?? 0) * DEG;

  // ---- 1. expand the program into per-step curvature / bank / zone ----
  const kYaw = [], kPitch = [], bank = [], zone = [];
  const marks = {};
  let nominalPitch = 0;
  let curZone = ZONE.FREE;
  const push = (n, ky, kp, b, z) => {
    for (let i = 0; i < n; i++) { kYaw.push(ky); kPitch.push(kp); bank.push(b); zone.push(z); }
  };
  for (const seg of program) {
    if (seg.zone !== undefined) curZone = seg.zone;
    const segBank = (seg.bank ?? 0) * DEG;
    switch (seg.type) {
      case 'mark':
        marks[seg.name] = kYaw.length * ds;
        break;
      case 'straight':
        push(Math.round(seg.len / ds), 0, 0, segBank, curZone);
        break;
      case 'turn': {
        const ang = seg.deg * DEG;
        const len = Math.abs(ang) * seg.r;
        const n = Math.max(1, Math.round(len / ds));
        const b = (seg.bank ?? 0) * DEG * Math.sign(ang);
        push(n, ang / (n * ds), 0, b, curZone);
        break;
      }
      case 'pitch': {
        const target = seg.to * DEG;
        const ang = target - nominalPitch;
        const len = Math.abs(ang) * seg.r;
        const n = Math.max(1, Math.round(len / ds));
        push(n, 0, ang / (n * ds), segBank, curZone);
        nominalPitch = target;
        break;
      }
    }
  }

  let pitchAcc = null;
  const nominalPitchAt = (i) => {
    if (!pitchAcc) {
      pitchAcc = new Float64Array(kPitch.length);
      let a = 0;
      for (let k = 0; k < kPitch.length; k++) { pitchAcc[k] = a; a += sp[k] * ds; }
    }
    return pitchAcc[i];
  };

  // ---- 2. smooth curvature (two box passes ~ triangle) and bank ----
  let sy = boxFilter(boxFilter(Float64Array.from(kYaw), curveSmooth), curveSmooth);
  let sp = boxFilter(boxFilter(Float64Array.from(kPitch), curveSmooth), curveSmooth);
  // Auto heart-line banking: if a speed profile (m/s per sample) is supplied the
  // bank is the angle that cancels lateral g in horizontal curves.
  if (opts.speedAt) {
    const maxBank = (opts.maxBank ?? 80) * DEG;
    const factor = opts.bankFactor ?? 0.92;
    for (let i = 0; i < bank.length; i++) {
      const v = opts.speedAt(i * ds);
      const cp = Math.cos(nominalPitchAt(i));
      const b = Math.atan((v * v * sy[i] * cp) / 9.81) * factor;
      bank[i] = Math.max(-maxBank, Math.min(maxBank, b));
    }
  }
  let sb = boxFilter(boxFilter(Float64Array.from(bank), bankSmooth), bankSmooth);

  // ---- 3. integrate ----
  const P = [], F = [], U = [], Z = [], B = [];
  let yaw = startYaw, pitch = 0;
  let p = start.slice();
  const n0 = sy.length;
  for (let i = 0; i < n0; i++) {
    P.push(p.slice());
    F.push(fwd(yaw, pitch));
    U.push(upv(yaw, pitch));
    B.push(sb[i]);
    Z.push(zone[i]);
    const y2 = yaw + sy[i] * ds * 0.5, p2 = pitch + sp[i] * ds * 0.5;
    const f = fwd(y2, p2);
    p = [p[0] + f[0] * ds, p[1] + f[1] * ds, p[2] + f[2] * ds];
    yaw += sy[i] * ds;
    pitch += sp[i] * ds;
  }

  // ---- 4. close the loop with a Hermite curve back to sample 0 ----
  const pe = p, fe = fwd(yaw, pitch);
  const p0 = P[0], f0 = F[0];
  const chord = Math.hypot(p0[0] - pe[0], p0[1] - pe[1], p0[2] - pe[2]);
  const closureInfo = { chord, endPos: pe, endYawDeg: yaw / DEG, endPitchDeg: pitch / DEG };
  if (chord > ds * 1.5) {
    const m = chord * (opts.closureTension ?? 1.0);
    const herm = (t) => {
      const t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      return [0, 1, 2].map((k) => h00 * pe[k] + h10 * m * fe[k] + h01 * p0[k] + h11 * m * f0[k]);
    };
    // dense sample for arc length
    const fine = 4000;
    const pts = [], acc = [0];
    for (let i = 0; i <= fine; i++) pts.push(herm(i / fine));
    for (let i = 1; i <= fine; i++) {
      const a = pts[i - 1], b = pts[i];
      acc.push(acc[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    const total = acc[fine];
    const count = Math.max(1, Math.round(total / ds));
    const step = total / count;
    let j = 0;
    const bEnd = B[B.length - 1];
    for (let c = 0; c < count; c++) {
      const target = c * step;
      while (j < fine - 1 && acc[j + 1] < target) j++;
      const t = (target - acc[j]) / Math.max(1e-9, acc[j + 1] - acc[j]);
      const a = pts[j], b = pts[j + 1];
      const pos = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const f = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      // unbanked up = world up projected onto the plane normal to f
      const d = f[1];
      const u = norm([-d * f[0], 1 - d * f[1], -d * f[2]]);
      P.push(pos); F.push(f); U.push(u);
      const frac = c / count;
      B.push(bEnd * (1 - frac) + B[0] * frac);
      Z.push(opts.closureZone ?? Z[Z.length - 1]);
    }
  }

  // ---- 5. apply bank, pack into typed arrays ----
  const N = P.length;
  const pos = new Float32Array(N * 3), fw = new Float32Array(N * 3), up = new Float32Array(N * 3);
  const zones = new Uint8Array(N);
  const banks = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const f = F[i], u0 = U[i];
    const r = cross(f, u0);
    const b = B[i];
    // positive bank rolls the rider to the left (toward the inside of a left turn)
    let u = [u0[0] * Math.cos(b) - r[0] * Math.sin(b), u0[1] * Math.cos(b) - r[1] * Math.sin(b), u0[2] * Math.cos(b) - r[2] * Math.sin(b)];
    const d = dot(u, f);
    u = norm([u[0] - f[0] * d, u[1] - f[1] * d, u[2] - f[2] * d]);
    pos.set(P[i], i * 3); fw.set(f, i * 3); up.set(u, i * 3);
    zones[i] = Z[i];
    banks[i] = b;
  }
  return new TrackPath(pos, fw, up, zones, banks, ds, marks, closureInfo);
}

export class TrackPath {
  constructor(pos, fw, up, zones, banks, ds, marks, closureInfo) {
    this.pos = pos; this.fw = fw; this.up = up; this.zones = zones; this.banks = banks;
    this.ds = ds; this.marks = marks; this.closureInfo = closureInfo;
    this.count = zones.length;
    this.length = this.count * ds;
  }

  wrap(s) {
    const L = this.length;
    s %= L;
    return s < 0 ? s + L : s;
  }

  zoneAt(s) {
    return this.zones[Math.floor(this.wrap(s) / this.ds) % this.count];
  }

  // Writes position, forward and up into the provided 3-arrays (or Vector3-likes via .set)
  sample(s, outP, outF, outU) {
    s = this.wrap(s);
    const ds = this.ds, N = this.count;
    const fi = s / ds;
    const i = Math.floor(fi) % N, j = (i + 1) % N;
    const t = fi - Math.floor(fi);
    const P = this.pos, F = this.fw, U = this.up;
    const i3 = i * 3, j3 = j * 3;
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = (t3 - 2 * t2 + t) * ds, h01 = -2 * t3 + 3 * t2, h11 = (t3 - t2) * ds;
    const px = h00 * P[i3] + h10 * F[i3] + h01 * P[j3] + h11 * F[j3];
    const py = h00 * P[i3 + 1] + h10 * F[i3 + 1] + h01 * P[j3 + 1] + h11 * F[j3 + 1];
    const pz = h00 * P[i3 + 2] + h10 * F[i3 + 2] + h01 * P[j3 + 2] + h11 * F[j3 + 2];
    let fx = F[i3] + (F[j3] - F[i3]) * t, fy = F[i3 + 1] + (F[j3 + 1] - F[i3 + 1]) * t, fz = F[i3 + 2] + (F[j3 + 2] - F[i3 + 2]) * t;
    let fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let ux = U[i3] + (U[j3] - U[i3]) * t, uy = U[i3 + 1] + (U[j3 + 1] - U[i3 + 1]) * t, uz = U[i3 + 2] + (U[j3 + 2] - U[i3 + 2]) * t;
    const d = ux * fx + uy * fy + uz * fz;
    ux -= fx * d; uy -= fy * d; uz -= fz * d;
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    if (outP) setv(outP, px, py, pz);
    if (outF) setv(outF, fx, fy, fz);
    if (outU) setv(outU, ux, uy, uz);
  }
}

function setv(o, x, y, z) {
  if (o.set && o.isVector3) o.set(x, y, z);
  else { o[0] = x; o[1] = y; o[2] = z; }
}
