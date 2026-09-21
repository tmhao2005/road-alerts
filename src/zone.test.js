import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessZone } from './zone.js';

test('a street inside a phường is inside, with high confidence', () => {
  const z = guessZone({ highway: 'tertiary', ward: 'phuong', quarter: 'khu_pho', inResidential: true });
  assert.equal(z.inside, true);
  assert.equal(z.confidence, 'cao');
});

test('a trunk road through a phường is inside but flagged, since signs there can differ', () => {
  const z = guessZone({ highway: 'trunk', ward: 'phuong', quarter: null, inResidential: false });
  assert.equal(z.inside, true);
  assert.equal(z.confidence, 'trung_binh');
});

test('in a xã, a small road is treated as inside for safety', () => {
  const z = guessZone({ highway: 'residential', ward: 'xa', quarter: 'ap', inResidential: false });
  assert.equal(z.inside, true);
});

test('the hard case - houses along a quốc lộ in a xã - is inside at low confidence', () => {
  const z = guessZone({ highway: 'trunk', ward: 'xa', quarter: 'ap', inResidential: true });
  assert.equal(z.inside, true);
  assert.equal(z.confidence, 'thap');
});

test('open road in a xã is outside, at low confidence', () => {
  const z = guessZone({ highway: 'primary', ward: 'xa', quarter: null, inResidential: false });
  assert.equal(z.inside, false);
  assert.equal(z.confidence, 'thap');
});

test('a missing ward is a data gap, so it takes the lower limit, never open-road 90', () => {
  const z = guessZone({ highway: 'trunk', ward: null, quarter: null, inResidential: false });
  assert.equal(z.inside, true);
  assert.equal(z.confidence, 'thap');
});

test('every answer carries a reason', () => {
  for (const ward of ['phuong', 'xa', null]) {
    for (const inResidential of [true, false]) {
      assert.ok(guessZone({ highway: 'primary', ward, quarter: null, inResidential }).reason);
    }
  }
});
