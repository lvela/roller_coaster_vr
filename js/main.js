import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { buildTrackPath } from './trackPath.js';
import { program, pathOptions } from './layout.js';
import { Ride, simulateSpeedProfile } from './ride.js';
import { ATMOS, createSky } from './sky.js';
import { createCity } from './city.js';
import { createTrack, createTowerDetails, createStation } from './trackMesh.js';
import { createTrain, drawDash, RIDER_EYE } from './train.js';
import { RideAudio } from './audio.js';

const statusEl = document.getElementById('status');
const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
renderer.xr.setFoveation(0.6);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(ATMOS.horizon.clone().multiplyScalar(0.95), 0.00036);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 6000);

// ---------------------------------------------------------------- lighting
const sun = new THREE.DirectionalLight(ATMOS.sunColor, 2.6);
sun.position.copy(ATMOS.sunDir).multiplyScalar(1000);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x9fb8d8, 0x4a4238, 1.15));

const sky = createSky();
scene.add(sky);
{
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(createSky());
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4000, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4a4a48 }));
  ground.position.y = -40;
  envScene.add(ground);
  scene.environment = pm.fromScene(envScene, 0.02, 1, 5000).texture;
  scene.environmentIntensity = 0.8;
  pm.dispose();
}

// ---------------------------------------------------------------- world build
setStatus('Surveying the track…');
const path0 = buildTrackPath(program, pathOptions);
const speedAt = simulateSpeedProfile(path0);
const path = buildTrackPath(program, { ...pathOptions, speedAt });
const marks = path.marks;

const tmp = new THREE.Vector3();
path.sample((marks.liftVertical + marks.liftEnd) / 2, tmp);
const liftZ = tmp.z, trackX = tmp.x;
path.sample((marks.dropVertical + marks.dropBottom) / 2, tmp);
const dropZ = tmp.z;
path.sample(marks.roof + 20, tmp);
const FACE_GAP = 5.2;
const tower = {
  trackX,
  cx: trackX - 14,
  cz: (liftZ + dropZ) / 2,
  w: 64,
  d: Math.abs(liftZ - dropZ) - FACE_GAP * 2,
  h: tmp.y - 5.8,
};

setStatus('Building the city…');
const station = createStation(path);
scene.add(station.group);
const city = createCity(renderer, path, tower, station.bounds);
scene.add(city.group);
scene.add(createTrack(path, tower));
const towerDetails = createTowerDetails(tower);
scene.add(towerDetails);

// ---------------------------------------------------------------- train + rider
const ride = new Ride(path);
const cars = createTrain(ride.cars);
cars.forEach((c) => scene.add(c));
const dash = cars[0].userData.dash;

const rig = new THREE.Group();
rig.position.copy(RIDER_EYE);
cars[0].add(rig);
rig.add(camera);

// VR controllers live in the rig so they ride along
const controllerFactory = new XRControllerModelFactory();
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  c.addEventListener('selectstart', onTrigger);
  rig.add(c);
  const grip = renderer.xr.getControllerGrip(i);
  grip.add(controllerFactory.createControllerModel(grip));
  rig.add(grip);
}

// floating instruction panel in front of the rider
const panelCanvas = document.createElement('canvas');
panelCanvas.width = 1024; panelCanvas.height = 420;
const panelTex = new THREE.CanvasTexture(panelCanvas);
panelTex.colorSpace = THREE.SRGBColorSpace;
const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.615), new THREE.MeshBasicMaterial({ map: panelTex, transparent: true, toneMapped: false, depthTest: false }));
panel.renderOrder = 10;
panel.position.set(RIDER_EYE.x, RIDER_EYE.y + 0.15, -3.4);
cars[0].add(panel);

function drawPanel(lines) {
  const c = panelCanvas.getContext('2d');
  c.clearRect(0, 0, 1024, 420);
  c.fillStyle = 'rgba(8,12,18,0.78)';
  c.beginPath(); c.roundRect(8, 8, 1008, 404, 36); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 3; c.stroke();
  c.textAlign = 'center';
  c.fillStyle = '#ff7a4a';
  c.font = 'bold 64px Helvetica, Arial, sans-serif';
  c.fillText('SKYFALL TOWER DROP', 512, 100);
  c.fillStyle = '#ffffff';
  c.font = '40px Helvetica, Arial, sans-serif';
  lines.forEach((l, i) => c.fillText(l, 512, 185 + i * 62));
  panelTex.needsUpdate = true;
}
drawPanel(['Pull the TRIGGER to ride', '490 m up the tower, then straight down', 'Keep your arms inside the car!']);

// ---------------------------------------------------------------- audio
const audio = new RideAudio();

function onTrigger() {
  audio.start();
  if (ride.dispatch()) {
    audio.clunk();
    setTimeout(() => audio.hiss(), 600);
    panel.visible = false;
  }
}

// ---------------------------------------------------------------- desktop UI
const overlay = document.getElementById('overlay');
const vrButton = VRButton.createButton(renderer);
document.getElementById('vr-slot').appendChild(vrButton);
document.getElementById('desktop-btn').addEventListener('click', () => {
  overlay.classList.add('hidden');
  audio.start();
  onTrigger();
});
renderer.xr.addEventListener('sessionstart', () => {
  overlay.classList.add('hidden');
  audio.start();
});
renderer.xr.addEventListener('sessionend', () => overlay.classList.remove('hidden'));

