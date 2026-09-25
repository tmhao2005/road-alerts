import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route } from './route.js';

// A square block, ~550 m a side. West and north are a primary road, the diagonal is a
// residential lane that is shorter but slower; the east side is one-way northbound.
const SW = [106.7, 10.7], NW = [106.7, 10.705], NE = [106.705, 10.705], SE = [106.705, 10.7];
const west = { id: 1, highway: 'primary', c: [SW, NW] };
const north = { id: 2, highway: 'primary', c: [NW, NE] };
const lane = { id: 3, highway: 'residential', c: [SW, NE] };
const east = { id: 4, highway: 'secondary', oneway: 'yes', c: [SE, NE] };
const south = { id: 5, highway: 'residential', c: [SW, SE] };
const same = (a, b) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);

test('the route keeps to the bigger roads rather than a slow shortcut', () => {
  const r = route([west, north, lane], SW, NE);
  assert.ok(same(r, [SW, NW, NE]), JSON.stringify(r));
});

test('a one-way street is only driven its own way', () => {
  assert.ok(same(route([east, south], SW, NE), [SW, SE, NE]));
  // Back again it cannot come down the east side, so it goes the long way round.
  assert.ok(same(route([east, south, west, north], NE, SE), [NE, NW, SW, SE]));
});

test('no way through is no route', () => {
  assert.equal(route([west, east], NW, SE), null);
});
