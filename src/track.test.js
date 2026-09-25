import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchTrack } from './track.js';

// A north-south road with an east-west side street off it, meeting at a shared vertex as
// OSM junctions do, and a divided road.
const main = { id: 1, highway: 'primary', name: 'Main', c: [[106.7, 10.7], [106.7, 10.705], [106.7, 10.71]] };
const side = { id: 2, highway: 'residential', name: 'Side', c: [[106.7, 10.705], [106.71, 10.705]] };
const northbound = { id: 3, highway: 'trunk', name: 'QL', oneway: 'yes', c: [[106.8, 10.7], [106.8, 10.71]] };
const southbound = { id: 4, highway: 'trunk', name: 'QL', oneway: 'yes', c: [[106.8001, 10.71], [106.8001, 10.7]] };

test('at a junction the heading picks the road', () => {
  assert.equal(matchTrack([side, main], { lon: 106.70002, lat: 10.70501, acc: 5, heading: 0, speed: 10 }).piece.id, 1);
  assert.equal(matchTrack([side, main], { lon: 106.70003, lat: 10.70501, acc: 5, heading: 90, speed: 10 }).piece.id, 2);
});

test('a car already swinging onto the side street is not held on the road it left', () => {
  const fix = { lon: 106.70004, lat: 10.70502, acc: 5, heading: 50, speed: 4 };
  assert.equal(matchTrack([side, main], fix, [{ piece: main, cost: 0 }]).piece.id, 2);
});

test('GPS drifting toward a side street keeps the car on its road', () => {
  const fix = { lon: 106.70004, lat: 10.70502, acc: 5, heading: 10, speed: 4 };
  assert.equal(matchTrack([side, main], fix, [{ piece: main, cost: 0 }]).piece.id, 1);
});

test('on a divided road, heading picks the carriageway', () => {
  const fix = { lon: 106.80005, lat: 10.705, acc: 5, speed: 15 };
  assert.equal(matchTrack([northbound, southbound], { ...fix, heading: 0 }).piece.id, 3);
  assert.equal(matchTrack([northbound, southbound], { ...fix, heading: 180 }).piece.id, 4);
});

test('nothing near: no road', () => {
  assert.equal(matchTrack([main], { lon: 106.75, lat: 10.75, acc: 5 }), null);
});

// A flyover 4.4 m north of the road it runs over, up a ramp from it and down another.
const LAT = 10.7, UP = 10.70004;
const ground = { id: 10, highway: 'primary', name: 'Cộng Hòa', c: [[106.699, LAT], [106.7, LAT], [106.71, LAT], [106.712, LAT]] };
const rampUp = { id: 11, highway: 'primary', name: 'Cộng Hòa', c: [[106.7, LAT], [106.702, UP]] };
const deck = { id: 12, highway: 'primary', name: 'Cầu vượt', bridge: 1, layer: 1, c: [[106.702, UP], [106.708, UP]] };
const rampDown = { id: 13, highway: 'primary', name: 'Cầu vượt', c: [[106.708, UP], [106.71, LAT]] };
const city = [ground, rampUp, deck, rampDown];

// Fixes every 14 m (50 km/h) from one point to another, heading east.
function drive(from, to, memory) {
  const n = Math.round(((to[0] - from[0]) * 109300) / 14);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    const m = matchTrack(city, { lon: from[0] + (to[0] - from[0]) * f, lat: from[1] + (to[1] - from[1]) * f, acc: 5, heading: 90, speed: 14 }, memory);
    memory = m.memory;
    out.push(m.piece.id);
  }
  return { ids: out, memory };
}

test('on a flyover, a fix that drifts onto the road below stays on the deck', () => {
  let { memory } = drive([106.6992, LAT], [106.7, LAT]);
  ({ memory } = drive([106.7, LAT], [106.702, UP], memory));
  const on = drive([106.702, UP], [106.705, UP], memory);
  assert.equal(on.ids.at(-1), 12);
  // 4.4 m south: right on the road below.
  const m = matchTrack(city, { lon: 106.7052, lat: LAT, acc: 5, heading: 90, speed: 14 }, on.memory);
  assert.equal(m.piece.id, 12);
});

test('down the far ramp, the car is back on the road', () => {
  let { memory } = drive([106.6992, LAT], [106.7, LAT]);
  ({ memory } = drive([106.7, LAT], [106.702, UP], memory));
  ({ memory } = drive([106.702, UP], [106.708, UP], memory));
  ({ memory } = drive([106.708, UP], [106.71, LAT], memory));
  const after = drive([106.71, LAT], [106.7115, LAT], memory);
  assert.equal(after.ids.at(-1), 10);
});