// mouse look on desktop
let yaw = 0, pitch = 0, dragging = false, timeScale = 1;
renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; renderer.domElement.setPointerCapture(e.pointerId); });
renderer.domElement.addEventListener('pointerup', () => { dragging = false; });
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  yaw -= e.movementX * 0.004;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.004, -1.5, 1.5);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { overlay.classList.add('hidden'); onTrigger(); }
  if (e.code === 'KeyF') timeScale = 5;
});
window.addEventListener('keyup', (e) => { if (e.code === 'KeyF') timeScale = 1; });
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// debug: ?s=820 starts the train at that track position
const params = new URLSearchParams(location.search);
if (params.has('s')) {
  ride.s = parseFloat(params.get('s'));
  ride.state = 'running';
  ride.v = parseFloat(params.get('v') ?? '0');
  ride.held = ride.s > ride.holdS;
  panel.visible = false;
  overlay.classList.add('hidden');
}
if (params.has('yaw')) yaw = parseFloat(params.get('yaw'));
if (params.has('pitch')) pitch = parseFloat(params.get('pitch'));
if (params.has('pause')) timeScale = 0;
let freeCam = null;
if (params.has('cam')) {
  // debug: fixed external camera, e.g. ?cam=300,150,200&look=-100,250,-270
  const c = params.get('cam').split(',').map(Number), l = (params.get('look') ?? '-100,250,-270').split(',').map(Number);
  scene.add(camera);
  camera.position.set(...c);
  camera.lookAt(...l);
  freeCam = true;
}

// ---------------------------------------------------------------- per-frame
const P = new THREE.Vector3(), F = new THREE.Vector3(), U = new THREE.Vector3(), Rt = new THREE.Vector3();
const prevVel = new THREE.Vector3(), vel = new THREE.Vector3(), acc = new THREE.Vector3();
let gSmooth = 1, dashTimer = 0, prevState = ride.state, time = 0;
const clock = new THREE.Clock();

function placeTrain() {
  for (let i = 0; i < cars.length; i++) {
    path.sample(ride.s - i * ride.carSpacing, P, F, U);
    Rt.crossVectors(F, U);
    const m = cars[i].matrix;
    m.makeBasis(Rt, U, F.negate()).setPosition(P);
    cars[i].matrixWorldNeedsUpdate = true;
  }
}

function stateLabel() {
  switch (ride.state) {
    case 'loading': return 'READY — PULL TRIGGER';
    case 'dispatch': return 'DISPATCHED';
    case 'holding': return 'HOLD…';
    case 'returning': return 'WELCOME BACK';
    default: {
      const z = path.zoneAt(ride.s);
      return z === 2 ? 'CABLE LIFT' : z === 4 ? 'BRAKES' : z === 6 ? 'LAUNCH' : '';
    }
  }
}

function frame() {
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const dt = rawDt * timeScale;
  time += rawDt;

  // physics with fixed sub-steps
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  for (let i = 0; i < steps; i++) ride.step(dt / steps);

  placeTrain();

  // rider g-force (specific force along the track normal)
  path.sample(ride.s, P, F, U);
  vel.copy(F).multiplyScalar(ride.v);
  if (dt > 0) {
    acc.subVectors(vel, prevVel).divideScalar(dt);
    acc.y += 9.81;
    const g = acc.dot(U) / 9.81;
    if (Number.isFinite(g)) gSmooth += (THREE.MathUtils.clamp(g, -3, 7) - gSmooth) * Math.min(1, rawDt * 4);
  }
  prevVel.copy(vel);

  // speed-dependent vibration of the rider (wheels on steel)
  const shake = Math.min(1, ride.v / 70) * 0.004;
  rig.position.set(
    RIDER_EYE.x + (Math.random() - 0.5) * shake,
    RIDER_EYE.y + (Math.random() - 0.5) * shake,
    RIDER_EYE.z,
  );

  if (!renderer.xr.isPresenting && !freeCam) camera.rotation.set(pitch, yaw, 0, 'YXZ');

  dashTimer -= rawDt;
  if (dashTimer <= 0) {
    dashTimer = 0.1;
    drawDash(dash, ride.v * 3.6, P.y, gSmooth, stateLabel());
  }

  if (prevState !== ride.state) {
    if (ride.state === 'loading') {
      panel.visible = true;
      drawPanel([`Top speed: ${Math.round(ride.maxSpeed * 3.6)} km/h`, `Ride time: ${Math.floor(ride.lapTime / 60)}:${String(Math.floor(ride.lapTime % 60)).padStart(2, '0')}`, 'Pull the TRIGGER to ride again']);
      audio.clunk();
    }
    if (ride.state === 'holding') audio.clunk();
    prevState = ride.state;
  }

  audio.update(ride, P.y, rawDt);
  city.traffic.update(rawDt);
  towerDetails.userData.update(time);
  sky.material.uniforms.uTime.value = time;
  camera.getWorldPosition(sky.position);

  renderer.render(scene, camera);
}

setStatus('');
document.getElementById('desktop-btn').disabled = false;
renderer.setAnimationLoop(frame);
