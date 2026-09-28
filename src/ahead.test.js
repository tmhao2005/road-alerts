import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitsAhead, tintAhead } from './ahead.js';

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

// Two taught signs on a 60 road: a 50 the car is under, ended in law by a junction at 300 m,
// and a 40 whose pole stands `gap` metres past that junction.
const two = (gap) => {
  const w = walk([[{ max: 60 }, 0, 1300]]);
  const taught = [
    { from: -Infinity, to: 300, value: { key: '50|rep', max: 50 } },
    { from: 300 + gap, to: 900, value: { key: '40|rep', max: 40 } },
  ];
  return { taught, limits: limitsAhead(w, judge, { key: '50|rep', max: 50 }, undefined, taught) };
};

test('a few metres of law between two taught signs are not tinted: the badge never shows them', () => {
  const { taught, limits } = two(20);
  assert.deepEqual(limits.map((l) => [l.dist, l.value.max]), [[320, 40], [900, 60]]);
  assert.deepEqual(tintAhead(taught, limits), [{ from: -Infinity, to: 900 }]);
});

test('a stretch of law long enough for the badge to show keeps its gap', () => {
  const { taught, limits } = two(400);
  assert.deepEqual(limits.map((l) => [l.dist, l.value.max]).slice(0, 2), [[300, 60], [700, 40]]);
  assert.deepEqual(tintAhead(taught, limits), [{ from: -Infinity, to: 300 }, { from: 700, to: 900 }]);
});

test('a taught sign ahead is promised where it stands, however short its stretch', () => {
  // A 70 taught for 100 m of a 60 road: the badge takes it as the car passes the sign, so
  // the shoulder sign stands there - where a map piece of 70 would be waited out unseen.
  const w = walk([[{ max: 60 }, 0, 700]]);
  const taught = [{ from: 200, to: 300, value: { key: '70|rep', max: 70 } }];
  assert.deepEqual(limitsAhead(w, judge, v(60), undefined, taught).map((l) => [l.dist, l.value.max]), [[200, 70], [300, 60]]);
  assert.deepEqual(limitsAhead(walk([[{ max: 60 }, 0, 200], [{ max: 70 }, 200, 300], [{ max: 60 }, 300, 700]]), judge, v(60)), []);
});
