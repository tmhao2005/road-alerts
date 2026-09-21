import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchLive, makeStabiliser, evaluate, tilesAround } from './live.js';

// Two parallel north-south roads ~11 m apart, and an east-west side street.
const main = { id: 1, highway: 'primary', name: 'Main', c: [[106.7, 10.7], [106.7, 10.71]] };
const side = { id: 2, highway: 'residential', name: 'Side', c: [[106.7, 10.705], [106.71, 10.705]] };
const northbound = { id: 3, highway: 'trunk', name: 'QL', oneway: 'yes', c: [[106.8, 10.7], [106.8, 10.71]] };
const southbound = { id: 4, highway: 'trunk', name: 'QL', oneway: 'yes', c: [[106.8001, 10.71], [106.8001, 10.7]] };

test('at a junction a car heading north stays on the north-south road', () => {
  const m = matchLive([side, main], { lon: 106.70002, lat: 10.70501, acc: 5, heading: 0, speed: 10 });
  assert.equal(m.piece.id, 1);
});

test('at a junction a car heading east is on the side street', () => {
  const m = matchLive([side, main], { lon: 106.70003, lat: 10.70501, acc: 5, heading: 90, speed: 10 });
  assert.equal(m.piece.id, 2);
});

test('on a divided road, heading picks the correct carriageway', () => {
  const fix = { lon: 106.80005, lat: 10.705, acc: 5, speed: 15 };
  assert.equal(matchLive([northbound, southbound], { ...fix, heading: 0 }).piece.id, 3);
  assert.equal(matchLive([northbound, southbound], { ...fix, heading: 180 }).piece.id, 4);
});

test('nothing within reach means no match rather than a far-away road', () => {
  assert.equal(matchLive([main], { lon: 106.72, lat: 10.72, acc: 5 }), null);
});

const v = (max) => ({ key: String(max), max });

test('the stabiliser shows the first value at once', () => {
  const next = makeStabiliser();
  assert.equal(next(v(60), 0).changed, true);
});

test('a higher limit must hold for ~250 m before it replaces the shown one', () => {
  const next = makeStabiliser({ down: 40, up: 250 });
  next(v(60), 0);
  assert.equal(next(v(80), 100).changed, false);
  assert.equal(next(v(80), 100).changed, false);
  const r = next(v(80), 100);
  assert.equal(r.changed, true);
  assert.equal(r.shown.max, 80);
});

test('a lower limit replaces the shown one almost at once', () => {
  const next = makeStabiliser({ down: 40, up: 250 });
  next(v(80), 0);
  assert.equal(next(v(60), 25).changed, false);
  assert.equal(next(v(60), 25).changed, true);
});

test('a brief flicker to a higher value is never announced', () => {
  const next = makeStabiliser({ down: 40, up: 250 });
  next(v(60), 0);
  next(v(80), 100);
  next(v(80), 100);
  assert.equal(next(v(60), 25).changed, false);
  assert.equal(next(v(80), 100).changed, false); // the 80 run restarted from zero
});

test('dropping to an unknown limit is treated as relaxing, not tightening', () => {
  const next = makeStabiliser({ down: 40, up: 250 });
  next(v(100), 0);
  assert.equal(next({ key: '—', max: null }, 60).changed, false);
});

test('evaluate turns a tile piece into a limit with its reasons', () => {
  const index = { wards: [{ n: 'Phường Sài Gòn', k: 'phuong' }], quarters: [] };
  const r = evaluate({ ...main, w: 1, lanes: '2' }, index, 'oto_con');
  assert.equal(r.zone.inside, true);
  assert.equal(r.limit.max, 50);
  assert.equal(r.wardName, 'Phường Sài Gòn');
});

test('a cao tốc piece without a sign yields no number', () => {
  const r = evaluate({ id: 9, highway: 'motorway', c: main.c }, { wards: [], quarters: [] }, 'oto_con');
  assert.equal(r.limit.max, null);
  assert.equal(r.limit.tier, 'khong_ro');
});

test('tiles around a point are the 3x3 block centred on it', () => {
  const t = tilesAround(106.7, 10.77);
  assert.equal(t.length, 9);
  assert.ok(t.includes(`${Math.floor(106.7 / 0.02)}_${Math.floor(10.77 / 0.02)}`));
});
