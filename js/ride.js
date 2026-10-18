// Train dynamics along the track: gravity (averaged over all cars), aerodynamic
// drag, rolling resistance, plus the powered/braked zones of the ride.
import { ZONE } from './trackPath.js';

const G = 9.81;

function approach(v, target, maxDelta) {
  if (v < target) return Math.min(target, v + maxDelta);
  return Math.max(target, v - maxDelta);
}

export class Ride {
  constructor(path, cfg = {}) {
    this.path = path;
    this.cars = cfg.cars ?? 4;
    this.carSpacing = cfg.carSpacing ?? 3.1;
    this.liftSpeed = cfg.liftSpeed ?? 11;
    this.roofSpeed = cfg.roofSpeed ?? 2.4;
    this.holdTime = cfg.holdTime ?? 4.5;
    this.drag = cfg.drag ?? 0.00068;     // 1/m  -> terminal velocity ~ 120 m/s
    this.rolling = cfg.rolling ?? 0.009;
    this.brakeSpeed = cfg.brakeSpeed ?? 6;
    this.stopS = path.marks.stationStart + 44;
    this.holdS = path.marks.hold;
    this.stationEnd = path.marks.stationEnd;
    this.reset();
    this._f = [0, 0, 0];
  }

  reset() {
    this.s = this.stopS;
    this.v = 0;
    this.accel = 0;
    this.state = 'loading';   // loading | dispatch | running | holding | returning
    this.holdTimer = 0;
    this.held = false;
    this.lapTime = 0;
    this.maxSpeed = 0;
  }

  dispatch() {
    if (this.state !== 'loading') return false;
    this.state = 'dispatch';
    this.held = false;
    this.lapTime = 0;
    this.maxSpeed = 0;
    return true;
  }

  // average forward.y over all cars (gravity pulls on the whole train)
  gradeAvg() {
    let sum = 0;
    for (let i = 0; i < this.cars; i++) {
      this.path.sample(this.s - i * this.carSpacing, null, this._f, null);
      sum += this._f[1];
    }
    return sum / this.cars;
  }

  step(dt) {
    const p = this.path;
    const v0 = this.v;
    const zone = p.zoneAt(this.s);
    let v = this.v;

    if (this.state !== 'loading') this.lapTime += dt;

    // natural dynamics
    const grade = this.gradeAvg();
    let a = -G * grade - this.drag * v * v - (v > 0.05 ? this.rolling * G : 0);
    let vn = v + a * dt;

    switch (this.state) {
      case 'loading':
        vn = 0;
        break;
      case 'dispatch':
        vn = approach(v, 4, 1.2 * dt);
        if (this.s > this.stationEnd && this.s < this.stationEnd + 50) this.state = 'running';
        break;
      case 'holding':
        vn = 0;
        this.holdTimer -= dt;
        if (this.holdTimer <= 0) { this.state = 'running'; this.held = true; }
        break;
      case 'returning': {
        // station brakes: creep to the stop mark
        const dist = this.stopS - this.s;
        const target = dist > 0 ? Math.min(3, Math.sqrt(2 * 1.2 * dist)) : 0;
        vn = approach(v, target, 2.5 * dt);
        if (dist < 0.05 && vn < 0.4) {
          vn = 0; this.s = this.stopS; this.state = 'loading';
        }
        break;
      }
      case 'running':
        if (zone === ZONE.LIFT) {
          vn = approach(v, this.liftSpeed, 1.8 * dt);
        } else if (zone === ZONE.ROOF) {
          vn = approach(v, this.roofSpeed, 1.5 * dt);
          if (!this.held) {
            const dist = this.holdS - this.s;
            const brakeDist = (v * v) / (2 * 1.6) + 0.05;
            if (dist <= brakeDist) {
              vn = Math.max(0, v - 1.6 * dt);
              if (vn < 0.08 || dist <= 0.02) { vn = 0; this.state = 'holding'; this.holdTimer = this.holdTime; }
            }
          }
        } else if (zone === ZONE.BOOST) {
          if (vn < 19) vn = Math.min(19, v + 3.5 * dt); // linear synchronous motor booster
        } else if (zone === ZONE.DRIVE) {
          vn = approach(v, 5, 1.5 * dt);
        } else if (zone === ZONE.BRAKE) {
          vn = v > this.brakeSpeed ? approach(v, this.brakeSpeed, 5 * dt) : approach(v, this.brakeSpeed, 1.5 * dt);
        } else if (zone === ZONE.STATION) {
          this.state = 'returning';
          vn = approach(v, 3, 2.5 * dt);
        } else {
          vn = Math.max(vn, 1.5); // hidden booster tires keep the train from ever stalling
        }
        break;
    }

    this.v = Math.max(0, vn);
    this.s = p.wrap(this.s + (v0 + this.v) * 0.5 * dt);
    this.accel = (this.v - v0) / Math.max(dt, 1e-6);
    if (this.v > this.maxSpeed) this.maxSpeed = this.v;
  }
}

// Runs one full lap headless and returns speed (m/s) as a function of s.
// Used to compute heart-line banking for the real track.
export function simulateSpeedProfile(path, cfg) {
  const ride = new Ride(path, cfg);
  const bins = new Float32Array(Math.ceil(path.length) + 1);
  ride.dispatch();
  const dt = 1 / 60;
  for (let t = 0; t < 900; t += dt) {
    ride.step(dt);
    const i = Math.floor(ride.s);
    bins[i] = Math.max(bins[i], ride.v);
    if (ride.state === 'loading') break;
  }
  // fill gaps (fast sections skip bins)
  let last = 0;
  for (let i = 0; i < bins.length; i++) { if (bins[i] > 0) last = bins[i]; else bins[i] = last; }
  return (s) => bins[Math.min(bins.length - 1, Math.max(0, Math.floor(s)))];
}
