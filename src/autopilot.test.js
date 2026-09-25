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
