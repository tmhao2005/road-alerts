import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arc, fromEnd } from './curve.js';

// A roundabout as the map has it: a few points on a circle of radius 60, joined by straight
// pieces. `from` and `to` in degrees; a negative span goes the other way round.
const polygon = (from, to, points) => Array.from({ length: points }, (_, k) => {
  const t = ((from + ((to - from) * k) / (points - 1)) * Math.PI) / 180;
  return [200 + 60 * Math.cos(t), 300 + 60 * Math.sin(t)];
});
const heading = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]);
const turnAt = (pts, k) => Math.atan2(Math.sin(heading(pts[k], pts[k + 1]) - heading(pts[k - 1], pts[k])), Math.cos(heading(pts[k], pts[k + 1]) - heading(pts[k - 1], pts[k])));

test('an arrow over a corner of the map bends evenly, with no kink', () => {
  // Three points: the traced line has one sharp corner in the middle.
  const { pts } = arc(polygon(0, 40, 3));
  const turns = pts.slice(1, -1).map((_, i) => turnAt(pts, i + 1));
  const spread = Math.max(...turns) - Math.min(...turns);
  assert.ok(spread < 1e-9, `turns vary by ${spread}`);
  assert.ok(turns.every((t) => Math.abs(t) < (6 * Math.PI) / 180), 'no single step turns sharply');
});

test('the ends stay where the road put them', () => {
  const line = polygon(10, 50, 4);
  const { pts } = arc(line);
  for (const [p, q] of [[pts[0], line[0]], [pts[pts.length - 1], line[line.length - 1]]]) {
    assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9);
  }
});

test('the head points along the curve at the tip, either way round', () => {
  for (const [from, to] of [[0, 40], [40, 0], [200, 250]]) {
    const { pts, dir } = arc(polygon(from, to, 3));
    const last = heading(pts[pts.length - 2], pts[pts.length - 1]);
    const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dir[1], dir[0]) - last), Math.cos(Math.atan2(dir[1], dir[0]) - last)));
    assert.ok(off < (2 * Math.PI) / 180, `${from}→${to}: head is ${((off * 180) / Math.PI).toFixed(1)}° off the curve`);
  }
});

test('a straight road keeps a straight arrow', () => {
  const { pts, dir } = arc([[0, 0], [10, 0.2], [30, 0]]);
  assert.equal(pts.length, 2);
  assert.ok(Math.abs(dir[0] - 1) < 1e-9 && Math.abs(dir[1]) < 1e-9);
});

test('fromEnd finds the point a given distance back along a line', () => {
  const { at, index } = fromEnd([[0, 0], [10, 0], [10, 10]], 15);
  assert.deepEqual(at, [5, 0]);
  assert.equal(index, 1);
});
