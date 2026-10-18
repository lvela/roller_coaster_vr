// The ride itself, written as a turtle program. Headings: yaw 0 = north (-z),
// positive turns are to the left. Pitch is in degrees above horizontal.
// Banking is computed automatically from the simulated speed (heart-line banking).
import { ZONE } from './trackPath.js';

export const STATION_Y = 9;      // rail height in the (elevated) station
export const LIFT_HEIGHT = 433;  // vertical cable lift straight up the tower face
export const DROP_LENGTH = 266;  // vertical part of the drop

export const program = [
  { type: 'mark', name: 'stationStart' },
  { type: 'straight', len: 58, zone: ZONE.STATION },
  { type: 'mark', name: 'stationEnd' },
  { type: 'straight', len: 12, zone: ZONE.DRIVE },
  { type: 'turn', deg: 90, r: 30 },
  { type: 'straight', len: 25 },
  { type: 'turn', deg: -90, r: 30 },
  { type: 'straight', len: 60 },

  // ---- the cable lift straight up the south face of the tower ----
  { type: 'mark', name: 'liftStart' },
  { type: 'pitch', to: 90, r: 42, zone: ZONE.LIFT },
  { type: 'mark', name: 'liftVertical' },
  { type: 'straight', len: LIFT_HEIGHT },
  { type: 'mark', name: 'liftEnd' },

  // ---- crest over the roof, creep to the edge, hold, then the drop ----
  { type: 'pitch', to: 0, r: 14, zone: ZONE.ROOF },
  { type: 'mark', name: 'roof' },
  { type: 'straight', len: 40 },
  { type: 'pitch', to: -48, r: 14 },
  { type: 'mark', name: 'hold' },
  { type: 'pitch', to: -90, r: 14, zone: ZONE.FREE },
  { type: 'mark', name: 'dropVertical' },
  { type: 'straight', len: DROP_LENGTH },
  { type: 'mark', name: 'dropBottom' },
  { type: 'pitch', to: 0, r: 205 },
  { type: 'mark', name: 'pullout' },

  // ---- high speed run through downtown ----
  { type: 'straight', len: 120 },
  // camelback airtime hill
  { type: 'pitch', to: 30, r: 260 },
  { type: 'straight', len: 30 },
  { type: 'pitch', to: -30, r: 330 },
  { type: 'mark', name: 'hill1' },
  { type: 'straight', len: 30 },
  { type: 'pitch', to: 0, r: 260 },
  { type: 'straight', len: 80 },

  // huge banked 180 degree right turn
  { type: 'turn', deg: -180, r: 150 },
  { type: 'straight', len: 160 },

  // second hill
  { type: 'pitch', to: 16, r: 200 },
  { type: 'straight', len: 15 },
  { type: 'pitch', to: -16, r: 170 },
  { type: 'mark', name: 'hill2' },
  { type: 'straight', len: 15 },
  { type: 'pitch', to: 0, r: 200 },
  { type: 'straight', len: 60 },

  // snaking S-bends between the towers
  { type: 'turn', deg: 65, r: 75 },
  { type: 'straight', len: 20 },
  { type: 'turn', deg: -130, r: 75 },
  { type: 'straight', len: 20 },
  { type: 'turn', deg: 65, r: 75 },
  { type: 'mark', name: 'helixEnd' },
  { type: 'straight', len: 60 },
  { type: 'mark', name: 'southRun' },
  { type: 'straight', len: 140 },
  { type: 'mark', name: 'booster' },
  { type: 'straight', len: 120, zone: ZONE.BOOST },
  { type: 'straight', len: 430, zone: ZONE.FREE },

  // swing back around toward the station
  { type: 'turn', deg: -180, r: 107 },
  { type: 'straight', len: 10 },

  // ---- final brakes & return to the station ----
  { type: 'mark', name: 'brakeStart' },
  { type: 'straight', len: 90, zone: ZONE.BRAKE },
];

export const pathOptions = {
  ds: 0.5,
  curveSmooth: 9,
  bankSmooth: 14,
  start: [0, STATION_Y, 0],
  startYaw: 0,
  closureZone: ZONE.BRAKE,
  closureTension: 1.0,
};
