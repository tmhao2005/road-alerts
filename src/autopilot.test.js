import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAutopilot } from './autopilot.js';
import { metres } from './geo.js';

// An L: north for ~1.1 km, then east. A light halfway up, facing northbound traffic.
const LON = 106.7, LAT = 10.7;
const up = { id: 1, highway: 'primary', name: 'Main', c: [[LON, LAT], [LON, LAT + 0.005], [LON, LAT + 0.01]], sg: [[1, 1, 50, 0]] };
const across = { id: 2, highway: 'primary', name: 'Cross', c: [[LON, LAT + 0.01], [LON + 0.01, LAT + 0.01]] };
const getPieces = () => [up, across];

test('it drives along the road at about its cruising speed', () => {
  const step = makeAutopilot({ getPieces, start: [LON, LAT + 0.0001], heading: 0, kmh: 36, noise: 0, stopShare: 0 });
  let f;
  for (let t = 0; t < 30; t++) f = step(1);
  assert.ok(Math.abs(f.speed - 10) < 1);
  assert.ok(Math.abs(f.lon - LON) < 1e-6, 'still on the road');
  assert.ok(f.lat > LAT + 0.002);
});

test('it turns where the road ends', () => {
  const step = makeAutopilot({ getPieces, start: [LON, LAT + 0.009], heading: 0, kmh: 36, noise: 0 });
  let f;
  for (let t = 0; t < 20; t++) f = step(1);
  assert.ok(f.lon > LON + 0.0003, 'went east');
  assert.ok(Math.abs(f.heading - 90) < 5);
});

test('when it stops for a light it stands short of it, then goes on', () => {
  const step = makeAutopilot({ getPieces, start: [LON, LAT + 0.0001], heading: 0, kmh: 36, noise: 0, stopShare: 1, wait: 8 });
  const fixes = [];
  for (let t = 0; t < 120; t++) fixes.push(step(1));
  const stopped = fixes.filter((f) => f.speed < 1 && f.lat > LAT + 0.004 && f.lat < LAT + 0.006);
  assert.ok(stopped.length >= 6, `${stopped.length} s stopped`);
  const light = [LON, LAT + 0.005];
  assert.ok(stopped.every((f) => { const d = metres([f.lon, f.lat], light); return d > 1 && d < 10; }));
  assert.ok(fixes[fixes.length - 1].lat > LAT + 0.008, 'carried on afterwards');
});

// A side street leaving Main halfway up, eastward: a junction the wandering car drives
// straight through.
const side = { id: 3, highway: 'residential', name: 'Side', c: [[LON, LAT + 0.005], [LON + 0.004, LAT + 0.005]] };

test('given a route, it turns off where the route does, not only where the road ends', () => {
  const route = [[LON, LAT], [LON, LAT + 0.005], [LON + 0.004, LAT + 0.005]];
  const step = makeAutopilot({ getPieces: () => [up, across, side], route, kmh: 36, noise: 0, stopShare: 0 });
  let f, east = false;
  for (let t = 0; t < 120; t++) { f = step(1); if (f.lon > LON + 0.001) east = true; }
  assert.ok(east, 'took the side street');
  assert.ok(f.lat < LAT + 0.0051, 'never went on up Main');
});

test('at the end of its route it slows to a stop there and stays', () => {
  const route = [[LON, LAT], [LON, LAT + 0.005], [LON + 0.004, LAT + 0.005]];
  const step = makeAutopilot({ getPieces: () => [up, across, side], route, kmh: 36, noise: 0, stopShare: 0 });
  let f;
  for (let t = 0; t < 150; t++) f = step(1);
  assert.ok(f.speed < 0.5, `${f.speed}`);
  assert.ok(metres([f.lon, f.lat], route[2]) < 3, `${metres([f.lon, f.lat], route[2]).toFixed(1)} m from the end`);
  assert.ok(Math.abs(f.lon - step(1).lon) < 1e-7, 'parked');
});

