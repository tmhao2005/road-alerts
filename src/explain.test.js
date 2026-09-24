import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestions, explain } from './explain.js';
import { statutoryLimit } from './limit.js';

// A two-way road in a xã with houses along it: guessed inside, without much conviction.
const village = {
  vehicle: 'oto_con',
  road: { expressway: false, divided: null, oneway: false, lanes: 2, inside: true },
  zoneConfidence: 'thap',
  now: { max: 50 }, shown: { max: 50 },
};

// A city road the map draws without its median.
const city = { ...village, zoneConfidence: 'cao' };

test('an unsure zone guess is suggested before the road shape', () => {
  assert.deepEqual(suggestions(village, statutoryLimit), [
    { max: 80, cause: 'zone' },   // outside, narrow column: Bảng 2 dòng 1
    { max: 60, cause: 'column' }, // inside, wide column: Bảng 1
  ]);
});

test('a confident zone guess puts the road shape first', () => {
  assert.deepEqual(suggestions(city, statutoryLimit).map((s) => s.cause), ['column', 'zone']);
});

test('the number the app had computed but not yet shown comes first', () => {
  const late = { ...city, now: { max: 60 }, shown: { max: 50 } };
  assert.deepEqual(suggestions(late, statutoryLimit)[0], { max: 60, cause: 'lag' });
});

test('the driver\'s number names the fact', () => {
  assert.deepEqual(explain(village, 80, statutoryLimit), { cause: 'zone', max: 80 });
  assert.deepEqual(explain(village, 60, statutoryLimit), { cause: 'column', max: 60 });
  assert.deepEqual(explain(village, 70, statutoryLimit), { cause: 'sign', max: 70 });
  assert.deepEqual(explain(village, 50, statutoryLimit), { cause: 'same', max: 50 });
  assert.deepEqual(explain(village, 'none', statutoryLimit), { cause: 'none' });
  assert.deepEqual(explain(village, 'unsure', statutoryLimit), { cause: 'unsure' });
});

test('a wide road is tested for being narrow', () => {
  const divided = { ...village, road: { ...village.road, divided: true, inside: false }, now: { max: 90 }, shown: { max: 90 } };
  assert.deepEqual(explain(divided, 80, statutoryLimit), { cause: 'column', max: 80 });
});

test('a limit from a mapped sign points at the sign, not at the statute', () => {
  const signed = { ...village, now: { max: 70, tier: 'bien_bao' }, shown: { max: 70, tier: 'bien_bao' } };
  assert.deepEqual(suggestions(signed, statutoryLimit), [{ max: 50, cause: 'mapsign' }]);
  assert.deepEqual(explain(signed, 50, statutoryLimit), { cause: 'mapsign', max: 50 });
  assert.deepEqual(explain(signed, 80, statutoryLimit), { cause: 'sign', max: 80 });
});
