import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunTimes, daylight } from './sun.js';

const HCM = [10.78, 106.70];
// Vietnam local time as plain UTC+7 arithmetic.
const local = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 7, mi);
const clock = (ms) => {
  const t = new Date(ms + 7 * 3600e3);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
};
const near = (ms, h, mi) => Math.abs(clock(ms) - (h * 60 + mi)) <= 5;

// Published times for Hồ Chí Minh: about 05:33 and 18:17 at the June solstice, 06:04 and
// 17:35 at the December one.
test('sunrise and sunset in TP.HCM through the year', () => {
  const june = sunTimes(local(2026, 6, 21, 12), ...HCM);
  assert.ok(near(june.rise, 5, 33), `${clock(june.rise)}`);
  assert.ok(near(june.set, 18, 17), `${clock(june.set)}`);
  const dec = sunTimes(local(2026, 12, 21, 12), ...HCM);
  assert.ok(near(dec.rise, 6, 4), `${clock(dec.rise)}`);
  assert.ok(near(dec.set, 17, 35), `${clock(dec.set)}`);
});

test('day and night, including either side of midnight', () => {
  assert.equal(daylight(local(2026, 9, 26, 12), ...HCM), true);
  assert.equal(daylight(local(2026, 9, 26, 7), ...HCM), true);
  assert.equal(daylight(local(2026, 9, 26, 5), ...HCM), false);
  assert.equal(daylight(local(2026, 9, 26, 19), ...HCM), false);
  assert.equal(daylight(local(2026, 9, 26, 23, 50), ...HCM), false);
  assert.equal(daylight(local(2026, 9, 27, 0, 10), ...HCM), false);
});
