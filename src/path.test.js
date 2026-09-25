import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkAhead, junctions, holdAt } from './path.js';

// A two-way block heading north into the next block of the same street, which is one-way
// southbound for cars and both ways for xe máy.
const J = [106.9, 10.801];
const first = { id: 1, highway: 'secondary', name: 'Phạm Ngũ Lão', c: [[106.9, 10.8], J] };
const next = { id: 2, highway: 'secondary', name: 'Phạm Ngũ Lão', oneway: 'yes', onewayMoto: 'no', c: [[106.9, 10.802], J] };
const match = { piece: first, seg: 0, t: 0 };

test('a car walking north stops where the street turns one-way against it', () => {
  const walk = walkAhead([first, next], match, 0, 1000, first.c[0], false);
  assert.deepEqual(walk.legs.map((l) => l.piece.id), [1]);
  assert.equal(walk.open, false);
});

test('a xe máy walks on, since the street is two-way for it', () => {
  const walk = walkAhead([first, next], match, 0, 1000, first.c[0], true);
  assert.deepEqual(walk.legs.map((l) => l.piece.id), [1, 2]);
  assert.equal(walk.legs[1].sense, -1);
});

// A crossroads at X, and a road split in two where only the ward changes at W.
const X = [106.95, 10.85], W = [106.95, 10.86];
const ns = { id: 10, name: 'Dọc', c: [[106.95, 10.84], X, W] };
const ns2 = { id: 10, name: 'Dọc', c: [W, [106.95, 10.87]] };
const ew = { id: 11, name: 'Ngang', c: [[106.94, 10.85], X, [106.96, 10.85]] };
const key = ([lon, lat]) => `${lon},${lat}`;

test('a crossroads is a junction; a ward split is not', () => {
  const j = junctions([ns, ns2, ew]);
  assert.ok(j.has(key(X)));
  assert.ok(!j.has(key(W)));
  assert.ok(!j.has(key(ns.c[0])));
});

test('driving straight, the guess is not held at the crossroads', () => {
  const j = junctions([ns, ns2, ew]);
  const walk = walkAhead([ns, ns2, ew], { piece: ns, seg: 0, t: 0.5 }, 0, 2000, [106.95, 10.845], false);
  assert.equal(holdAt(walk, (p) => j.has(key(p)), 3), Infinity);
});

test('swinging off the road, the guess is held at the next junction', () => {
  const j = junctions([ns, ns2, ew]);
  const walk = walkAhead([ns, ns2, ew], { piece: ns, seg: 0, t: 0.5 }, 0, 2000, [106.95, 10.845], false);
  const stop = holdAt(walk, (p) => j.has(key(p)), 30);
  assert.ok(Math.abs(stop - walk.dist[1]) < 0.01, `${stop}`);
});
