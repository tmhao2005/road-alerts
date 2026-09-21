import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoordinate, pointInRings, pointSegment } from './geo.js';

test('parses a coordinate copied from Google Maps (lat, lng) into [lon, lat]', () => {
  assert.deepEqual(parseCoordinate('10.7769, 106.7009'), [106.7009, 10.7769]);
  assert.deepEqual(parseCoordinate('10.7769,106.7009'), [106.7009, 10.7769]);
});

test('parses the @lat,lng part of a Google Maps URL', () => {
  const url = 'https://www.google.com/maps/place/Ben+Thanh/@10.7721,106.6983,17z/data=x';
  assert.deepEqual(parseCoordinate(url), [106.6983, 10.7721]);
});

test('rejects text that is not a coordinate', () => {
  assert.equal(parseCoordinate('Bến Thành'), null);
  assert.equal(parseCoordinate('200, 106'), null);
});

test('point in polygon respects holes', () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  assert.equal(pointInRings([2, 2], [outer, hole]), true);
  assert.equal(pointInRings([5, 5], [outer, hole]), false);
  assert.equal(pointInRings([20, 20], [outer]), false);
});

test('point-to-segment distance is in metres', () => {
  // 0.001 degree of latitude is ~111 m.
  const d = pointSegment([106.7, 10.001], [106.699, 10.0], [106.701, 10.0]).dist;
  assert.ok(Math.abs(d - 111.2) < 1, `got ${d}`);
});