test('it does not stop for a light on a road the route leaves before reaching it', () => {
  // Main has a light 6 m past the vertex where the route turns off onto Early.
  const early = { id: 4, highway: 'residential', name: 'Early', c: [[LON, LAT + 0.002], [LON + 0.004, LAT + 0.002]] };
  const main = { ...up, c: [[LON, LAT], [LON, LAT + 0.002], [LON, LAT + 0.002054], [LON, LAT + 0.01]], sg: [[2, 1, 50, 0]] };
  const route = [[LON, LAT], [LON, LAT + 0.002], [LON + 0.004, LAT + 0.002]];
  const step = makeAutopilot({ getPieces: () => [main, early], route, kmh: 36, noise: 0, stopShare: 1 });
  let slowest = Infinity;
  for (let t = 0; t < 40; t++) { const f = step(1); if (t > 5 && f.lat < LAT + 0.00199) slowest = Math.min(slowest, f.speed); }
  assert.ok(slowest > 8, `slowed to ${slowest.toFixed(1)} m/s on Main`);
});

test('it keeps count of how far it has driven, so a demo can be run on to a point', () => {
  const route = [[LON, LAT], [LON, LAT + 0.005], [LON + 0.004, LAT + 0.005]];
  const step = makeAutopilot({ getPieces: () => [up, across, side], route, kmh: 36, noise: 0, stopShare: 0 });
  assert.ok(Math.abs(step.routeLength - (metres(route[0], route[1]) + metres(route[1], route[2]))) < 0.01);
  let f;
  while (step.driven() < 300) f = step(1);
  const along = metres(route[0], [f.lon, f.lat]);
  assert.ok(Math.abs(along - step.driven()) < 0.5, `${along.toFixed(1)} m along, ${step.driven().toFixed(1)} m counted`);
});

// Straight north for ~3.3 km: 80 for the first half, then a 40 sign.
const fast = { id: 10, highway: 'primary', name: 'Fast', c: [[LON, LAT], [LON, LAT + 0.015]] };
const slow = { id: 11, highway: 'primary', name: 'Fast', c: [[LON, LAT + 0.015], [LON, LAT + 0.03]] };
const long = [[LON, LAT], [LON, LAT + 0.015], [LON, LAT + 0.03]];
const signAt = metres(long[0], long[1]);
const limit = (pc) => (pc === fast ? 80 : 40);
// km/h as the car passes each of `marks` metres. The fixes carry GPS speed jitter of about
// 1 km/h whatever the position noise, hence the loose comparisons.
function speedsAt(step, marks) {
  const out = [];
  for (let t = 0; t < 600 && out.length < marks.length; t++) {
    const f = step(1);
    if (step.driven() >= marks[out.length]) out.push(f.speed * 3.6);
  }
  return out;
}

test('given the limit, it keeps a little under it rather than at its cruising speed', () => {
  const step = makeAutopilot({ getPieces: () => [fast, slow], route: long, kmh: 120, limit, noise: 0, stopShare: 0 });
  const [a, b] = speedsAt(step, [1200, signAt + 300]);
  assert.ok(Math.abs(a - 76) < 3.5, `${a.toFixed(1)} before the sign`);
  assert.ok(Math.abs(b - 36) < 3.5, `${b.toFixed(1)} after it`);
});

test('a scene has it drive over the limit by a set amount, then settle again', () => {
  const scenes = [{ from: 600, to: 1200, over: 8 }];
  const step = makeAutopilot({ getPieces: () => [fast, slow], route: long, kmh: 120, limit, scenes, noise: 0, stopShare: 0 });
  const [during, after] = speedsAt(step, [1100, 1450]);
  assert.ok(Math.abs(during - 88) < 3.5, `${during.toFixed(1)} during`);
  assert.ok(Math.abs(after - 76) < 3.5, `${after.toFixed(1)} after`);
});

test('a late driver holds its speed past a lower limit, then brakes for it', () => {
  const scenes = [{ from: signAt, to: signAt + 200, late: true }];
  const step = makeAutopilot({ getPieces: () => [fast, slow], route: long, kmh: 120, limit, scenes, noise: 0, stopShare: 0 });
  const [held, braked] = speedsAt(step, [signAt + 150, signAt + 400]);
  assert.ok(Math.abs(held - 76) < 3.5, `${held.toFixed(1)} past the sign`);
  assert.ok(Math.abs(braked - 36) < 3.5, `${braked.toFixed(1)} after braking`);
});
