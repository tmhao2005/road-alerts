import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkAhead } from './path.js';

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
