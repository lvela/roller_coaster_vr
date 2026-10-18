// Fully procedural ride audio (no sound files): wind, wheel roar, rail joints,
// lift anti-rollback clicks, cable hum, magnetic brakes, city ambience.
import { ZONE } from './trackPath.js';

export class RideAudio {
  constructor() {
    this.ctx = null;
    this.lastClickS = 0;
    this.lastJointS = 0;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = this.master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    // shared noise buffers
    const len = ctx.sampleRate * 3;
    const white = ctx.createBuffer(2, len, ctx.sampleRate);
    const brown = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const w = white.getChannelData(ch), b = brown.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const r = Math.random() * 2 - 1;
        w[i] = r;
        last = (last + 0.02 * r) / 1.02;
        b[i] = last * 3.5;
      }
    }
    this.white = white;
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(ctx.currentTime + Math.random()); return s; };

    // wind: band-limited white noise, brighter and louder with speed
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.4;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    loop(white).connect(this.windFilter).connect(this.windGain).connect(master);

    // gusty high-altitude wind
    this.gustFilter = ctx.createBiquadFilter();
    this.gustFilter.type = 'bandpass'; this.gustFilter.frequency.value = 520; this.gustFilter.Q.value = 1.2;
    this.gustGain = ctx.createGain(); this.gustGain.gain.value = 0;
    loop(white).connect(this.gustFilter).connect(this.gustGain).connect(master);

    // wheel roar: brown noise lowpassed
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'lowpass'; this.roarFilter.frequency.value = 180;
    this.roarGain = ctx.createGain(); this.roarGain.gain.value = 0;
    loop(brown).connect(this.roarFilter).connect(this.roarGain).connect(master);

    // steel "singing" tone of polyurethane wheels on the rail
    this.tone = ctx.createOscillator(); this.tone.type = 'sawtooth'; this.tone.frequency.value = 60;
    this.toneFilter = ctx.createBiquadFilter(); this.toneFilter.type = 'bandpass'; this.toneFilter.Q.value = 6;
    this.toneGain = ctx.createGain(); this.toneGain.gain.value = 0;
    this.tone.connect(this.toneFilter).connect(this.toneGain).connect(master);
    this.tone.start();

    // cable lift hum
    this.cable = ctx.createOscillator(); this.cable.type = 'triangle'; this.cable.frequency.value = 47;
    this.cable2 = ctx.createOscillator(); this.cable2.type = 'sawtooth'; this.cable2.frequency.value = 94.5;
    this.cableFilter = ctx.createBiquadFilter(); this.cableFilter.type = 'lowpass'; this.cableFilter.frequency.value = 320;
    this.cableGain = ctx.createGain(); this.cableGain.gain.value = 0;
    this.cable.connect(this.cableFilter); this.cable2.connect(this.cableFilter);
    this.cableFilter.connect(this.cableGain).connect(master);
    this.cable.start(); this.cable2.start();

    // magnetic brakes: whooshy band noise
    this.brakeFilter = ctx.createBiquadFilter(); this.brakeFilter.type = 'bandpass'; this.brakeFilter.frequency.value = 900; this.brakeFilter.Q.value = 0.8;
    this.brakeGain = ctx.createGain(); this.brakeGain.gain.value = 0;
    loop(white).connect(this.brakeFilter).connect(this.brakeGain).connect(master);

    // city ambience (traffic rumble), fades with altitude
    this.cityFilter = ctx.createBiquadFilter(); this.cityFilter.type = 'lowpass'; this.cityFilter.frequency.value = 650;
    this.cityGain = ctx.createGain(); this.cityGain.gain.value = 0.05;
    loop(brown).connect(this.cityFilter).connect(this.cityGain).connect(master);
    this.nextHonk = ctx.currentTime + 6;
  }

  // short filtered noise burst
  burst(freq, q, gain, dur, when = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 2, dur + 0.05);
  }

  clunk() { // lap bar / harness lock and pneumatic release
    if (!this.ctx) return;
    this.burst(180, 2, 0.8, 0.18);
    this.burst(2400, 4, 0.25, 0.06, 0.02);
  }

  hiss() {
    if (!this.ctx) return;
    this.burst(5000, 0.7, 0.18, 0.9);
  }

  honk() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 380 + Math.random() * 120;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.02, t + 0.02);
    g.gain.setValueAtTime(0.02, t + 0.25); g.gain.linearRampToValueAtTime(0, t + 0.3);
    o.connect(f).connect(g).connect(this.master); o.start(t); o.stop(t + 0.35);
  }

  update(ride, height, dt) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const v = ride.v;
    const zone = ride.path.zoneAt(ride.s);
    const k = 0.08; // smoothing time constant
    const vn = Math.min(1, v / 80);
    this.windGain.gain.setTargetAtTime(0.02 + vn * vn * 1.1, t, k);
    this.windFilter.frequency.setTargetAtTime(250 + v * 45, t, k);
    const alt = Math.min(1, height / 450);
    const gust = 0.5 + 0.5 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1);
    this.gustGain.gain.setTargetAtTime(alt * (0.05 + 0.12 * gust), t, 0.3);
    this.gustFilter.frequency.setTargetAtTime(380 + 300 * gust, t, 0.3);

    const rolling = zone !== ZONE.LIFT && v > 0.5 ? 1 : 0.25;
    this.roarGain.gain.setTargetAtTime(Math.min(1.2, v / 40) * 0.9 * rolling, t, k);
    this.roarFilter.frequency.setTargetAtTime(120 + v * 6, t, k);
    this.tone.frequency.setTargetAtTime(30 + v * 2.2, t, k);
    this.toneFilter.frequency.setTargetAtTime(60 + v * 7, t, k);
    this.toneGain.gain.setTargetAtTime(Math.min(1, v / 50) * 0.05 * rolling, t, k);

    const onLift = zone === ZONE.LIFT && v > 0.5;
    this.cableGain.gain.setTargetAtTime(onLift ? 0.16 : 0, t, 0.25);
    this.cable.frequency.setTargetAtTime(40 + v * 1.2, t, 0.2);

    // anti-rollback clicks on the lift
    if (onLift && ride.s - this.lastClickS > 1.0) {
      this.lastClickS = ride.s;
      this.burst(2600 + Math.random() * 400, 9, 0.35, 0.05);
      this.burst(700, 3, 0.25, 0.04);
    } else if (!onLift) this.lastClickS = ride.s;

    // rail joints: periodic clack from every car's wheels
    const joint = 12;
    if (v > 1.5 && zone !== ZONE.LIFT && Math.floor(ride.s / joint) !== Math.floor(this.lastJointS / joint)) {
      const vol = Math.min(0.25, 0.04 + v * 0.003);
      for (let c = 0; c < ride.cars; c++) this.burst(240 + Math.random() * 60, 3, vol, 0.07, (c * ride.carSpacing) / Math.max(v, 1));
    }
    this.lastJointS = ride.s;

    // brakes
    const braking = (zone === ZONE.BRAKE || zone === ZONE.STATION || ride.state === 'holding') && ride.accel < -0.5;
    this.brakeGain.gain.setTargetAtTime(braking ? Math.min(0.5, -ride.accel * 0.06 + v * 0.01) : 0, t, 0.1);
    this.brakeFilter.frequency.setTargetAtTime(400 + v * 60, t, 0.1);

    // city
    this.cityGain.gain.setTargetAtTime(0.09 * (1 - alt) * (1 - alt) + 0.004, t, 0.5);
    if (t > this.nextHonk) {
      this.nextHonk = t + 4 + Math.random() * 12;
      if (height < 120) this.honk();
    }
  }
}
