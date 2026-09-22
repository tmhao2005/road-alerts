import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitsAhead } from './ahead.js';

// legs only matter for their pieces and extents; pts/dist let pointAt place the sign.
const walk = (legs) => {
  const end = legs[legs.length - 1][2];
  return {
    pts: [[106.7, 10.7], [106.7, 10.7 + end / 111195]],
    dist: [0, end],
    legs: legs.map(([piece, start, e]) => ({ piece, sense: 1, start, end: e })),
  };
};
const v = (max) => ({ key: String(max), max });
const judge = (piece) => v(piece.max);

test('a lower limit ahead gets a sign where it starts', () => {
  const out = limitsAhead(walk([[{ max: 80 }, 0, 200], [{ max: 60 }, 200, 400]]), judge, v(80));
  assert.equal(out.length, 1);
  assert.equal(out[0].value.max, 60);
  assert.equal(out[0].dist, 200);
});

test('a short stretch the badge would ignore gets no sign', () => {
  const out = limitsAhead(walk([[{ max: 60 }, 0, 200], [{ max: 80 }, 200, 300], [{ max: 60 }, 300, 600]]), judge, v(60));
  assert.deepEqual(out, []);
});

test('a higher limit is only promised once it has held long enough', () => {
  assert.equal(limitsAhead(walk([[{ max: 60 }, 0, 100], [{ max: 80 }, 100, 300]]), judge, v(60)).length, 0);
  assert.equal(limitsAhead(walk([[{ max: 60 }, 0, 100], [{ max: 80 }, 100, 400]]), judge, v(60)).length, 1);
});

test('an unknown limit ahead gets no sign', () => {
  assert.deepEqual(limitsAhead(walk([[{ max: 80 }, 0, 100], [{ max: null }, 100, 600]]), judge, v(80)), []);
});
