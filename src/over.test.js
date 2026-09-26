import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeOverWatch, judged } from './over.js';

const SIGN = (max) => ({ max, tier: 'bien_bao' });
const LAW = (max) => ({ max, tier: 'theo_luat' });

// One fix a second. speeds and limit: a list by second, or a function of the second.
function drive(watch, speeds, limit) {
  const at = (x, i) => (typeof x === 'function' ? x(i) : Array.isArray(x) ? x[i] : x);
  const seconds = Array.isArray(speeds) ? speeds.length : 60;
  return Array.from({ length: seconds }, (_, i) => ({ i, ...watch({ t: i * 1000, kmh: at(speeds, i), limit: at(limit, i) }) }));
}
const said = (out) => out.filter((o) => o.say).map((o) => ({ i: o.i, level: o.say.level }));
const hold = (kmh, n) => Array(n).fill(kmh);

test('a car cruising on the limit never turns red and is never spoken to', () => {
  const out = drive(makeOverWatch(), (i) => 60 + [0, 1, -1, 1, 0, -1][i % 6], SIGN(60));
  assert.ok(out.every((o) => !o.red));
  assert.deepEqual(said(out), []);
});

test('a little over turns the number red and leaves the voice quiet', () => {
  const out = drive(makeOverWatch(), hold(64, 60), SIGN(60));
  assert.ok(out.slice(1).every((o) => o.red));
  assert.deepEqual(said(out), []);
});

test('one fix over is not enough to turn the number red', () => {
  const out = drive(makeOverWatch(), [60, 60, 66, 60, 60, 63, 64, 60], SIGN(60));
  assert.deepEqual(out.map((o) => o.red), [false, false, false, false, false, false, true, false]);
});

test('5 over, held, is said once after three seconds', () => {
  const out = drive(makeOverWatch(), hold(66, 60), SIGN(60));
  assert.deepEqual(said(out), [{ i: 3, level: 'over' }]);
  assert.equal(out[3].say.tier, 'bien_bao');
  assert.equal(out[3].say.max, 60);
});

test('a moment over is not a warning', () => {
  const out = drive(makeOverWatch(), [60, 67, 68, 59, 60, 67, 66, 60, 60, 60], SIGN(60));
  assert.deepEqual(said(out), []);
});

test('10 over goes straight to the firm warning, without the first one before it', () => {
  const out = drive(makeOverWatch(), hold(72, 30), SIGN(60));
  assert.deepEqual(said(out), [{ i: 3, level: 'far' }]);
});

test('pushing on from 5 over to 10 over escalates, once', () => {
  const out = drive(makeOverWatch(), [...hold(66, 8), ...hold(73, 40)], SIGN(60));
  assert.deepEqual(said(out), [{ i: 3, level: 'over' }, { i: 11, level: 'far' }]);
});

test('the tier of the limit comes back with the warning', () => {
  const out = drive(makeOverWatch(), hold(87, 10), LAW(80));
  assert.equal(said(out)[0].level, 'over');
  assert.equal(out.find((o) => o.say).say.tier, 'theo_luat');
});

// 80 to 40 at second 5; the driver lifts off a second later and brakes at 2.5 m/s².
test('braking for a lower limit is not nagged', () => {
  const speeds = (i) => (i <= 5 ? 76 : Math.max(38, 76 - (i - 5) * 9));
  const out = drive(makeOverWatch(), speeds, (i) => SIGN(i < 5 ? 80 : 40));
  assert.deepEqual(said(out), []);
});

test('a driver who does not slow for a lower limit hears it once they have had time to react', () => {
  const out = drive(makeOverWatch(), hold(76, 30), (i) => SIGN(i < 5 ? 80 : 40));
  const s = said(out);
  assert.equal(s.length, 1);
  assert.equal(s[0].level, 'far');
  assert.ok(s[0].i >= 5 + 6, `said at ${s[0].i}`);
  assert.ok(s[0].i <= 5 + 7, `said at ${s[0].i}`);
});

test('a lower limit starts afresh even after the driver was warned on the old one', () => {
  const speeds = [...hold(86, 10), ...hold(86, 20)];
  const out = drive(makeOverWatch(), speeds, (i) => SIGN(i < 10 ? 80 : 60));
  assert.deepEqual(said(out).map((s) => s.level), ['over', 'far']);
});

test('slowing down, even from well over, does not count towards a warning', () => {
  const speeds = (i) => Math.max(60, 84 - i * 2);
  const out = drive(makeOverWatch(), speeds, SIGN(60));
  assert.deepEqual(said(out), []);
});

test('it is said again only after the driver has been back at the limit for a while', () => {
  const brief = drive(makeOverWatch(), [...hold(66, 5), ...hold(59, 2), ...hold(66, 10)], SIGN(60));
  assert.equal(said(brief).length, 1);
  const settled = drive(makeOverWatch(), [...hold(66, 5), ...hold(59, 8), ...hold(66, 10)], SIGN(60));
  assert.equal(said(settled).length, 2);
});

test('a gap in fixes is not counted as time over', () => {
  const watch = makeOverWatch();
  watch({ t: 0, kmh: 66, limit: SIGN(60) });
  const r = watch({ t: 60000, kmh: 66, limit: SIGN(60) });
  assert.equal(r.say, null);
});

test('no limit, no warning', () => {
  const out = drive(makeOverWatch(), hold(90, 20), null);
  assert.ok(out.every((o) => !o.red && !o.say));
});

test('a higher limit still waiting to be shown is the one the driver is judged by', () => {
  assert.deepEqual(judged(SIGN(80), LAW(90)), LAW(90));
  assert.deepEqual(judged(SIGN(80), SIGN(40)), SIGN(80));
  assert.deepEqual(judged(SIGN(80), null), SIGN(80));
  assert.equal(judged(null, LAW(90)), null);
  assert.equal(judged({ max: null }, LAW(90)), null);
});
