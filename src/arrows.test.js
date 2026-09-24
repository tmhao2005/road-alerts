import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeArrows } from './arrows.js';

const road = (pts, extra = {}) => ({ xy: pts.flat(), way: 1, rank: 3, id: 1, ...extra });
const keys = (arrows) => arrows.map((a) => a.key).sort();

test('the same roads give the same arrows, whichever order they arrive in', () => {
  const roads = [
    road([[0, 0], [300, 0]], { id: 1 }),
    road([[0, 40], [0, 400]], { id: 2 }),
    road([[300, 0], [300, 20]], { id: 3 }),
    road([[10, 5], [290, 5]], { id: 4, rank: 1 }),
  ];
  const once = keys(placeArrows(roads, 70));
  assert.deepEqual(keys(placeArrows(roads.slice().reverse(), 70)), once);
  assert.deepEqual(keys(placeArrows([roads[2], roads[0], roads[3], roads[1]], 70)), once);
});

test('a street cut into short pieces at every junction still reads as one arrow at a time', () => {
  // 400 m of street in twenty 20 m pieces: one arrow each would be one every 20 m.
  const pieces = Array.from({ length: 20 }, (_, k) => road([[k * 20, 0], [k * 20 + 20, 0]], { id: 100 + k }));
  const xs = placeArrows(pieces, 70).map((a) => a.x).sort((a, b) => a - b);
  const gaps = xs.slice(1).map((x, k) => x - xs[k]);
  assert.ok(gaps.every((g) => g >= 42), `arrows ${gaps.join(', ')} m apart`);
  assert.ok(gaps.every((g) => g <= 80), `arrows ${gaps.join(', ')} m apart`);
});

test('a divided road keeps an arrow each way', () => {
  const north = road([[0, 0], [0, 300]], { id: 1 });
  const south = road([[12, 0], [12, 300]], { id: 2, way: -1 });
  const arrows = placeArrows([north, south], 70);
  assert.ok(arrows.some((a) => a.road === north && a.uy > 0.99));
  assert.ok(arrows.some((a) => a.road === south && a.uy < -0.99));
});

test('beside a main road going the same way, a slip lane gives up its arrows', () => {
  const main = road([[0, 0], [300, 0]], { id: 1, rank: 5 });
  const lane = road([[0, 10], [300, 10]], { id: 2, rank: 0 });
  const arrows = placeArrows([lane, main], 70);
  assert.ok(arrows.length > 0);
  assert.ok(arrows.every((a) => a.road === main));
});

test('a road in two map tiles is not given its arrows twice', () => {
  const a = road([[0, 0], [200, 0]]), b = road([[0, 0], [200, 0]]);
  assert.equal(placeArrows([a, b], 70).length, placeArrows([a], 70).length);
});

test('tiles arriving far away leave the arrows here where they were', () => {
  const here = [road([[0, 0], [500, 0]], { id: 1 }), road([[250, -200], [250, 200]], { id: 2, rank: 4 })];
  const far = Array.from({ length: 30 }, (_, k) => road([[3000 + k * 25, 0], [3000 + k * 25 + 25, 0]], { id: 50 + k, rank: 6 }));
  const near = (arrows) => keys(arrows.filter((a) => a.x < 1000));
  assert.deepEqual(near(placeArrows(here.concat(far), 70)), near(placeArrows(here, 70)));
});

test('an arrow points the way the road may be driven, round a bend without cutting it', () => {
  const back = placeArrows([road([[0, 0], [100, 0]], { way: -1 })], 200);
  assert.equal(back.length, 1);
  assert.ok(back[0].ux < -0.99);
  // An arrow landing on the corner of a 90° bend points halfway round it.
  const [bend] = placeArrows([road([[0, 0], [50, 0], [50, 50]])], 200);
  assert.deepEqual([bend.x, bend.y], [50, 0]);
  assert.ok(Math.abs(bend.ux - Math.SQRT1_2) < 1e-9 && Math.abs(bend.uy - Math.SQRT1_2) < 1e-9);
});

test('a stub too short to hold an arrow gets none', () => {
  assert.equal(placeArrows([road([[0, 0], [8, 0]])], 70).length, 0);
});
