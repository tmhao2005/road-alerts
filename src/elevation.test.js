import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elevate, heightAlong, DECK, GRADE } from './elevation.js';
import { metres } from './geo.js';

// East along a main road: 300 m of approach, a 400 m deck over a north-south street, and
// the road on beyond. ~0.0027 degrees is 300 m here.
const LAT = 10.8, E = (m) => 106.65 + m / 109400;
const approach = { id: 1, highway: 'primary', name: 'Cộng Hòa', c: [[E(0), LAT], [E(300), LAT]] };
const deck = { id: 2, highway: 'primary', name: 'Cầu vượt', bridge: 1, layer: 1, c: [[E(300), LAT], [E(700), LAT]] };
const beyond = { id: 3, highway: 'primary', name: 'Cộng Hòa', c: [[E(700), LAT], [E(1000), LAT]] };
const under = { id: 4, highway: 'secondary', name: 'Hoàng Hoa Thám', c: [[E(500), LAT - 0.002], [E(500), LAT + 0.002]] };
const len = (p) => metres(p.c[0], p.c[p.c.length - 1]);

test('a bridge over a road stands a deck high, climbing to it along the road it continues', () => {
  const h = elevate([approach, deck, beyond, under]);
  assert.equal(heightAlong(h.get(deck), 200), DECK);
  assert.equal(heightAlong(h.get(deck), 0), DECK);
  const up = h.get(approach);
  assert.ok(Math.abs(heightAlong(up, len(approach)) - DECK) < 1e-9, 'at the top of the ramp');
  assert.equal(heightAlong(up, len(approach) - DECK / GRADE - 1), 0, 'on the ground before it');
  assert.ok(!h.has(under), 'the road below stays down');
});

test('where the lanes part right at its end, the deck itself is the ramp', () => {
  // A frontage road leaves the approach at the deck's first vertex, so the ground ends there.
  const frontage = { id: 5, highway: 'primary', name: 'Cộng Hòa', oneway: 'yes', c: [[E(300), LAT], [E(700), LAT - 0.0001]] };
  const h = elevate([approach, deck, beyond, under, frontage]);
  const d = h.get(deck);
  assert.equal(heightAlong(d, 0), 0);
  assert.ok(Math.abs(heightAlong(d, DECK / GRADE) - DECK) < 1e-6);
  assert.ok(!h.has(approach) && !h.has(frontage));
});

test('a bridge that crosses no road - over a canal - stays flat', () => {
  const canal = { ...deck, id: 6 };
  const h = elevate([approach, canal, beyond]);
  assert.equal(h.size, 0);
});

test('heights are 0 off the ends of the breakpoints and straight between them', () => {
  const bp = [[100, 0], [220, 6]];
  assert.equal(heightAlong(bp, 50), 0);
  assert.equal(heightAlong(bp, 160), 3);
  assert.equal(heightAlong(bp, 300), 0);
});
