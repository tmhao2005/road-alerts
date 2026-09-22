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
