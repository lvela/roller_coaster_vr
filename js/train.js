import * as THREE from 'three';

// Car-local frame: x = right, y = up (track normal), -z = forward.
export const SEAT_X = [-0.93, -0.31, 0.31, 0.93];
export const ROW_Z = [-0.7, 0.62];
export const RIDER_EYE = new THREE.Vector3(-0.31, 1.52, -0.66);

function nosePlate(width, mat) {
  // side profile in (z, y) extruded across x
  const s = new THREE.Shape();
  s.moveTo(-1.35, 0.42);
  s.lineTo(-2.2, 0.42);
  s.quadraticCurveTo(-2.4, 0.46, -2.35, 0.6);
  s.lineTo(-1.8, 0.86);
  s.quadraticCurveTo(-1.55, 0.92, -1.35, 0.92);
  s.lineTo(-1.35, 0.42);
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 8 });
  // shape is in XY; map shape.x -> z, shape.y -> y, extrusion -> x
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2, 0, 0);
  return new THREE.Mesh(g, mat);
}

function lapBar(x, z, mat) {
  const pts = [
    new THREE.Vector3(x - 0.2, 0.55, z - 0.42),
    new THREE.Vector3(x - 0.2, 0.92, z - 0.36),
    new THREE.Vector3(x - 0.12, 1.0, z - 0.3),
    new THREE.Vector3(x + 0.12, 1.0, z - 0.3),
    new THREE.Vector3(x + 0.2, 0.92, z - 0.36),
    new THREE.Vector3(x + 0.2, 0.55, z - 0.42),
  ];
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.035, 8), mat);
}

export function createCar(isFront, mats) {
  const car = new THREE.Group();
  const W = 2.7;
  // chassis + bogies
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 2.7), mats.chassis);
  chassis.position.set(0, 0.3, 0);
  car.add(chassis);
  const wheelGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.12, 14).rotateZ(Math.PI / 2);
  for (const z of [-1.0, 1.0]) {
    for (const sx of [-1, 1]) {
      const bog = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.5, 0.75), mats.chassis);
      bog.position.set(sx * 0.62, 0.02, z);
      car.add(bog);
      for (const dz of [-0.22, 0.22]) {
        const w = new THREE.Mesh(wheelGeo, mats.wheel);
        w.position.set(sx * 0.62, 0.22, z + dz); // road wheel on top of the rail
        car.add(w);
        const uw = new THREE.Mesh(wheelGeo, mats.wheel);
        uw.position.set(sx * 0.62, -0.22, z + dz); // upstop wheel under the rail
        car.add(uw);
      }
      const gw = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 12), mats.wheel);
      gw.position.set(sx * 0.82, 0.0, z); // side guide wheel
      car.add(gw);
    }
  }
  // floor tub
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.14, 2.75), mats.body);
  floor.position.set(0, 0.48, 0);
  car.add(floor);
  // side walls
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 2.75), mats.body);
    side.position.set(sx * (W / 2 - 0.05), 0.78, 0);
    car.add(side);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 2.8), mats.trim);
    trim.position.set(sx * (W / 2 - 0.05), 1.07, 0);
    car.add(trim);
  }
  // seats
  for (const z of ROW_Z) {
    // divider in front of the row (back of previous row / nose)
    for (const x of SEAT_X) {
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.46), mats.seat);
      cushion.position.set(x, 0.74, z);
      car.add(cushion);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.82, 0.1), mats.seat);
      back.position.set(x, 1.15, z + 0.27);
      back.rotation.x = -0.12;
      car.add(back);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.16), mats.seat);
      head.position.set(x, 1.68, z + 0.33);
      car.add(head);
      for (const sx of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.35), mats.seat);
        wing.position.set(x + sx * 0.25, 1.0, z + 0.12);
        car.add(wing);
      }
      car.add(lapBar(x, z, mats.bar));
      // footwell plate
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.04, 0.3), mats.chassis);
      foot.position.set(x, 0.57, z - 0.5);
      car.add(foot);
    }
  }
  if (isFront) {
    const nose = nosePlate(W, mats.body);
    car.add(nose);
    // dashboard display facing the riders
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 192;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.23), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    screen.position.set(-0.31, 1.03, -1.48);
    screen.rotation.x = -0.9;
    car.add(screen);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.04), mats.chassis);
    bezel.position.set(-0.31, 1.01, -1.496);
    bezel.rotation.x = -0.9;
    car.add(bezel);
    car.userData.dash = { canvas: cv, tex, ctx: cv.getContext('2d') };
    // headlight strip
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff1d0 }));
    strip.position.set(0, 0.62, -2.38);
    car.add(strip);
  } else {
    const front = new THREE.Mesh(new THREE.BoxGeometry(W, 0.6, 0.1), mats.body);
    front.position.set(0, 0.8, -1.38);
    car.add(front);
  }
  // rear panel + hitch
  const rear = new THREE.Mesh(new THREE.BoxGeometry(W, 0.66, 0.1), mats.body);
  rear.position.set(0, 0.78, 1.38);
  car.add(rear);
  const hitch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), mats.chassis);
  hitch.position.set(0, 0.3, 1.5);
  car.add(hitch);
  car.matrixAutoUpdate = false;
  return car;
}

export function createTrain(count) {
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: 0x1d4fa3, metalness: 0.35, roughness: 0.22 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.9, roughness: 0.2 }),
    chassis: new THREE.MeshStandardMaterial({ color: 0x2a2b2e, metalness: 0.6, roughness: 0.5 }),
    wheel: new THREE.MeshStandardMaterial({ color: 0x151515, metalness: 0.1, roughness: 0.8 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x18191b, metalness: 0.0, roughness: 0.65 }),
    bar: new THREE.MeshStandardMaterial({ color: 0xe0b51c, metalness: 0.3, roughness: 0.35 }),
  };
  const cars = [];
  for (let i = 0; i < count; i++) cars.push(createCar(i === 0, mats));
  return cars;
}

export function drawDash(dash, speedKmh, altitude, gForce, label) {
  const c = dash.ctx, W = 512, H = 192;
  c.fillStyle = '#05080a';
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#5ef2ff';
  c.font = 'bold 26px Helvetica, Arial, sans-serif';
  c.textBaseline = 'top';
  c.fillText('SPEED', 22, 16);
  c.fillText('HEIGHT', 200, 16);
  c.fillText('G', 400, 16);
  c.fillStyle = '#ffffff';
  c.font = 'bold 74px Helvetica, Arial, sans-serif';
  c.fillText(String(Math.round(speedKmh)), 18, 48);
  c.fillText(String(Math.round(altitude)), 196, 48);
  c.fillText(gForce.toFixed(1), 380, 48);
  c.font = '22px Helvetica, Arial, sans-serif';
  c.fillStyle = '#8fb3bf';
  c.fillText('km/h', 22, 126);
  c.fillText('m', 200, 126);
  c.fillStyle = '#ffcf4a';
  c.font = 'bold 24px Helvetica, Arial, sans-serif';
  c.fillText(label, 22, 156);
  dash.tex.needsUpdate = true;
}
