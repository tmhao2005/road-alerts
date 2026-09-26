import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allLines, signLine, lawLine, lightLine, LIMIT_STEPS, FIXED } from './phrases.js';

test('ids are unique and usable as filenames', () => {
  const ids = allLines().map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
});

test('every line has text and a delivery', () => {
  for (const l of allLines()) {
    assert.ok(l.text.length > 0, l.id);
    assert.ok(['plain', 'calm', 'urgent', 'caution', 'sure', 'hedged'].includes(l.voice), l.id);
  }
});

// The whole point of the two tiers: they must not be rendered the same way.
test('a signposted limit and a statutory one are delivered differently', () => {
  assert.notEqual(signLine(60).voice, lawLine(60).voice);
  assert.notEqual(signLine(60).text, lawLine(60).text);
});

// Speaking a number the map invented is still better than silence, so an odd value keeps
// its text and only loses the recording.
test('a limit outside the rendered set falls back instead of going quiet', () => {
  const odd = signLine(37);
  assert.equal(odd.id, null);
  assert.equal(odd.text, 'Tốc độ tối đa 37');
  assert.equal(signLine(60).id, 'sign-60');
});

test('statutory values are all covered', () => {
  for (const max of [30, 40, 50, 60, 70, 80, 90, 120]) assert.ok(LIMIT_STEPS.includes(max), String(max));
});

test('a crossing light is a different line from a junction light', () => {
  assert.equal(lightLine(true).id, 'light-crossing');
  assert.equal(lightLine(false).id, 'light');
});

// Like the limits themselves: being over a number the law gave us must not sound as sure
// as being over one read off a sign.
test('being over a statutory limit is said differently from being over a sign', () => {
  const [sign, law] = ['over', 'over-law'].map((id) => FIXED.find((f) => f.id === id));
  assert.notEqual(sign.text, law.text);
  assert.notEqual(sign.voice, law.voice);
});
