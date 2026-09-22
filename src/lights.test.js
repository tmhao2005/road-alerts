import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightsAhead, reachFor, makeLightWatcher, lightPhrase } from './lights.js';

// A north-south road in three vertices ~110 m apart, with a light at the middle vertex
// facing northbound traffic only, and one at the far end facing both ways.
const LAT = 10.7, LON = 106.7, STEP = 0.001; // ~111 m of latitude
const road = {
  id: 1, highway: 'primary', name: 'Main',
  c: [[LON, LAT], [LON, LAT + STEP], [LON, LAT + 2 * STEP]],
  sg: [[1, 1, 101, 0], [2, 0, 102, 1]],
};
const north = { lon: LON, lat: LAT + 0.0001, heading: 0, speed: 15 };
const south = { lon: LON, lat: LAT + 2 * STEP - 0.0001, heading: 180, speed: 15 };

test('a light facing the car is found, with its distance', () => {
  const ahead = lightsAhead([road], { piece: road, seg: 0 }, north, 300);
  assert.deepEqual(ahead.map((l) => l.id), [101, 102]);
  assert.ok(Math.abs(ahead[0].dist - 100) < 3);
});

test('a light facing the other way is skipped', () => {
  const ahead = lightsAhead([road], { piece: road, seg: 1 }, south, 300);
  assert.deepEqual(ahead.map((l) => l.id), []); // 102 is behind, 101 faces north
});

test('nothing beyond the reach is returned', () => {
  const ahead = lightsAhead([road], { piece: road, seg: 0 }, north, 150);
  assert.deepEqual(ahead.map((l) => l.id), [101]);
});

test('a stopped or heading-less car gets no lights', () => {
  assert.deepEqual(lightsAhead([road], { piece: road, seg: 0 }, { ...north, speed: 0.5 }, 300), []);
  assert.deepEqual(lightsAhead([road], { piece: road, seg: 0 }, { ...north, heading: null }, 300), []);
  assert.deepEqual(lightsAhead([road], { piece: road, seg: 0 }, { ...north, speed: null }, 300), []);
});

test('the walk carries on into the next piece of the same road', () => {
  const a = { id: 5, highway: 'primary', name: 'Main', c: [[LON, LAT], [LON, LAT + STEP]] };
  const b = { id: 5, highway: 'primary', name: 'Main', c: [[LON, LAT + STEP], [LON, LAT + 2 * STEP]], sg: [[1, 0, 200, 0]] };
  const ahead = lightsAhead([a, b], { piece: a, seg: 0 }, north, 300);
  assert.deepEqual(ahead.map((l) => l.id), [200]);
});

test('the walk continues on a piece drawn the other way round', () => {
  const a = { id: 5, highway: 'primary', name: 'Main', c: [[LON, LAT], [LON, LAT + STEP]] };
  const b = { id: 6, highway: 'primary', name: 'Main', c: [[LON, LAT + 2 * STEP], [LON, LAT + STEP]], sg: [[0, -1, 201, 0]] };
  const ahead = lightsAhead([a, b], { piece: a, seg: 0 }, north, 300);
  assert.deepEqual(ahead.map((l) => l.id), [201]); // backward on b is northbound
});

test('the walk stops at a junction instead of guessing a turn', () => {
  const a = { id: 5, highway: 'primary', name: 'Main', c: [[LON, LAT], [LON, LAT + STEP]] };
  const side = { id: 7, highway: 'residential', name: 'Hẻm', c: [[LON, LAT + STEP], [LON + STEP, LAT + STEP]], sg: [[1, 0, 300, 0]] };
  const other = { id: 8, highway: 'primary', name: 'Other', c: [[LON, LAT + STEP], [LON, LAT + 2 * STEP]], sg: [[1, 0, 301, 0]] };
  assert.deepEqual(lightsAhead([a, side, other], { piece: a, seg: 0 }, north, 300), []);
});

test('the walk will not continue the wrong way up a one-way road', () => {
  const a = { id: 5, highway: 'primary', name: 'Main', c: [[LON, LAT], [LON, LAT + STEP]] };
  const b = { id: 6, highway: 'primary', name: 'Main', oneway: 'yes', c: [[LON, LAT + 2 * STEP], [LON, LAT + STEP]], sg: [[0, 0, 400, 0]] };
  assert.deepEqual(lightsAhead([a, b], { piece: a, seg: 0 }, north, 300), []);
});

test('reach is about eight seconds of driving, within bounds', () => {
  assert.equal(reachFor(0), 80);
  assert.equal(reachFor(20), 160);
  assert.equal(reachFor(50), 300);
});

const at = (dy) => [LON, LAT + dy];

test('each light is spoken once', () => {
  const next = makeLightWatcher();
  const l = { id: 1, dist: 120, at: at(0.001) };
  assert.equal(next([l]).speak, l);
  assert.equal(next([{ ...l, dist: 90 }]).speak, null);
});

test('a second signal node at the same junction is not spoken again', () => {
  const next = makeLightWatcher({ cluster: 60 });
  next([{ id: 1, dist: 120, at: at(0.001) }]);
  assert.equal(next([{ id: 2, dist: 110, at: at(0.0013) }]).speak, null); // ~33 m on
  const far = { id: 3, dist: 150, at: at(0.004) };
  assert.equal(next([far]).speak, far);
});

test('a light first seen at the stop line is not announced', () => {
  const next = makeLightWatcher();
  assert.equal(next([{ id: 1, dist: 10, at: at(0) }]).speak, null);
});

test('crossings and junction lights are phrased differently', () => {
  assert.notEqual(lightPhrase({ crossing: true }), lightPhrase({ crossing: false }));
});
